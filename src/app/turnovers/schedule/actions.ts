'use server';

/**
 * Server actions for the cleaner checkout schedule: the digest card on
 * /cleaner-messaging and the schedule workroom at /turnovers/schedule.
 *
 * House landing rules: every exit is a redirect back to where the acted-on
 * thing lives, anchored, with ?err=<code> carrying failures.
 */

import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { insertAdjustment, normalizeTime, ScheduleUnavailableError } from '@/lib/checkout-schedule';
import {
  setAutosend,
  upsertDigestDraft,
  sendDigest,
  tomorrowET,
  normalizeLanguage,
} from '@/lib/cleaner-digest';
import { CAPE_ANN_REGION, REGION_LABELS } from '@/lib/property-scope';
import { normalizePhone } from '@/lib/quo-lines';
import { mineCheckoutChanges } from '@/lib/mine-checkout-changes';
import { detectExtensionHolds } from '@/lib/extension-holds';
import { decideTurnoverNote } from '@/lib/turnover-notes';
import { saveOperatorNote, resolveNoteBlock, withOperatorNote } from '@/lib/cleaner-note';

const CARD = '/cleaner-messaging';
const CARD_ANCHOR = `${CARD}#schedule-digest`;
const PAGE = '/turnovers/schedule';

/** The digest region a form is about. Defaults to Cape Ann, which is the
 *  only region the /cleaner-messaging card ever posts. */
function regionFrom(formData: FormData): string {
  const raw = String(formData.get('region') || '').trim();
  return /^[a-z0-9_]{1,40}$/.test(raw) ? raw : CAPE_ANN_REGION;
}

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

/** Append key=value to a '?a=b' query string (or start one). */
function withParam(query: string, key: string, value: string): string {
  return `${query ? `${query}&` : '?'}${key}=${encodeURIComponent(value)}`;
}

/** A digest exit, anchored on the digest that was acted on. The
 *  /cleaner-messaging card is one card, #schedule-digest; the schedule
 *  page has one section per region, #digest-<region>, so its forms post
 *  a hidden region (none = Cape Ann, whose card always renders). The page
 *  landing also carries region=<region> so the outcome notice renders in
 *  that region's section, where the anchor puts the operator. */
function digestLanding(base: typeof CARD | typeof PAGE, formData: FormData, query = ''): string {
  if (base === CARD) return `${CARD}${query}#schedule-digest`;
  const region = regionFrom(formData);
  // A form posted from a day-selected card (?digest=<date>) lands back on
  // that same day, so the outcome is read against the text it was about.
  const digestDate = String(formData.get('digestDate') || '');
  const q = /^\d{4}-\d{2}-\d{2}$/.test(digestDate) ? withParam(query, 'digest', digestDate) : query;
  return `${PAGE}${withParam(q, 'region', region)}#digest-${region}`;
}

/** Digest exits for the shared actions: back=card lands on the card,
 *  anything else on the schedule page (the backTarget rule). */
function digestBack(formData: FormData, query = ''): string {
  return digestLanding(String(formData.get('back') || '') === 'card' ? CARD : PAGE, formData, query);
}

// ─── digest card ──────────────────────────────────────────────────────

/** Where an approval lands. The card is the default (older card markup
 *  never posted `back`); the per-region cards on the schedule page post
 *  back=page and their region. */
function approveLanding(formData: FormData, query: string): string {
  return digestLanding(String(formData.get('back') || '') === 'page' ? PAGE : CARD, formData, query);
}

export async function approveAndSendDigest(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const digestId = String(formData.get('digestId') || '');
  const body = String(formData.get('body') || '').trim();
  if (!digestId || !body) redirect(approveLanding(formData, '?err=digest_empty'));

  // Staleness guard: if the operator did NOT edit the drafted text, send
  // the LIVE schedule composed right now, not the cron-time snapshot - an
  // adjustment logged after the draft must reach Rosa. sendDigest composes
  // that live text PER RECIPIENT (their scope, their language), and refuses
  // the whole send if the schedule cannot be built, because a stale draft
  // or an empty day would read as "no checkouts". An edited body is her
  // words and goes verbatim to every recipient of the region.
  const draftedBody = String(formData.get('draftedBody') || '');
  const note = String(formData.get('note') || '').trim().slice(0, 600);
  const unedited = body === draftedBody.trim();
  if (unedited) {
    // A hold placed after the afternoon cron (the payment landed at 5pm)
    // must reach a 6pm send. Hold detection is deterministic and cheap, so
    // it runs again right here; a failure in it never blocks the send.
    try { await detectExtensionHolds(supabase); } catch { /* fail-soft */ }
  }
  // Persist the note first so a failed send never costs the typing, and
  // render it in Portuguese: resolveNoteBlock reuses the rendering saved by
  // "Save & translate" when the text has not changed since, so approving
  // right after saving costs no second model call and sends exactly the
  // tail the card showed. The composed path reads it back from the row and
  // appends it after each recipient's schedule (sendDigest); the verbatim
  // path appends it here.
  const noteBlock = await resolveNoteBlock(supabase, digestId, note);

  const res = await sendDigest(supabase, {
    digestId,
    operatorEmail: email,
    kind: 'initial',
    ...(unedited ? {} : { body: withOperatorNote(body, noteBlock) }),
  });
  revalidatePath(CARD);
  revalidatePath(PAGE);
  if (!res.ok) redirect(approveLanding(formData, `?err=${res.error}`));
  redirect(approveLanding(formData, `?sent=${res.sentCount}${res.failed.length ? `&failed=${res.failed.length}` : ''}`));
}

