'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  approveContractorApproval,
  rejectContractorApproval,
  markHandledContractorApproval,
  coachContractorApproval,
  saveContractorCuratedFacts,
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
export async function approveContractorDraft(
  id: string,
  opts?: { fileSlip?: boolean; slipPropertyId?: string },
): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await approveContractorApproval(id, opts);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/contractor-messaging');
  return { ok: true };
}

export async function rejectContractorDraft(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await rejectContractorApproval(id);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/contractor-messaging');
  return { ok: true };
}

export async function markContractorHandled(id: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await markHandledContractorApproval(id);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/contractor-messaging');
  return { ok: true };
}

export async function coachContractorDraft(id: string, feedback: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = feedback.trim();
  if (!trimmed) return { ok: false, error: 'Add a coaching note before sending' };
  const res = await coachContractorApproval(id, trimmed);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/contractor-messaging');
  return { ok: true };
}

export async function saveContractorFacts(content: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await saveContractorCuratedFacts(content);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/contractor-messaging');
  return { ok: true };
}
