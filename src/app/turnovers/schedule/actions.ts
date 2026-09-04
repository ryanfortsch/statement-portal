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
import { insertAdjustment, normalizeTime, ScheduleUnavailableError } from '@/lib/checkout-schedule';
import {
  setAutosend,
  withOperatorNote,
  upsertDigestDraft,
  sendDigest,
  composeDigestBodyLive,
  tomorrowET,
} from '@/lib/cleaner-digest';
import { buildCheckoutSchedule } from '@/lib/checkout-schedule';
import { mineCheckoutChanges } from '@/lib/mine-checkout-changes';
import { detectExtensionHolds } from '@/lib/extension-holds';

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
  const note = String(formData.get('note') || '').trim().slice(0, 600);
  let finalBody = body;
  if (body === draftedBody.trim() && /^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    // An unedited approval recomposes from the LIVE schedule. If that
    // schedule cannot be built right now, do not send anything at all:
    // the stored draft may be stale and an empty day would read as "no
    // checkouts". Fail loudly back to the card instead.
    // A hold placed after the afternoon cron (the payment landed at 5pm)
    // must reach a 6pm send. Hold detection is deterministic and cheap, so
    // it runs again right here; a failure in it never blocks the send.
    try { await detectExtensionHolds(supabase); } catch { /* fail-soft */ }
    try {
      const [day] = await buildCheckoutSchedule(supabase, { startDate: serviceDate, days: 1 });
      finalBody = await composeDigestBodyLive(supabase, day);
    } catch (err) {
      if (err instanceof ScheduleUnavailableError) redirect(`${CARD}?err=schedule_unavailable#schedule-digest`);
      throw err;
    }
  }
  // Persist the note first so a failed send never costs the typing, then
  // append it after the (possibly recomposed) schedule.
  await supabase
    .from('cleaner_schedule_digests')
    .update({ operator_note: note, updated_at: new Date().toISOString() })
    .eq('id', digestId);
  finalBody = withOperatorNote(finalBody, note);

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

  // An update exists to carry CHANGED truth: always compose fresh, and
  // refuse entirely if the truth cannot be read right now.
  try { await detectExtensionHolds(supabase); } catch { /* fail-soft */ }
  let day;
  try {
    [day] = await buildCheckoutSchedule(supabase, { startDate: serviceDate, days: 1 });
  } catch (err) {
    if (err instanceof ScheduleUnavailableError) redirect(backTarget(formData, '?err=schedule_unavailable#schedule-digest'));
    throw err;
  }
  const { data: noteRow } = await supabase
    .from('cleaner_schedule_digests')
    .select('operator_note')
    .eq('id', digestId)
    .maybeSingle();
  const body = withOperatorNote(
    `${await composeDigestBodyLive(supabase, day)}\n\n(atualizacao / updated schedule)`,
    (noteRow as { operator_note?: string } | null)?.operator_note,
  );

  const res = await sendDigest(supabase, { digestId, body, operatorEmail: email, kind: 'update' });
  revalidatePath(CARD);
  revalidatePath(PAGE);
  if (!res.ok) redirect(backTarget(formData, `?err=${res.error}#schedule-digest`));
  redirect(backTarget(formData, `?sent=${res.sentCount}#schedule-digest`));
}

/** "Skip this day": nothing goes out and the card clears. Reversible with
 *  "Draft tomorrow's digest", which revives a skipped row to pending. */
/** Operator's kill switch for the unattended evening send. */
export async function toggleAutosendAction(formData: FormData): Promise<void> {
  const email = await requireEmail();
  await setAutosend(supabase, String(formData.get('enabled') || '') === 'true', email);
  revalidatePath(CARD);
  revalidatePath(PAGE);
  redirect(backTarget(formData, '#schedule-digest'));
}

export async function skipDigestAction(formData: FormData): Promise<void> {
  await requireEmail();
  const digestId = String(formData.get('digestId') || '');
  if (digestId) {
    await supabase
      .from('cleaner_schedule_digests')
      .update({ status: 'skipped', updated_at: new Date().toISOString() })
      .eq('id', digestId)
      .eq('status', 'pending');
  }
  revalidatePath(CARD);
  revalidatePath(PAGE);
  redirect(backTarget(formData, '?skipped=1#schedule-digest'));
}

