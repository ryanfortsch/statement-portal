'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  approveCleanerApproval,
  rejectCleanerApproval,
  markHandledCleanerApproval,
  coachCleanerApproval,
  saveCleanerCuratedFacts,
  explainError,
} from '@/lib/stay-concierge';

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireSession(): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return { ok: true };
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
  const res = await approveCleanerApproval(id, opts);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/cleaner-messaging');
  return { ok: true };
}

export async function rejectCleanerDraft(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await rejectCleanerApproval(id);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/cleaner-messaging');
  return { ok: true };
}

export async function markCleanerHandled(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await markHandledCleanerApproval(id);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/cleaner-messaging');
  return { ok: true };
}

export async function coachCleanerDraft(id: string, feedback: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = feedback.trim();
  if (!trimmed) return { ok: false, error: 'Add a coaching note before sending' };
  const res = await coachCleanerApproval(id, trimmed);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/cleaner-messaging');
  return { ok: true };
}

export async function saveCleanerFacts(content: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await saveCleanerCuratedFacts(content);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/cleaner-messaging');
  return { ok: true };
}