/**
 * "Save & translate": persist the special instruction and render it into
 * Portuguese right now, so the card can show the exact tail that will be
 * appended before anyone taps Approve.
 *
 * Approving without ever pressing this still translates -- the send path
 * resolves the rendering too. This button exists so the operator can SEE
 * it first, which was the whole complaint: the one string she was asked to
 * approve was not the string the crew received.
 */
export async function saveDigestNote(formData: FormData): Promise<void> {
  await requireEmail();
  const digestId = String(formData.get('digestId') || '');
  if (!digestId) redirect(CARD_ANCHOR);
  const { data: row } = await supabase
    .from('cleaner_schedule_digests')
    .select('operator_note, operator_note_pt, operator_note_en, operator_note_src')
    .eq('id', digestId)
    .maybeSingle();
  const rendered = await saveOperatorNote(supabase, digestId, String(formData.get('note') || ''), row);
  revalidatePath(CARD);
  revalidatePath(PAGE);
  // A note that came back untranslated is a model that was unreachable.
  // The instruction is safe -- it sends as typed -- but say so rather than
  // letting the card imply a translation happened.
  const flag = rendered.raw && !rendered.translated ? '?err=note_untranslated' : '';
  redirect(backTarget(formData, `${flag}#schedule-digest`));
}

export async function sendDigestUpdate(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const digestId = String(formData.get('digestId') || '');
  if (!digestId) redirect(digestBack(formData));

  // An update exists to carry CHANGED truth: sendDigest composes it fresh
  // per recipient (with the update marker and the row's note) and refuses
  // entirely if the truth cannot be read right now.
  try { await detectExtensionHolds(supabase); } catch { /* fail-soft */ }

  const res = await sendDigest(supabase, { digestId, operatorEmail: email, kind: 'update' });
  revalidatePath(CARD);
  revalidatePath(PAGE);
  if (!res.ok) redirect(digestBack(formData, `?err=${res.error}`));
  redirect(digestBack(formData, `?sent=${res.sentCount}${res.failed.length ? `&failed=${res.failed.length}` : ''}`));
}

/** "Skip this day": nothing goes out and the card clears. Reversible with
 *  "Draft tomorrow's digest", which revives a skipped row to pending. */
/** Operator's kill switch for the unattended evening send. */
export async function toggleAutosendAction(formData: FormData): Promise<void> {
  const email = await requireEmail();
  await setAutosend(supabase, String(formData.get('enabled') || '') === 'true', email);
  revalidatePath(CARD);
  revalidatePath(PAGE);
  redirect(digestBack(formData));
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
  redirect(digestBack(formData, '?skipped=1'));
}

export async function refreshDigestDraft(formData: FormData): Promise<void> {
  await requireEmail();
  const serviceDate = String(formData.get('serviceDate') || tomorrowET());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) redirect(digestBack(formData));
  // Refreshing the schedule must not silently discard a note already typed,
  // and must not leave a rendering behind that belongs to older text.
  const digestId = String(formData.get('digestId') || '');
  if (digestId) {
    const { data: row } = await supabase
      .from('cleaner_schedule_digests')
      .select('operator_note, operator_note_pt, operator_note_en, operator_note_src')
      .eq('id', digestId)
      .maybeSingle();
    await saveOperatorNote(supabase, digestId, String(formData.get('note') || ''), row);
  }
  try {
    await upsertDigestDraft(supabase, serviceDate, regionFrom(formData));
  } catch (err) {
    if (err instanceof ScheduleUnavailableError) redirect(digestBack(formData, '?err=schedule_unavailable'));
    throw err;
  }
  revalidatePath(CARD);
  revalidatePath(PAGE);
  redirect(digestBack(formData));
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
      await upsertDigestDraft(supabase, serviceDate, regionFrom(formData));
    } catch (err) {
      if (err instanceof ScheduleUnavailableError) redirect(digestBack(formData, '?err=schedule_unavailable'));
      throw err;
    }
  }
  revalidatePath(CARD);
  revalidatePath(PAGE);
  redirect(digestBack(formData));
}

