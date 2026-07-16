/**
 * Reservation-driven prep slips: purple trash bags for long Gloucester stays.
 *
 * A guest staying 5+ nights in Gloucester lives with the house through a
 * collection day, and mid-stay they get the "trash day tomorrow, purple City
 * bags" reminder message (stay-concierge trash_reminders.py, same 5-night
 * threshold). That reminder is only honest if the house actually HAS purple
 * bags — so before check-in, the pre-arrival inspection should bring or
 * verify them.
 *
 * This scan walks upcoming bookings (daily cron) and files one 'inventory'
 * prep slip per qualifying stay:
 *
 *   - 5+ nights, confirmed, at an active Gloucester property with a known
 *     trash_day (the same gate the messaging engine uses).
 *   - Pinned to the reservation via guesty_reservation_id = bookings.id, so
 *     the Operations turnover rail shows it on the exact check-in it preps
 *     for (the rail's planKeyToBookingId remap matches bookings.id directly).
 *   - scheduled_date = check-in, snoozed until a week before (same
 *     SLIP_SNOOZE_LEAD_DAYS the gear bridge uses) so a far-out booking stays
 *     off the active board until it's inspection-relevant.
 *   - category 'inventory' + a bring_list, so it also lands in the field
 *     packet supply run ("bring extra" bin) when an inspection packet covers
 *     the property.
 *
 * Idempotent: from_prep_rule_key = "trashbags:<property_id>:<check_in>" with
 * a partial unique index. The key is STAY-shaped, not booking-row-shaped,
 * because the channels table can hold several uncollapsed rows for one stay
 * (a guesty_legacy row plus iCal placeholder rows with the same dates whose
 * duplicate_of never got linked) — keying on booking id would file one slip
 * per feed row. Same property + same check-in = same stay for bag prep. One
 * slip per stay, ever — a dismissed slip stays dismissed (the operator said
 * no), and the daily re-scan is harmless.
 *
 * Called from /api/cron/prep-trash-bags (daily, after the channels sync has
 * refreshed bookings).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** System sentinel for the NOT NULL created_by_email on auto-created slips. */
const PREP_BOT_EMAIL = 'prep@helm.system';

/** Same threshold as stay-concierge's trash_reminders.MIN_NIGHTS: shorter
 *  stays get turned over by the cleaner and never touch the bins. */
const MIN_NIGHTS = 5;

/** How far ahead the daily scan looks for check-ins. Two weeks gives the
 *  slip a week of snoozed lead even for bookings made ~a week out; anything
 *  booked later is caught the morning after it lands in `bookings`. */
const LOOKAHEAD_DAYS = 14;

/** Mirror of the gear bridge's snooze: surface the slip a week before
 *  check-in so it's visible for the whole pre-arrival prep window. */
const SLIP_SNOOZE_LEAD_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

type BookingRow = {
  id: string;
  property_id: string | null;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  source: string | null;
};

type PropertyRow = {
  id: string;
  name: string | null;
  trash_day: string | null;
};

export type TrashBagSlipsResult = {
  scanned: number;
  skippedShortStay: number;
  alreadyHadSlip: number;
  created: number;
  slipsCreated: { slipId: string; stayKey: string; title: string }[];
};

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** nights column when present, else computed from the stay dates. Raw iCal
 *  rows can carry a null nights. */
function stayNights(b: BookingRow): number | null {
  if (typeof b.nights === 'number' && Number.isFinite(b.nights)) return b.nights;
  if (!b.check_in || !b.check_out) return null;
  const inMs = Date.parse(`${b.check_in}T00:00:00Z`);
  const outMs = Date.parse(`${b.check_out}T00:00:00Z`);
  if (Number.isNaN(inMs) || Number.isNaN(outMs)) return null;
  return Math.round((outMs - inMs) / DAY_MS);
}

/** True when guest_name is a real person, not an iCal placeholder like
 *  "Reservation HM9HYHMMP8", "Guest", "Not available", or empty. */
