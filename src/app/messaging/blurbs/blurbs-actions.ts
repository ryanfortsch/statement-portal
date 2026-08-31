'use server';

import { revalidatePath } from 'next/cache';
import {
  createBlurb,
  editBlurb,
  setBlurbStatus,
  explainError,
  type SavedBlurb,
} from '@/lib/stay-concierge';

/** Server actions behind /messaging/blurbs. Thin passthroughs to the
 * stay-concierge blurb API; every mutation revalidates the page. */

type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveBlurbAction(
  id: string,
  fields: Partial<Pick<SavedBlurb, 'title' | 'body' | 'category' | 'scope'>>,
): Promise<ActionResult> {
  const res = await editBlurb(id, fields);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging/blurbs');
  return { ok: true };
}

export async function setBlurbStatusAction(
  id: string,
  action: 'approve' | 'unapprove' | 'retire',
): Promise<ActionResult> {
  const res = await setBlurbStatus(id, action);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging/blurbs');
  return { ok: true };
}

export async function createBlurbAction(input: {
  scope: string;
  category: string;
  title: string;
  body: string;
}): Promise<ActionResult> {
  const res = await createBlurb({ ...input, source_note: 'authored in Helm' });
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  revalidatePath('/messaging/blurbs');
  return { ok: true };
}