/** Put a mined turnover note into tomorrow's message, or drop it. Nothing
 *  a guest said reaches the crew without one of these two taps. */
export async function addTurnoverNoteAction(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const id = String(formData.get('id') || '');
  if (id) await decideTurnoverNote(supabase, id, 'added', email);
  revalidatePath(CARD);
  revalidatePath(PAGE);
  redirect(digestBack(formData));
}

export async function dismissTurnoverNoteAction(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const id = String(formData.get('id') || '');
  if (id) await decideTurnoverNote(supabase, id, 'dismissed', email);
  revalidatePath(CARD);
  revalidatePath(PAGE);
  redirect(digestBack(formData));
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

/**
 * "No cleaning needed" on one checkout (an owner working on the house).
 * `on=1` marks it, `on=0` clears it. Its own table, so no time/date
 * adjustment, miner or concierge write can undo it (see the migration).
 *
 * A PENDING digest for that day is re-drafted so the approval card already
 * shows the house struck through. A digest that is not pending is left
 * alone: a skipped day is never revived and a sent text is never rewritten.
 * For a sent day the notice points at the existing Send update.
 */
export async function setNoCleanAction(formData: FormData): Promise<void> {
  const email = await requireEmail();
  const propertyId = String(formData.get('propertyId') || '');
  const stayCheckIn = String(formData.get('stayCheckIn') || '');
  const serviceDate = String(formData.get('serviceDate') || '');
  const on = String(formData.get('on') || '') === '1';
  const reason = String(formData.get('reason') || '').trim().slice(0, 300);
  const anchor = `#stay-${propertyId}-${stayCheckIn}`;
  // The digest card (back=card) and the schedule page both carry this.
  const land = (query: string) =>
    String(formData.get('back') || '') === 'card' ? `${CARD}${query}#schedule-digest` : `${PAGE}${query}${anchor}`;
  if (!propertyId || !/^\d{4}-\d{2}-\d{2}$/.test(stayCheckIn) || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    redirect(land('?err=bad_stay'));
  }

  if (on) {
    const { error } = await supabase
      .from('checkout_cleaning_skips')
      .insert({ property_id: propertyId, stay_check_in: stayCheckIn, reason, created_by: email });
    if (error) {
      // Already marked (the one-live-per-stay index): keep the mark, take
      // the newer reason.
      if (error.code !== '23505') redirect(land('?err=save_failed'));
      const { error: upErr } = await supabase
        .from('checkout_cleaning_skips')
        .update({ reason })
        .eq('property_id', propertyId)
        .eq('stay_check_in', stayCheckIn)
        .is('cleared_at', null);
      if (upErr) redirect(land('?err=save_failed'));
    }
  } else {
    const { error } = await supabase
      .from('checkout_cleaning_skips')
      .update({ cleared_at: new Date().toISOString(), cleared_by: email })
      .eq('property_id', propertyId)
      .eq('stay_check_in', stayCheckIn)
      .is('cleared_at', null);
    if (error) redirect(land('?err=save_failed'));
  }

  // Bring a pending draft up to date; flag a sent one for Send update.
  let digestState = '';
  try {
    const { data: prop } = await supabase.from('properties').select('region').eq('id', propertyId).maybeSingle();
    const region = (prop as { region: string | null } | null)?.region || CAPE_ANN_REGION;
    const { data: digest } = await supabase
      .from('cleaner_schedule_digests')
      .select('status')
      .eq('service_date', serviceDate)
      .eq('region', region)
      .maybeSingle();
    digestState = (digest as { status: string } | null)?.status ?? '';
    if (digestState === 'pending') await upsertDigestDraft(supabase, serviceDate, region);
  } catch {
    // The mark is saved and the schedule page reads it live; the draft
    // catches up on its next refresh or at send, which composes live.
  }

  revalidatePath(PAGE);
  revalidatePath(CARD);
  const sentHint = digestState === 'sent' ? '&noclean_sent=1' : '';
  redirect(land(`?noclean=${on ? 'on' : 'off'}${sentHint}`));
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
 *  simply drafts it inline and lands on the card. The schedule page posts
 *  a region (and back=page) to draft another region's digest; the
 *  /cleaner-messaging card posts nothing and gets Cape Ann as always. */
export async function ensureTomorrowDraft(formData?: FormData): Promise<void> {
  await requireEmail();
  const region = formData ? regionFrom(formData) : CAPE_ANN_REGION;
  try {
    await upsertDigestDraft(supabase, tomorrowET(), region);
  } catch (err) {
    if (err instanceof ScheduleUnavailableError && formData) {
      redirect(digestBack(formData, '?err=schedule_unavailable'));
    }
    throw err;
  }
  revalidatePath(PAGE);
  revalidatePath(CARD);
  if (formData && String(formData.get('back') || '') === 'page') redirect(`${PAGE}#digest-${region}`);
  redirect(CARD_ANCHOR);
}

// ─── recipients ───────────────────────────────────────────────────────

/**
 * Add or edit a cleaner_schedule_recipients row from the schedule page, so
 * Luana can be added without SQL. Fields: phone (required; stored E.164),
 * displayName, region, propertyIds (multi; none = every home in region),
 * language (pt|en), enabled, and originalPhone when editing (phone is the
 * primary key, so a changed number is an update keyed by the old one). A
 * new row mints its own 16-hex portal token; an existing row's token is
 * never rotated, or the link already on a phone would strand.
 */
export async function saveRecipientAction(formData: FormData): Promise<void> {
  await requireEmail();
  // at=recipients: the outcome notice renders in the recipients section,
  // where the anchor lands, not in the page head above the fold.
  const anchor = '&at=recipients#schedule-recipients';
  const originalPhone = String(formData.get('originalPhone') || '').trim();
  const digits = normalizePhone(String(formData.get('phone') || ''));
  if (digits.length !== 10) redirect(`${PAGE}?err=bad_phone${anchor}`);
  const phone = `+1${digits}`;
  const displayName = String(formData.get('displayName') || '').trim().slice(0, 80);
  if (!displayName) redirect(`${PAGE}?err=bad_name${anchor}`);
  const language = normalizeLanguage(String(formData.get('language') || ''));
  const enabled = String(formData.get('enabled') || '') === 'true';

  const propertyIds = [...new Set(
    formData
      .getAll('propertyIds')
      .map((v) => String(v).trim())
      .filter((v) => /^[a-z0-9_]{1,60}$/.test(v)),
  )];
  // Only ids the registry knows. An unknown id would silently scope a
  // cleaner to nothing.
  let propertyRegion: string | null = null;
  if (propertyIds.length > 0) {
    const { data } = await supabase.from('properties').select('id, region').in('id', propertyIds);
    const known = new Map(((data ?? []) as Array<{ id: string; region: string | null }>).map((p) => [p.id, p.region]));
    if (propertyIds.some((id) => !known.has(id))) redirect(`${PAGE}?err=bad_property${anchor}`);
    // The digest is drafted and sent per region, to that region's
    // recipients: a recipient scoped to homes must be in their region, and
    // to one region only. Saved under the form's default (Cape Ann) with a
    // Bridgeport home, the cleaner was texted "no checkouts" every night.
    const regions = new Set(propertyIds.map((id) => known.get(id) || CAPE_ANN_REGION));
    if (regions.size > 1) redirect(`${PAGE}?err=mixed_region${anchor}`);
    propertyRegion = [...regions][0] ?? null;
  }

  // Region: the listed homes' own, else what the form says, else Cape Ann.
  // Validated against the registry's known regions (the FK would reject an
  // unknown one anyway, but a plain redirect beats a thrown insert).
  const rawRegion = String(formData.get('region') || '').trim();
  const region = propertyRegion || rawRegion || CAPE_ANN_REGION;
  const { data: regionRows } = await supabase.from('regions').select('id');
  const knownRegions = new Set([
    ...Object.keys(REGION_LABELS),
    ...((regionRows ?? []) as Array<{ id: string }>).map((r) => r.id),
  ]);
  if (!knownRegions.has(region)) redirect(`${PAGE}?err=bad_region${anchor}`);

  const now = new Date().toISOString();
  const fields = { phone, display_name: displayName, region, property_ids: propertyIds, language, enabled, updated_at: now };

  if (originalPhone) {
    const { data, error } = await supabase
      .from('cleaner_schedule_recipients')
      .update(fields)
      .eq('phone', originalPhone)
      .select('phone');
    if (error) redirect(`${PAGE}?err=${error.code === '23505' ? 'phone_taken' : 'save_failed'}${anchor}`);
    if (!data || data.length === 0) redirect(`${PAGE}?err=recipient_gone${anchor}`);
  } else {
    const { error } = await supabase
      .from('cleaner_schedule_recipients')
      .insert({ ...fields, portal_token: randomBytes(8).toString('hex'), created_at: now });
    if (error) redirect(`${PAGE}?err=${error.code === '23505' ? 'phone_taken' : 'save_failed'}${anchor}`);
  }
  revalidatePath(PAGE);
  revalidatePath(CARD);
  redirect(`${PAGE}?saved=recipient${anchor}`);
}
