'use server';

import { sentReceipt, type ApprovalReceipt } from '@/lib/approval-receipt';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { checkTeamDraftTiming } from '@/lib/team-draft-validity';
import {
  approveContractorApproval,
  markHandledContractorApproval,
  coachContractorApproval,
  scheduleContractorApproval,
  cancelScheduleContractorApproval,
  editTeamApproval,
  redraftTeamApproval,
  undoTeamApproval,
  saveContractorCuratedFacts,
  explainError,
  explainUndoRefusal,
  isStaleConflict,
  type MarkHandledCapture,
  type StayConciergeError,
} from '@/lib/stay-concierge';

/** `stale` means the card moved on under the operator (a coached rewrite
 *  replaced it, someone else decided it): the card refreshes instead of
 *  showing a red error. */
export type ActionResult = { ok: true; receipt?: ApprovalReceipt } | { ok: false; error: string; stale?: boolean; receipt?: ApprovalReceipt };

type ClientResult = { ok: true } | { ok: false; error: StayConciergeError };

function mapResult(res: ClientResult): ActionResult {
  if (res.ok) {
    revalidatePath('/messaging/team');
    return { ok: true };
  }
  return { ok: false, error: explainError(res.error), stale: isStaleConflict(res.error), receipt: res.error.kind === 'http' ? res.error.receipt : undefined };
}

async function requireSession(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return { ok: true, email: session.user.email };
}

/** `opts` carries the card's proposed-work-slip decision (file it or not,
 * and to which property). Omitted for cards without a proposal, in which
 * case the backend applies its inferred defaults. */
export async function approveContractorDraft(
  id: string,
  opts?: { fileSlip?: boolean; slipPropertyId?: string },
): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const timingError = await checkTeamDraftTiming('contractor', id);
  if (timingError) return { ok: false, error: timingError };
  const result = await approveContractorApproval(id, opts);
  const mapped = mapResult(result);
  return mapped.ok && result.ok ? { ...mapped, receipt: sentReceipt(result.data) } : mapped;
}

/** Clear the card without sending. `capture` is why (a reason) and, when the
 *  operator replied elsewhere, what she sent. Undo puts it back. */
export async function markContractorHandled(id: string, capture?: MarkHandledCapture): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await markHandledContractorApproval(id, capture, sess.email));
}

/** Reverse a Mark handled: the card returns exactly as it was. */
export async function undoContractorDecision(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await undoTeamApproval('contractor', id, sess.email);
  if (res.ok) {
    revalidatePath('/messaging/team');
    return { ok: true };
  }
  const e = res.error;
  if (e.kind === 'http' && e.status === 409) return { ok: false, error: explainUndoRefusal(e.detail, 'them') };
  return { ok: false, error: explainError(e) };
}

/** Edit changes this reply only: the operator's words become the draft. */
export async function editContractorDraft(id: string, text: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'The reply cannot be empty' };
  return mapResult(await editTeamApproval('contractor', id, trimmed));
}

/** Re-run the draft on today's data. Nothing is sent and nothing is taught. */
export async function redraftContractorDraft(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await redraftTeamApproval('contractor', id, sess.email));
}

/** Queue the draft to send at a future time (the send-later element). The
 * card disables this when a work-slip proposal is present. */
export async function scheduleContractorDraft(id: string, sendAt: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!sendAt) return { ok: false, error: 'Pick a time to schedule' };
  const timingError = await checkTeamDraftTiming('contractor', id, sendAt);
  if (timingError) return { ok: false, error: timingError };
  return mapResult(await scheduleContractorApproval(id, sendAt));
}

/** Unschedule a queued send, returning the draft to the pending queue. */
export async function cancelContractorSchedule(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await cancelScheduleContractorApproval(id));
}

export async function coachContractorDraft(id: string, feedback: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = feedback.trim();
  if (!trimmed) return { ok: false, error: 'Add a coaching note before sending' };
  return mapResult(await coachContractorApproval(id, trimmed));
}

export async function saveContractorFacts(content: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await saveContractorCuratedFacts(content);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging/team');
  return { ok: true };
}
