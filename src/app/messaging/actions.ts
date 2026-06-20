'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  approveApproval,
  rejectApproval,
  coachApproval,
  markHandledApproval,
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
