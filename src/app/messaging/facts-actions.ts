'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  editFact,
  softDeleteFact,
  restoreFact,
  createFact,
  explainError,
} from '@/lib/stay-concierge';

export type FactActionResult = { ok: true } | { ok: false; error: string };

async function requireSession(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return { ok: true };
}

export async function editFactAction(
  id: string,
  patch: { fact?: string; scope?: string; topic?: string },
): Promise<FactActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (patch.fact !== undefined && !patch.fact.trim()) {
    return { ok: false, error: 'Fact text cannot be empty' };
  }
  const res = await editFact(id, patch);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging');
  return { ok: true };
}

export async function deleteFactAction(id: string): Promise<FactActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await softDeleteFact(id);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging');
  return { ok: true };
}

export async function restoreFactAction(id: string): Promise<FactActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  const res = await restoreFact(id);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging');
  return { ok: true };
}

export async function createFactAction(args: {
  fact: string;
  scope: string;
  topic: string;
}): Promise<FactActionResult> {
  const sess = await requireSession();
  if (!sess.ok) return sess;
  if (!args.fact.trim()) return { ok: false, error: 'Fact text required' };
  if (!args.scope.trim()) return { ok: false, error: 'Scope required (a property slug like 53_rocky_neck, or all properties, voice, or process)' };
  const res = await createFact({
    fact: args.fact.trim(),
    scope: args.scope.trim(),
    topic: args.topic.trim(),
  });
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging');
  return { ok: true };
}
