'use server';

/**
 * Server actions for the cleaner checkout schedule: the digest card on
 * /cleaner-messaging and the schedule workroom at /turnovers/schedule.
 *
 * House landing rules: every exit is a redirect back to where the acted-on
 * thing lives, anchored, with ?err=<code> carrying failures.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { insertAdjustment, normalizeTime } from '@/lib/checkout-schedule';
import {
  upsertDigestDraft,
  sendDigest,
  composeDigestBody,
  tomorrowET,
} from '@/lib/cleaner-digest';
import { buildCheckoutSchedule } from '@/lib/checkout-schedule';
import { mineCheckoutChanges } from '@/lib/mine-checkout-changes';

const CARD = '/cleaner-messaging';
const CARD_ANCHOR = `${CARD}#schedule-digest`;
const PAGE = '/turnovers/schedule';

async function requireEmail(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect('/auth/signin');
  return email!;
}

/** The two surfaces these shared actions land back on. Anything else
 *  collapses to the schedule page (open-redirect guard). */
function backTarget(formData: FormData, anchor: string): string {
  const back = String(formData.get('back') || '');
  const base = back === 'card' ? CARD : PAGE;
  return `${base}${anchor}`;
}

// ─── digest card ──────────────────────────────────────────────────────

export async function approveAndSendDigest(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const digestId = String(formData.get('digestId') || '');
  const body = String(formData.get('body') || '').trim();
  if (!digestId || !body) redirect(`${CARD}?err=digest_empty#schedule-digest`);

  // Staleness guard: if the operator did NOT edit the drafted text, send
  // the LIVE schedule composed right now, not the cron-time snapshot - an
  // adjustment logged after the draft must reach Rosa. An edited body is
  // her words and goes verbatim.
  const serviceDate = String(formData.get('serviceDate') || '');
  const draftedBody = String(formData.get('draftedBody') || '');
  let finalBody = body;
  if (body === draftedBody.trim() && /^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    const [day] = await buildCheckoutSchedule(supabase, { startDate: serviceDate, days: 1 });
    finalBody = composeDigestBody(day);
  }

  const res = await sendDigest(supabase, { digestId, body: finalBody, operatorEmail: email, kind: 'initial' });
  revalidatePath(CARD);
  revalidatePath(PAGE);
  if (!res.ok) redirect(`${CARD}?err=${res.error}#schedule-digest`);
  redirect(`${CARD}?sent=${res.sentCount}${res.failed.length ? `&failed=${res.failed.length}` : ''}#schedule-digest`);
}

export async function sendDigestUpdate(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const digestId = String(formData.get('digestId') || '');
  const serviceDate = String(formData.get('serviceDate') || '');
  if (!digestId || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) redirect(CARD_ANCHOR);

  // An update exists to carry CHANGED truth: always compose fresh.
  const [day] = await buildCheckoutSchedule(supabase, { startDate: serviceDate, days: 1 });
  const body = `${composeDigestBody(day)}\n\n(atualizacao / updated schedule)`;

  const res = await sendDigest(supabase, { digestId, body, operatorEmail: email, kind: 'update' });
  revalidatePath(CARD);
  revalidatePath(PAGE);
  if (!res.ok) redirect(backTarget(formData, `?err=${res.error}#schedule-digest`));
  redirect(backTarget(formData, `?sent=${res.sentCount}#schedule-digest`));
}

export async function refreshDigestDraft(formData: FormData): Promise<void> {
  await requireEmail();
  const serviceDate = String(formData.get('serviceDate') || tomorrowET());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) redirect(CARD_ANCHOR);
  await upsertDigestDraft(supabase, serviceDate);
  revalidatePath(CARD);
  redirect(backTarget(formData, '#schedule-digest'));
}

/** The card's "Re-scan messages": a bounded mining pass so an agreement
 *  from an hour ago reaches the draft before approval. */
export async function rescanMessagesAction(formData: FormData): Promise<void> {
  await requireEmail();
  const serviceDate = String(formData.get('serviceDate') || tomorrowET());
  try {
    await mineCheckoutChanges(supabase, { sinceHours: 72, maxThreads: 10 });
  } catch {
    // Fail-soft: the refreshed draft below still reflects operator truth.
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    await upsertDigestDraft(supabase, serviceDate);
  }
  revalidatePath(CARD);
  revalidatePath(PAGE);
  redirect(backTarget(formData, '#schedule-digest'));
}

export async function toggleRecipientAction(formData: FormData): Promise<void> {
  await requireEmail();
  const phone = String(formData.get('phone') || '');
  const enabled = String(formData.get('enabled') || '') === 'true';
  if (phone) {
    await supabase
      .from('cleaner_schedule_recipients')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('phone', phone);
  }
  revalidatePath(CARD);
  revalidatePath(PAGE);
  redirect(backTarget(formData, '#schedule-recipients'));
}