function hasRealGuestName(b: BookingRow): boolean {
  const name = (b.guest_name ?? '').trim();
  if (!name) return false;
  return !/^(reservation\b|guest$|not available|blocked|airbnb|vrbo)/i.test(name);
}

/** Prefer the row most likely to be the canonical stay record: a real guest
 *  name first (OTA/Guesty rows carry one, iCal placeholders don't), then a
 *  non-iCal source. Used both for the slip's description and for the
 *  guesty_reservation_id pin the turnover rail looks up. */
function representativeScore(b: BookingRow): number {
  let score = 0;
  if (hasRealGuestName(b)) score += 2;
  if ((b.source ?? '') !== 'ical_import') score += 1;
  return score;
}

export async function createTrashBagPrepSlips(
  supabase: SupabaseClient,
): Promise<TrashBagSlipsResult> {
  const todayIso = isoDaysFromNow(0);
  const horizonIso = isoDaysFromNow(LOOKAHEAD_DAYS);

  // 1. Gloucester properties with a known trash day — the same gate the
  //    mid-stay reminder engine uses. City is stored combined ("Gloucester,
  //    MA"), so prefix-match. trash_day "NA" (explicit no-service) drops out.
  const { data: propData, error: propErr } = await supabase
    .from('properties')
    .select('id, name, trash_day')
    .eq('is_active', true)
    .ilike('city', 'Gloucester%')
    .not('trash_day', 'is', null);
  if (propErr) throw new Error(`properties read failed: ${propErr.message}`);
  const properties = new Map<string, PropertyRow>();
  for (const p of (propData ?? []) as PropertyRow[]) {
    const day = (p.trash_day ?? '').trim();
    if (!day || day.toLowerCase() === 'na') continue;
    properties.set(p.id, p);
  }
  if (properties.size === 0) {
    return { scanned: 0, skippedShortStay: 0, alreadyHadSlip: 0, created: 0, slipsCreated: [] };
  }

  // 2. Upcoming confirmed stays at those properties. Canonical bookings
  //    only (duplicate_of null); 'block' (owner/maintenance holds) and
  //    cancelled never qualify.
  const { data: bookingData, error: bookingErr } = await supabase
    .from('bookings')
    .select('id, property_id, guest_name, check_in, check_out, nights, source')
    .eq('status', 'confirmed')
    .is('duplicate_of', null)
    .gte('check_in', todayIso)
    .lte('check_in', horizonIso)
    .in('property_id', Array.from(properties.keys()));
  if (bookingErr) throw new Error(`bookings read failed: ${bookingErr.message}`);
  const bookings = (bookingData ?? []) as BookingRow[];

  let skippedShortStay = 0;
  const eligibleRows: (BookingRow & { nightsResolved: number })[] = [];
  for (const b of bookings) {
    const nights = stayNights(b);
    if (nights == null || nights < MIN_NIGHTS) {
      skippedShortStay += 1;
      continue;
    }
    eligibleRows.push({ ...b, nightsResolved: nights });
  }

  // Collapse feed duplicates to one row per STAY. The same stay often exists
  // as several bookings rows (guesty_legacy + iCal placeholders) that the
  // channels dedupe hasn't linked via duplicate_of; without this, one guest
  // would get one slip per feed. Same property + same check-in = same stay.
  const byStay = new Map<string, (typeof eligibleRows)[number]>();
  for (const b of eligibleRows) {
    const stayKey = `${b.property_id}:${b.check_in}`;
    const current = byStay.get(stayKey);
    if (!current || representativeScore(b) > representativeScore(current)) {
      byStay.set(stayKey, b);
    }
  }
  const qualifying = Array.from(byStay.values());

  if (qualifying.length === 0) {
    return { scanned: bookings.length, skippedShortStay, alreadyHadSlip: 0, created: 0, slipsCreated: [] };
  }

  // 3. Drop stays that already have a slip (any status — one per stay, ever).
  const keys = qualifying.map((b) => `trashbags:${b.property_id}:${b.check_in}`);
  const { data: existing, error: existingErr } = await supabase
    .from('work_slips')
    .select('from_prep_rule_key')
    .in('from_prep_rule_key', keys);
  if (existingErr) throw new Error(`work_slips read failed: ${existingErr.message}`);
  const alreadyKeyed = new Set(
    ((existing ?? []) as Array<{ from_prep_rule_key: string | null }>)
      .map((r) => r.from_prep_rule_key)
      .filter((k): k is string => !!k),
  );

  let alreadyHadSlip = 0;
  const toInsert: Record<string, unknown>[] = [];
  for (const b of qualifying) {
    const key = `trashbags:${b.property_id}:${b.check_in}`;
    if (alreadyKeyed.has(key)) {
      alreadyHadSlip += 1;
      continue;
    }
    const prop = properties.get(b.property_id ?? '')!;
    const propertyName = prop.name ?? b.property_id ?? 'Property';

    // Same snooze math as the gear bridge: wake a week before check-in;
    // never snooze into the past.
    let snoozedUntil: string | null = null;
    if (b.check_in) {
      const wakeMs = Date.parse(`${b.check_in}T00:00:00Z`) - SLIP_SNOOZE_LEAD_DAYS * DAY_MS;
      const wakeIso = new Date(wakeMs).toISOString().slice(0, 10);
      if (wakeIso > todayIso) snoozedUntil = wakeIso;
    }

    const guest = hasRealGuestName(b) ? b.guest_name!.trim() : 'Guest';
    toInsert.push({
      property_id: b.property_id,
      title: `${propertyName}: Bring purple trash bags for long stay`,
      description: [
        `${guest} is staying ${b.nightsResolved} nights (${b.check_in} to ${b.check_out}) — long enough to hit a ${prop.trash_day} trash day, so they'll get the mid-stay reminder to put the bins out.`,
        '',
        `Gloucester curbside only takes official purple City trash bags. At the pre-arrival inspection, check the supply and leave enough for the stay (drawer/closet where the house keeps them). Bring a roll if low.`,
      ].join('\n'),
      action_summary: 'Verify purple City trash bags are stocked for a 5+ night stay',
      bring_list: 'Purple City of Gloucester trash bags',
      category: 'inventory',
      priority: 'normal',
      status: 'open',
      scheduled_date: b.check_in,
      snoozed_until: snoozedUntil,
      snoozed_by_email: snoozedUntil ? PREP_BOT_EMAIL : null,
      snoozed_at: snoozedUntil ? new Date().toISOString() : null,
      guesty_reservation_id: b.id,
      from_prep_rule_key: key,
      created_by_email: PREP_BOT_EMAIL,
    });
  }

  if (toInsert.length === 0) {
    return { scanned: bookings.length, skippedShortStay, alreadyHadSlip, created: 0, slipsCreated: [] };
  }

  // 4. Insert. The partial unique index backstops a concurrent run: on a
  //    23505 the bulk insert aborts, so retry row-by-row swallowing only
  //    duplicate-key losses (mirrors the gear route's race handling).
  let inserted: Array<{ id: string; title: string; from_prep_rule_key: string }> = [];
  const bulk = await supabase
    .from('work_slips')
    .insert(toInsert)
    .select('id, title, from_prep_rule_key');
  if (bulk.error) {
    if (bulk.error.code !== '23505') {
      throw new Error(`work_slips insert failed: ${bulk.error.message}`);
    }
    for (const row of toInsert) {
      const one = await supabase
        .from('work_slips')
        .insert(row)
        .select('id, title, from_prep_rule_key')
        .single();
      if (one.error) {
        if (one.error.code === '23505') continue; // another run won this row
        throw new Error(`work_slips insert failed: ${one.error.message}`);
      }
      inserted.push(one.data as (typeof inserted)[number]);
    }
  } else {
    inserted = (bulk.data ?? []) as typeof inserted;
  }

  return {
    scanned: bookings.length,
    skippedShortStay,
    alreadyHadSlip,
    created: inserted.length,
    slipsCreated: inserted.map((s) => ({
      slipId: s.id,
      stayKey: s.from_prep_rule_key.replace(/^trashbags:/, ''),
      title: s.title,
    })),
  };
}
