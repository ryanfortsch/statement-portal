'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  approveOwnerApproval,
  rejectOwnerApproval,
  markHandledOwnerApproval,
  coachOwnerApproval,
  scheduleOwnerApproval,
  cancelScheduleOwnerApproval,
  saveOwnerCuratedFacts,
  explainError,
} from '@/lib/stay-concierge';

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireSession(): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return { ok: true };
}

export async function approveOwnerDraft(id: string, finalText?: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  // finalText is the operator's hand-edited reply. undefined => send the
  // AI draft as-is; a string => send that instead.
  const res = await approveOwnerApproval(id, finalText);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/owner-messaging');
  return { ok: true };
}

export async function rejectOwnerDraft(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await rejectOwnerApproval(id);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/owner-messaging');
  return { ok: true };
}

export async function markOwnerHandled(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await markHandledOwnerApproval(id);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/owner-messaging');
  return { ok: true };
}

/** Queue the draft to send at a future time (the send-later element).
 * `finalText` mirrors approve: the operator's hand-edited reply persists
 * before scheduling so the queued send fires the edited text. */
export async function scheduleOwnerDraft(
  id: string,
  sendAt: string,
  finalText?: string,
): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!sendAt) return { ok: false, error: 'Pick a time to schedule' };
  const res = await scheduleOwnerApproval(id, sendAt, finalText);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/owner-messaging');
  return { ok: true };
}

/** Unschedule a queued send, returning the draft to the pending queue. */
export async function cancelOwnerSchedule(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await cancelScheduleOwnerApproval(id);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/owner-messaging');
  return { ok: true };
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
  const res = await coachOwnerApproval(id, trimmed, base);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/owner-messaging');
  return { ok: true };
}

export async function saveOwnerFacts(content: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await saveOwnerCuratedFacts(content);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/owner-messaging');
  return { ok: true };
}