// ─── adjustments (schedule workroom + card proposals) ─────────────────

export async function saveAdjustmentAction(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const propertyId = String(formData.get('propertyId') || '');
  const stayCheckIn = String(formData.get('stayCheckIn') || '');
  const originalCheckOut = String(formData.get('originalCheckOut') || '');
  const rawTime = String(formData.get('newTime') || '').trim();
  const rawDate = String(formData.get('newDate') || '').trim();
  const note = String(formData.get('note') || '').trim().slice(0, 300);

  const anchor = `#stay-${propertyId}-${stayCheckIn}`;
  if (!propertyId || !/^\d{4}-\d{2}-\d{2}$/.test(stayCheckIn) || !/^\d{4}-\d{2}-\d{2}$/.test(originalCheckOut)) {
    redirect(`${PAGE}?err=bad_stay`);
  }
  const time = rawTime ? normalizeTime(rawTime) : null;
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  if (rawTime && !time) redirect(`${PAGE}?err=bad_time${anchor}`);
  if (rawDate && !date) redirect(`${PAGE}?err=bad_date${anchor}`);
  if (!time && !date) redirect(`${PAGE}?err=nothing_set${anchor}`);
  if (date && date < stayCheckIn) redirect(`${PAGE}?err=date_before_checkin${anchor}`);

  await insertAdjustment(supabase, {
    propertyId,
    stayCheckIn,
    originalCheckOut,
    adjustedCheckOut: date,
    adjustedCheckoutTime: time,
    note,
    source: 'operator',
    createdBy: email,
  });
  revalidatePath(PAGE);
  revalidatePath(CARD);
  redirect(`${backTarget(formData, `?saved=1${anchor}`)}`);
}

/** Dismiss the ACTIVE adjustment on a stay: back to Guesty truth. */
export async function removeAdjustmentAction(formData: FormData): Promise<void> {
  await requireEmail();
  const id = String(formData.get('id') || '');
  if (id) {
    await supabase
      .from('checkout_adjustments')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'active');
  }
  revalidatePath(PAGE);
  revalidatePath(CARD);
  redirect(backTarget(formData, '?removed=1'));
}

export async function applyProposalAction(formData: FormData): Promise<void> {
  await requireEmail();
  const id = String(formData.get('id') || '');
  if (!id) redirect(backTarget(formData, ''));

  const { data: row } = await supabase
    .from('checkout_adjustments')
    .select('*')
    .eq('id', id)
    .eq('status', 'proposed')
    .maybeSingle();
  if (!row) redirect(`${backTarget(formData, '?err=proposal_gone')}`);

  // Supersede the standing active adjustment for the stay, then promote.
  await supabase
    .from('checkout_adjustments')
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('property_id', row.property_id)
    .eq('stay_check_in', row.stay_check_in)
    .eq('status', 'active');
  const { error } = await supabase
    .from('checkout_adjustments')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'proposed');
  revalidatePath(PAGE);
  revalidatePath(CARD);
  redirect(backTarget(formData, error ? '?err=apply_failed' : '?applied=1'));
}

export async function dismissProposalAction(formData: FormData): Promise<void> {
  await requireEmail();
  const id = String(formData.get('id') || '');
  if (id) {
    await supabase
      .from('checkout_adjustments')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'proposed');
  }
  revalidatePath(PAGE);
  revalidatePath(CARD);
  redirect(backTarget(formData, '?dismissed=1'));
}

// ─── per-property default times ───────────────────────────────────────

export async function saveDefaultTimesAction(formData: FormData): Promise<void> {
  await requireEmail();
  const propertyId = String(formData.get('propertyId') || '');
  const checkout = normalizeTime(String(formData.get('checkoutTime') || ''));
  const checkin = normalizeTime(String(formData.get('checkinTime') || ''));
  if (!propertyId) redirect(`${PAGE}?err=bad_property`);
  if (!checkout || !checkin) redirect(`${PAGE}?err=bad_time#times-${propertyId}`);

  const { data } = await supabase
    .from('properties')
    .update({ default_checkout_time: checkout, default_checkin_time: checkin })
    .eq('id', propertyId)
    .select('id');
  if (!data || data.length === 0) redirect(`${PAGE}?err=save_failed#times-${propertyId}`);
  revalidatePath(PAGE);
  revalidatePath(CARD);
  redirect(`${PAGE}?saved=1#times-${propertyId}`);
}

/** Cron freshness guard: a visit before the cron has drafted tomorrow
 *  simply drafts it inline and lands on the card. */
export async function ensureTomorrowDraft(): Promise<void> {
  await requireEmail();
  await upsertDigestDraft(supabase, tomorrowET());
  revalidatePath(PAGE);
  revalidatePath(CARD);
  redirect(CARD_ANCHOR);
}
