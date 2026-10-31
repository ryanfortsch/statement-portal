'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { completeVendorVisit } from '@/lib/vendor-visit-complete';
import type { CardResult } from '@/components/messaging/card/types';
import type { ApproveInput } from '@/lib/vendor-visit-core';
import {
  approveVendorVisit,
  editVendorVisit,
  markVendorVisitHandled,
  undoVendorVisitHandled,
  type VisitActionResult,
  type VisitEdit,
} from '@/lib/vendor-visit-approve';

/**
 * The vendor visit card's verbs (docs/vendor-visit-holds.md). Approve is the
 * only door to the calendar hold and the slip stamps, and it needs a
 * signed-in operator: the Quo ingest that filed the card cannot reach it.
 * Staff may approve; a vendor visit moves no money.
 */

async function operator(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

function card(res: VisitActionResult, { showMessage }: { showMessage: boolean }): CardResult {
  if (!res.ok) return { ok: false, error: res.error, stale: res.stale };
  revalidatePath('/messaging/team');
  revalidatePath('/');
  const notice = [showMessage ? res.message : null, res.warning ?? null].filter(Boolean).join(' ');
  return notice ? { ok: true, warning: notice } : { ok: true };
}

export async function completeVendorVisitAction(id: string, slipIds: string[]): Promise<CardResult> {
  const who = await operator();
  if (!who) return { ok: false, error: 'Not signed in' };
  try {
    const res = await completeVendorVisit(supabaseAdmin, id, slipIds, who);
    if (!res.ok) return res;
    revalidatePath('/work');
    revalidatePath('/properties');
    if (res.propertyId) revalidatePath(`/properties/${res.propertyId}`);
    for (const slipId of res.slipIds) revalidatePath(`/work/${slipId}`);
    return card({ ok: true, message: slipIds.length ? `Visit closed. ${slipIds.length} job${slipIds.length === 1 ? '' : 's'} marked complete.` : 'Visit closed.' }, { showMessage: true });
  } catch (e) {
    return failed(e);
  }
}

function failed(e: unknown): CardResult {
  return { ok: false, error: e instanceof Error ? e.message : 'That did not go through. Try again.' };
}

/** Hold the calendar and schedule the ticked slips, as the card shows them. */
export async function approveVendorVisitAction(id: string, input: ApproveInput): Promise<CardResult> {
  const who = await operator();
  if (!who) return { ok: false, error: 'Not signed in' };
  try {
    const res = await approveVendorVisit(id, input, who);
    if (res.ok) {
      revalidatePath('/work');
      revalidatePath('/turnovers');
      revalidatePath('/channels/calendar');
    }
    // What was held, in one line, so the operator sees it land.
    return card(res, { showMessage: true });
  } catch (e) {
    return failed(e);
  }
}

/** Answer the card's question or correct it: home, day, time. */
export async function editVendorVisitAction(id: string, edit: VisitEdit): Promise<CardResult> {
  const who = await operator();
  if (!who) return { ok: false, error: 'Not signed in' };
  try {
    return card(await editVendorVisit(id, edit, who), { showMessage: false });
  } catch (e) {
    return failed(e);
  }
}

export async function markVendorVisitHandledAction(id: string, reason?: string): Promise<CardResult> {
  const who = await operator();
  if (!who) return { ok: false, error: 'Not signed in' };
  try {
    return card(await markVendorVisitHandled(id, reason?.trim() || null, who), { showMessage: false });
  } catch (e) {
    return failed(e);
  }
}

export async function undoVendorVisitAction(id: string): Promise<CardResult> {
  const who = await operator();
  if (!who) return { ok: false, error: 'Not signed in' };
  try {
    return card(await undoVendorVisitHandled(id), { showMessage: false });
  } catch (e) {
    return failed(e);
  }
}
