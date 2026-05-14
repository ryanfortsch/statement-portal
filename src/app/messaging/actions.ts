'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  approveApproval,
  rejectApproval,
  coachApproval,
  explainError,
} from '@/lib/stay-concierge';

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireSession(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return { ok: true };
}

export async function approveDraft(approvalId: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const result = await approveApproval(approvalId);
  if (!result.ok) return { ok: false, error: explainError(result.error) };
  revalidatePath('/messaging');
  return { ok: true };
}

export async function rejectDraft(approvalId: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const result = await rejectApproval(approvalId);
  if (!result.ok) return { ok: false, error: explainError(result.error) };
  revalidatePath('/messaging');
  return { ok: true };
}

export async function coachDraft(approvalId: string, feedback: string): Promise<ActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const trimmed = feedback.trim();
  if (!trimmed) return { ok: false, error: 'Add a coaching note before sending' };
  const result = await coachApproval(approvalId, trimmed);
  if (!result.ok) return { ok: false, error: explainError(result.error) };
  revalidatePath('/messaging');
  return { ok: true };
}
