'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  approveOwnerApproval,
  rejectOwnerApproval,
  markHandledOwnerApproval,
  coachOwnerApproval,
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
