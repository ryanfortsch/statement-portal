'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  approveCleanerApproval,
  markHandledCleanerApproval,
  coachCleanerApproval,
  scheduleCleanerApproval,
  cancelScheduleCleanerApproval,
  editTeamApproval,
  redraftTeamApproval,
  undoTeamApproval,
  saveCleanerCuratedFacts,
  explainError,
  explainUndoRefusal,
  isStaleConflict,
  type MarkHandledCapture,
  type StayConciergeError,
} from '@/lib/stay-concierge';

/** `stale` means the card moved on under the operator (a coached rewrite
 *  replaced it, someone else decided it): the card refreshes instead of
 *  showing a red error. */
export type ActionResult = { ok: true } | { ok: false; error: string; stale?: boolean };

type ClientResult = { ok: true } | { ok: false; error: StayConciergeError };

function mapResult(res: ClientResult): ActionResult {
  if (res.ok) {
    revalidatePath('/cleaner-messaging');
    return { ok: true };
  }
  return { ok: false, error: explainError(res.error), stale: isStaleConflict(res.error) };
}

async function requireSession(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return { ok: true, email: session.user.email };
}

/** `opts` carries the card's proposed-work-slip decision (file it or not,
 * and to which property). Omitted for cards without a proposal, in which
 * case the backend applies its inferred defaults. */
export async function approveCleanerDraft(
  id: string,
  opts?: { fileSlip?: boolean; slipPropertyId?: string },
): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await approveCleanerApproval(id, opts));
}

/** Clear the card without sending. `capture` is why (a reason) and, when the
 *  operator replied elsewhere, what she sent. Undo puts it back. */
export async function markCleanerHandled(id: string, capture?: MarkHandledCapture): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await markHandledCleanerApproval(id, capture, sess.email));
}

/** Reverse a Mark handled: the card returns exactly as it was. */
export async function undoCleanerDecision(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await undoTeamApproval('cleaner', id, sess.email);
  if (res.ok) {
    revalidatePath('/cleaner-messaging');
    return { ok: true };
  }
  const e = res.error;
  if (e.kind === 'http' && e.status === 409) return { ok: false, error: explainUndoRefusal(e.detail, 'them') };
  return { ok: false, error: explainError(e) };
}

/** Edit changes this reply only: the operator's words become the draft. */
export async function editCleanerDraft(id: string, text: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'The reply cannot be empty' };
  return mapResult(await editTeamApproval('cleaner', id, trimmed));
}

/** Re-run the draft on today's data. Nothing is sent and nothing is taught. */
export async function redraftCleanerDraft(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await redraftTeamApproval('cleaner', id, sess.email));
}

/** Queue the draft to send at a future time (the send-later element). The
 * card disables this when a work-slip proposal is present. */
export async function scheduleCleanerDraft(id: string, sendAt: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!sendAt) return { ok: false, error: 'Pick a time to schedule' };
  return mapResult(await scheduleCleanerApproval(id, sendAt));
}

/** Unschedule a queued send, returning the draft to the pending queue. */
export async function cancelCleanerSchedule(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await cancelScheduleCleanerApproval(id));
}

export async function coachCleanerDraft(id: string, feedback: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = feedback.trim();
  if (!trimmed) return { ok: false, error: 'Add a coaching note before sending' };
  return mapResult(await coachCleanerApproval(id, trimmed));
}

export async function saveCleanerFacts(content: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await saveCleanerCuratedFacts(content);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/cleaner-messaging');
  return { ok: true };
}
