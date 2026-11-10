'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import type { CardResult } from '@/components/messaging/card/types';
import {
  approveCleaningReview,
  editCleaningNotice,
  markCleaningReviewHandled,
  undoCleaningReviewHandled,
  type ReviewActionResult,
} from '@/lib/cleaning-reviews';

/**
 * The cleaning review card's verbs (docs/cleaning-reviews.md). Approve is
 * the only door to the crew's phone and needs a signed-in operator; the
 * walk that filed the card cannot reach it. Staff may approve: a note to
 * the crew moves no money.
 */

async function operator(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

function card(res: ReviewActionResult): CardResult {
  if (!res.ok) return { ok: false, error: res.error, stale: res.stale };
  revalidatePath('/messaging/team');
  revalidatePath('/me');
  return res.message ? { ok: true, warning: res.message } : { ok: true };
}

function failed(e: unknown): CardResult {
  return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
}

export async function approveCleaningReviewAction(id: string): Promise<CardResult> {
  const who = await operator();
  if (!who) return { ok: false, error: 'Not signed in' };
  try {
    return card(await approveCleaningReview(id, who));
  } catch (e) {
    return failed(e);
  }
}

export async function editCleaningReviewAction(id: string, text: string): Promise<CardResult> {
  const who = await operator();
  if (!who) return { ok: false, error: 'Not signed in' };
  try {
    return card(await editCleaningNotice(id, text));
  } catch (e) {
    return failed(e);
  }
}

export async function markCleaningReviewHandledAction(id: string, reason?: string): Promise<CardResult> {
  const who = await operator();
  if (!who) return { ok: false, error: 'Not signed in' };
  try {
    return card(await markCleaningReviewHandled(id, reason, who));
  } catch (e) {
    return failed(e);
  }
}

export async function undoCleaningReviewAction(id: string): Promise<CardResult> {
  const who = await operator();
  if (!who) return { ok: false, error: 'Not signed in' };
  try {
    return card(await undoCleaningReviewHandled(id));
  } catch (e) {
    return failed(e);
  }
}
