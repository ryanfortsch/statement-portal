'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  approveApproval,
  rejectApproval,
  coachApproval,
  markHandledApproval,
  scheduleApproval,
  cancelScheduleApproval,
  editApproval,
  explainError,
  type StayConciergeError,
} from '@/lib/stay-concierge';

// `stale: true` means the card moved on under the operator: a 409 from the
// service (coaching superseded it, or it was already resolved elsewhere). The
// queue treats this as "refresh to the latest version" rather than a hard,
// red error. This is the fix for an approve landing on a card that a just-
// submitted coaching pass had already replaced.
export type ActionResult =
  | { ok: true }
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

async function requireSession(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return { ok: true };
}

export async function approveDraft(approvalId: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await approveApproval(approvalId));
}

export async function rejectDraft(approvalId: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await rejectApproval(approvalId));
}

export async function markHandled(approvalId: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await markHandledApproval(approvalId));
}

export async function coachDraft(approvalId: string, feedback: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = feedback.trim();
  if (!trimmed) return { ok: false, error: 'Add a coaching note before sending' };
  return mapResult(await coachApproval(approvalId, trimmed));
}

/** Queue the draft to send at a future time. sendAt is a UTC ISO string. */
export async function scheduleDraft(approvalId: string, sendAt: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!sendAt) return { ok: false, error: 'Pick a time to schedule' };
  return mapResult(await scheduleApproval(approvalId, sendAt));
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