export async function refreshDigestDraft(formData: FormData): Promise<void> {
  await requireEmail();
  const serviceDate = String(formData.get('serviceDate') || tomorrowET());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) redirect(CARD_ANCHOR);
  // Refreshing the schedule must not silently discard a note already typed.
  const digestId = String(formData.get('digestId') || '');
  if (digestId) {
    await supabase
      .from('cleaner_schedule_digests')
      .update({ operator_note: String(formData.get('note') || '').trim().slice(0, 600), updated_at: new Date().toISOString() })
      .eq('id', digestId);
  }
  try {
    await upsertDigestDraft(supabase, serviceDate);
  } catch (err) {
    if (err instanceof ScheduleUnavailableError) redirect(backTarget(formData, '?err=schedule_unavailable#schedule-digest'));
    throw err;
  }
  revalidatePath(CARD);
  redirect(backTarget(formData, '#schedule-digest'));
}

/** The card's "Re-scan messages": a bounded mining pass so an agreement
 *  from an hour ago reaches the draft before approval. */
export async function rescanMessagesAction(formData: FormData): Promise<void> {
  await requireEmail();
  const serviceDate = String(formData.get('serviceDate') || tomorrowET());
  try {
    await detectExtensionHolds(supabase);
  } catch {
    // Fail-soft: the thread pass below still runs.
  }
  try {
    await mineCheckoutChanges(supabase, { sinceHours: 72, maxThreads: 10 });
  } catch {
    // Fail-soft: the refreshed draft below still reflects operator truth.
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    try {
      await upsertDigestDraft(supabase, serviceDate);
    } catch (err) {
      if (err instanceof ScheduleUnavailableError) redirect(backTarget(formData, '?err=schedule_unavailable#schedule-digest'));
      throw err;
    }
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
  const dateValid = !rawDate || /^\d{4}-\d{2}-\d{2}$/.test(rawDate);
  // The form pre-fills the date with the stay's own checkout, so a
  // time-only edit arrives as date == originalCheckOut. Storing that PINS
  // the date as operator truth, and a real Guesty extension the next day
  // then reads as a conflict with a row that never meant to say anything
  // about the date. The stay's own checkout is "no date change".
  const date = rawDate && dateValid && rawDate !== originalCheckOut ? rawDate : null;
  if (rawTime && !time) redirect(`${PAGE}?err=bad_time${anchor}`);
  if (!dateValid) redirect(`${PAGE}?err=bad_date${anchor}`);
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
  // The standing row is read by id first so a promote that does not land
  // (the proposal was dismissed or applied in another tab between the two
  // writes) can put it back. Otherwise the stay is left with NO active row
  // and silently falls back to Guesty truth.
  const { data: standingRow, error: standingErr } = await supabase
    .from('checkout_adjustments')
    .select('id, adjusted_check_out, adjusted_checkout_time')
    .eq('property_id', row.property_id)
    .eq('stay_check_in', row.stay_check_in)
    .eq('status', 'active')
    .maybeSingle();
  if (standingErr) redirect(backTarget(formData, '?err=apply_failed'));
  const standing = standingRow as
    | { id: string; adjusted_check_out: string | null; adjusted_checkout_time: string | null }
    | null;
  const standingId = standing?.id ?? null;
  const now = new Date().toISOString();
  if (standingId) {
    const { error: supErr } = await supabase
      .from('checkout_adjustments')
      .update({ status: 'superseded', updated_at: now })
      .eq('id', standingId)
      .eq('status', 'active');
    if (supErr) redirect(backTarget(formData, '?err=apply_failed'));
  }
  // A proposal carries only the axis it is about. The miner merges against
  // whatever stood WHEN IT WAS FILED, so a time-only proposal filed before
  // an extension landed still has a null date, and promoting it verbatim
  // would supersede the extension and leave the stay with no date at all:
  // it would fall back to Guesty's earlier checkout, putting cleaners in an
  // occupied house and leaving the real turnover on nobody's list. Merge at
  // APPLY time instead, against what actually stands now. The proposal wins
  // every axis it actually sets; the standing row keeps the rest.
  const mergedCheckOut = row.adjusted_check_out ?? standing?.adjusted_check_out ?? null;
  const mergedTime = row.adjusted_checkout_time ?? standing?.adjusted_checkout_time ?? null;
  const { data: promoted, error } = await supabase
    .from('checkout_adjustments')
    .update({
      status: 'active',
      adjusted_check_out: mergedCheckOut,
      adjusted_checkout_time: mergedTime,
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'proposed')
    .select('id')
    .maybeSingle();
  const landed = !error && !!promoted;
  if (!landed && standingId) {
    await supabase
      .from('checkout_adjustments')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', standingId)
      .eq('status', 'superseded');
  }
  revalidatePath(PAGE);
  revalidatePath(CARD);
  redirect(backTarget(formData, landed ? '?applied=1' : '?err=apply_failed'));
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
