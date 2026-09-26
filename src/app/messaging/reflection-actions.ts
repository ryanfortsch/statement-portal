'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  promoteReflectionProposal,
  dismissReflectionProposal,
  explainError,
} from '@/lib/stay-concierge';

export type ReflectionActionResult = { ok: true } | { ok: false; error: string };

/**
 * Adopt a reflection proposal as a curated fact.
 *
 * `rule` is the operator's own wording, prefilled from the proposal and
 * editable in the card. That edit is the point: whatever lands here goes into
 * the canonical layer, which outranks the property KB and the raw coaching
 * log on every future draft, so the text that becomes canon should be text a
 * person chose rather than text a model drafted.
 *
 * `scope` defaults to "all properties" because these proposals exist to catch
 * fleet-invariant rules. A per-property scope files it under that property's
 * section instead, where the responder's scoping split shows it only on that
 * home's drafts.
 */
export async function promoteProposal(
  id: string,
  rule: string,
  scope: string,
  topic: string,
): Promise<ReflectionActionResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: 'Not signed in' };

  const trimmed = rule.trim();
  if (!trimmed) return { ok: false, error: 'The rule cannot be empty' };

  const res = await promoteReflectionProposal(
    id,
    { rule: trimmed, scope: scope.trim() || 'all properties', topic: topic.trim() },
    email,
  );
  if (!res.ok) {
    // 409 means it was already decided, most likely in another tab.
    if (res.error.kind === 'http' && res.error.status === 409) {
      return { ok: false, error: 'Already decided. Refresh to see the current state.' };
    }
    return { ok: false, error: explainError(res.error) };
  }
  revalidatePath('/messaging');
  return { ok: true };
}

/** Turn a proposal down. Recorded so the weekly pass stops re-filing it. */
export async function dismissProposal(id: string, reason: string): Promise<ReflectionActionResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: 'Not signed in' };

  const res = await dismissReflectionProposal(id, reason.trim(), email);
  if (!res.ok) {
    if (res.error.kind === 'http' && res.error.status === 409) {
      return { ok: false, error: 'Already decided. Refresh to see the current state.' };
    }
    return { ok: false, error: explainError(res.error) };
  }
  revalidatePath('/messaging');
  return { ok: true };
}
