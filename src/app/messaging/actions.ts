'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  approveApproval,
  rejectApproval,
  coachApproval,
  markHandledApproval,
  redraftApproval,
  type MarkHandledCapture,
  undoApproval,
  explainUndoRefusal,
  scheduleApproval,
  cancelScheduleApproval,
  editApproval,
  explainError,
  type StayConciergeError,
  type FollowupOptions,
  listApprovals,
  markMaintenanceDismissed,
} from '@/lib/stay-concierge';

// `stale: true` means the card moved on under the operator: a 409 from the
// service (coaching superseded it, or it was already resolved elsewhere). The
// queue treats this as "refresh to the latest version" rather than a hard,
// red error. This is the fix for an approve landing on a card that a just-
// submitted coaching pass had already replaced.
export type ActionResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string; stale?: boolean };

type ClientResult = { ok: true } | { ok: false; error: StayConciergeError };

function mapResult(result: ClientResult): ActionResult {
  if (result.ok) {
    revalidatePath('/messaging');
    return { ok: true };
  }
  const stale = result.error.kind === 'http' && result.error.status === 409;
  return { ok: false, error: explainError(result.error), stale };
}

async function requireSession(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return { ok: true, email: session.user.email };
}

export async function approveDraft(
  approvalId: string,
  opts?: FollowupOptions,
): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const result = await approveApproval(approvalId, { ...(opts ?? {}), actor: sess.email });
  const mapped = mapResult(result);
  return mapped.ok && result.ok ? { ...mapped, warning: result.data.followup_warning } : mapped;
}

export async function rejectDraft(approvalId: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await rejectApproval(approvalId, sess.email));
}

/** Re-run the draft against current data. Nothing is sent; the card is
 *  replaced by its rewrite, same as a coached regen. */
export async function redraftDraft(approvalId: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await redraftApproval(approvalId, sess.email));
}

export async function markHandled(
  approvalId: string,
  capture?: MarkHandledCapture,
): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await markHandledApproval(approvalId, sess.email, capture));
}

/** Reverse a reject or a mark-handled: the card returns to the queue exactly
 *  as it was. A sent reply cannot be reversed; the error says so plainly. */
export async function undoDecision(approvalId: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const result = await undoApproval(approvalId, sess.email);
  if (result.ok) {
    revalidatePath('/messaging');
    return { ok: true };
  }
  const e = result.error;
  if (e.kind === 'http' && e.status === 409) return { ok: false, error: explainUndoRefusal(e.detail) };
  return { ok: false, error: explainError(e) };
}

export async function coachDraft(approvalId: string, feedback: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = feedback.trim();
  if (!trimmed) return { ok: false, error: 'Add a coaching note before sending' };
  return mapResult(await coachApproval(approvalId, trimmed));
}

/** Queue the draft to send at a future time. sendAt is a UTC ISO string. */
export async function scheduleDraft(approvalId: string, sendAt: string, opts?: FollowupOptions): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!sendAt) return { ok: false, error: 'Pick a time to schedule' };
  return mapResult(await scheduleApproval(approvalId, sendAt, opts));
}

/** Unschedule a queued send, returning it to the pending queue. */
export async function cancelSchedule(approvalId: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await cancelScheduleApproval(approvalId));
}

/** Save an operator edit to the draft text (distinct from coaching). */
export async function editDraft(approvalId: string, text: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'The reply cannot be empty' };
  return mapResult(await editApproval(approvalId, trimmed));
}

export async function dismissMaintenanceSlip(approvalId: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const queue = await listApprovals();
  if (!queue.ok) return mapResult(queue);
  const approval = queue.data.approvals.find((row) => row.id === approvalId);
  const id = approval?.maintenance_work?.slip_id;
  if (!id) return { ok: false, error: 'The work slip changed. Refresh the card.' };
  const { supabaseAdmin } = await import('@/lib/supabase-admin');
  const { data, error } = await supabaseAdmin.from('work_slips')
    .update({ status: 'dismissed', closed_at: new Date().toISOString(), closed_by_email: sess.email })
    .eq('id', id).in('status', ['open', 'dismissed']).is('assigned_to_email', null).select('id').maybeSingle();
  if (error || !data) return { ok: false, error: 'This slip may already be assigned or in progress. Open it to review before dismissing.' };
  const marked = await markMaintenanceDismissed(approvalId);
  revalidatePath('/work'); revalidatePath(`/work/${id}`); revalidatePath('/properties');
  return mapResult(marked);
}
