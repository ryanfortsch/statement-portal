'use server';

import { auth } from '@/auth';
import { resolveWalkthroughHome, updateWalkthrough } from '@/lib/home-walkthrough-db';
import { withHave, withNote } from '@/lib/home-walkthrough';

/**
 * Server actions for the outfitting walkthrough (OutfittingClient), in both
 * its modes: counting at the prospect visit (/prospects/<id>/readiness) and
 * ordering once the home is a property (/properties/<id>/order-checklist).
 * One home, one row: the target names whichever link the page has and the
 * other is resolved here.
 *
 * Signed-in only, as the two retired action sets were. No revalidatePath on
 * purpose: writes are optimistic client-side and a revalidate would flash
 * the loading state mid-tap.
 */

export type WalkthroughTarget = { projectionId: string } | { propertyId: string };

async function targetHome(target: WalkthroughTarget) {
  return resolveWalkthroughHome('propertyId' in target ? { propertyId: target.propertyId } : { projectionId: target.projectionId });
}

export async function setWalkthroughHaveAction(
  target: WalkthroughTarget,
  itemLabel: string,
  count: number,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const label = String(itemLabel ?? '').trim();
  if (!label || label.length > 200) return { ok: false, error: 'Unknown item' };
  const home = await targetHome(target);
  return updateWalkthrough(home, (s) => withHave(s, label, count), session.user.email);
}

export async function setWalkthroughNoteAction(
  target: WalkthroughTarget,
  noteKey: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const key = String(noteKey ?? '').trim();
  if (!/^[a-z_]{1,40}$/.test(key)) return { ok: false, error: 'Unknown note' };
  const home = await targetHome(target);
  return updateWalkthrough(home, (s) => withNote(s, key, String(value ?? '').slice(0, 5000)), session.user.email);
}
