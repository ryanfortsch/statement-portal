'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import {
  approveOwnerApproval,
  markHandledOwnerApproval,
  coachOwnerApproval,
  scheduleOwnerApproval,
  cancelScheduleOwnerApproval,
  editTeamApproval,
  redraftTeamApproval,
  undoTeamApproval,
  saveOwnerCuratedFacts,
  explainError,
  explainUndoRefusal,
  isStaleConflict,
  type MarkHandledCapture,
  type StayConciergeError,
} from '@/lib/stay-concierge';

/** `stale` means the card moved on under the operator: the card refreshes
 *  instead of showing a red error. */
export type ActionResult = { ok: true } | { ok: false; error: string; stale?: boolean };

type ClientResult = { ok: true } | { ok: false; error: StayConciergeError };

function mapResult(res: ClientResult): ActionResult {
  if (res.ok) {
    revalidatePath('/owner-messaging');
    return { ok: true };
  }
  return { ok: false, error: explainError(res.error), stale: isStaleConflict(res.error) };
}

async function requireSession(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return { ok: true, email: session.user.email };
}

export async function approveOwnerDraft(
  id: string,
  finalText?: string,
  opts?: { fileActions?: boolean },
): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  // finalText is the operator's hand-edited reply. undefined => send the
  // AI draft as-is; a string => send that instead. fileActions false means
  // the operator unticked the proposed slips and cleaner notes.
  return mapResult(await approveOwnerApproval(id, finalText, opts));
}

/** Clear the card without sending. Ticked follow-up work still files;
 *  `capture` is why, and what she sent if she replied elsewhere. */
export async function markOwnerHandled(id: string, fileActions = true, capture?: MarkHandledCapture): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await markHandledOwnerApproval(id, fileActions, capture, sess.email));
}

/** Reverse a Mark handled: the card returns exactly as it was. */
export async function undoOwnerDecision(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await undoTeamApproval('owner', id, sess.email);
  if (res.ok) {
    revalidatePath('/owner-messaging');
    return { ok: true };
  }
  const e = res.error;
  if (e.kind === 'http' && e.status === 409) return { ok: false, error: explainUndoRefusal(e.detail, 'them') };
  return { ok: false, error: explainError(e) };
}

/** Edit changes this reply only: the operator's words become the draft, and
 *  the concierge re-checks the follow-up work against them. */
export async function editOwnerDraft(id: string, text: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'The reply cannot be empty' };
  return mapResult(await editTeamApproval('owner', id, trimmed));
}

/** Re-run the draft on today's data. Nothing is sent and nothing is taught. */
export async function redraftOwnerDraft(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await redraftTeamApproval('owner', id, sess.email));
}

/** Queue the draft to send at a future time (the send-later element).
 * `finalText` mirrors approve: the operator's hand-edited reply persists
 * before scheduling so the queued send fires the edited text. */
export async function scheduleOwnerDraft(
  id: string,
  sendAt: string,
  finalText?: string,
  fileActions = true,
): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!sendAt) return { ok: false, error: 'Pick a time to schedule' };
  return mapResult(await scheduleOwnerApproval(id, sendAt, finalText, fileActions));
}

/** Unschedule a queued send, returning the draft to the pending queue. */
export async function cancelOwnerSchedule(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  return mapResult(await cancelScheduleOwnerApproval(id));
}

export async function coachOwnerDraft(
  id: string,
  feedback: string,
  base?: string,
): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = feedback.trim();
  if (!trimmed) return { ok: false, error: 'Add a coaching note before sending' };
  // base is the operator's hand-edited draft; regen builds on it so tweaks
  // aren't discarded by the rewrite.
  return mapResult(await coachOwnerApproval(id, trimmed, base));
}

/** Owners only: the editor renders on the staff-open Quality lens for owner
 *  sessions, and a server action is reachable from any page. */
export async function saveOwnerFacts(content: string): Promise<ActionResult> {
  try {
    await requireOwnerEmail();
  } catch {
    return { ok: false, error: 'Only an owner can change the owner rules.' };
  }
  const res = await saveOwnerCuratedFacts(content);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging/quality');
  return { ok: true };
}
