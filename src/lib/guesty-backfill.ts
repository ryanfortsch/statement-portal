/**
 * Copies `guesty_reservations` into the Helm-native `bookings` table as
 * `source='guesty_legacy'` rows, then runs the cross-source dedup.
 *
 * This is the transition bridge that keeps VRBO / Booking.com / direct stays
 * (which we can't yet pull via a direct OTA iCal feed while Guesty holds the
 * API connection) flowing into `bookings`. Runs nightly after the Guesty API
 * sync, and on demand from the dashboard button. Idempotent: only inserts
 * guesty_reservations not already backfilled (matched by external_booking_id).
 *
 * Retired once every listing is off Guesty (or once Guesty's per-listing iCal
 * feeds replace it as the inbound transport).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dedupeAllBookings } from '@/lib/ical-sync';
import { selectAllPaged } from '@/lib/paged-select';
import type { BookingChannel, BookingStatus } from '@/lib/channels-types';

let _service: SupabaseClient | null = null;
function getServiceClient(): SupabaseClient {
  if (_service) return _service;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase service-role env vars not configured');
  _service = createClient(url, key, { auth: { persistSession: false } });
  return _service;
}

export type BackfillResult = {
  ok: true;
  dryRun: boolean;
  total_guesty_reservations: number;
  already_backfilled: number;
  skipped_invalid: number;
  skipped_unknown_property: number;
  to_insert: number;
  to_update: number;
  inserted: number;
  updated: number;
  deduped: number;
  /**
   * Rows that looked new (absent from the loaded guesty_legacy map) but turned
   * out to already exist when re-checked by id immediately before the insert.
   * A paged read makes this 0; any non-zero value means the bookings read came
   * back short and this guard stopped a duplicate row being minted.
   */
  skipped_already_present: number;
};

export async function backfillGuestyToBookings(
  opts: { dryRun?: boolean } = {},
): Promise<BackfillResult> {
  const dryRun = opts.dryRun === true;
  const sb = getServiceClient();

  // All three reads below are paged. A bare .select() stops at PostgREST's
  // 1000-row cap with no error, and each truncation fails differently here:
  // a short guesty_reservations read silently backfills only part of the
  // feed, a short properties read inflates skipped_unknown_property, and a
  // short bookings read is the corrupting one -- see the comment on
  // existingByBid below.
  type GuestyRow = {
    guesty_reservation_id: string | null;
    property_id: string | null;
    guest_name: string | null;
    confirmation_code: string | null;
    check_in: string | null;
    check_out: string | null;
    nights: number | null;
    channel: string | null;
    status: string | null;
    host_payout: number | string | null;
  };
  const gr = await selectAllPaged<GuestyRow>(
    (from, to) =>
      sb
        .from('guesty_reservations')
        .select('guesty_reservation_id, property_id, guest_name, confirmation_code, check_in, check_out, nights, channel, status, host_payout')
        .order('guesty_reservation_id', { ascending: true })
        .range(from, to),
    { label: 'read guesty_reservations' },
  );

  // Existing guesty_legacy rows, with the fields we mirror from
  // guesty_reservations, so we can update a row in place when Guesty changes a
  // reservation (status, guest name, dates, payout). Keyed by
  // external_booking_id. INSERT-only would freeze a row at its first-seen
  // state: a later cancellation or rename in Guesty would never reach
  // `bookings`, leaving a stale `confirmed` row behind.
  //
  // This is the read that must not truncate. Everything missing from the map
  // is treated as new and goes down the plain insert() path below, which has
  // no onConflict and no unique index to reject it (the only index on
  // external_booking_id is non-unique and partial), so a short read here
  // mints a fresh duplicate guesty_legacy row on every nightly run. Those
  // duplicates then feed dedupeAllBookings, making its job harder.
  type ExistingRow = {
    external_booking_id: string;
    channel: BookingChannel;
    external_confirmation_code: string | null;
    check_in: string;
    check_out: string;
    nights: number | null;
    status: BookingStatus;
    guest_name: string | null;
    payout: number | null;
  };
  const existing = await selectAllPaged<ExistingRow>(
    (from, to) =>
      sb
        .from('bookings')
        .select('external_booking_id, channel, external_confirmation_code, check_in, check_out, nights, status, guest_name, payout')
        .eq('source', 'guesty_legacy')
        .order('external_booking_id', { ascending: true })
        .range(from, to),
    { label: 'read bookings' },
  );
  const existingByBid = new Map<string, ExistingRow>();
  for (const e of existing) {
    if (e.external_booking_id) existingByBid.set(e.external_booking_id, e);
  }

  // Only properties Helm actually manages -- guesty_reservations can reference
  // personal listings absent from `properties`, which the FK would reject.
  const propRows = await selectAllPaged<{ id: string }>(
    (from, to) => sb.from('properties').select('id').order('id', { ascending: true }).range(from, to),
    { label: 'read properties' },
  );
  const knownPropertyIds = new Set(propRows.map((r) => r.id));

  type Row = {
    property_id: string;
    channel: BookingChannel;
    source: 'guesty_legacy';
    external_booking_id: string;
    external_confirmation_code: string | null;
    check_in: string;
    check_out: string;
    nights: number | null;
    status: BookingStatus;
    guest_name: string | null;
    payout: number | null;
  };

  const toInsert: Row[] = [];
  const toUpdate: Array<{ external_booking_id: string; patch: Partial<Row> }> = [];
  let skippedInvalid = 0;
  let skippedUnknownProperty = 0;

  for (const r of gr) {
    const id = r.guesty_reservation_id as string | null;
    if (!id) { skippedInvalid++; continue; }
    if (!r.property_id || !r.check_in || !r.check_out) { skippedInvalid++; continue; }
    if (!knownPropertyIds.has(r.property_id as string)) { skippedUnknownProperty++; continue; }

    const desired: Row = {
      property_id: r.property_id as string,
      channel: mapChannel(r.channel as string | null),
      source: 'guesty_legacy',
      external_booking_id: id,
      external_confirmation_code: (r.confirmation_code as string | null) ?? null,
      check_in: (r.check_in as string).slice(0, 10),
      check_out: (r.check_out as string).slice(0, 10),
      nights: (r.nights as number | null) ?? null,
      status: mapStatus(r.status as string | null),
      guest_name: (r.guest_name as string | null) ?? null,
      payout: r.host_payout != null ? Number(r.host_payout) : null,
    };

    const prior = existingByBid.get(id);
    if (!prior) {
      toInsert.push(desired);
      continue;
    }

    // Mirror only the fields Guesty owns, and only when they changed. Never
    // downgrade a real guest name to null -- a previous run (or dedup
    // enrichment) may hold a better value than a momentarily-blank API row.
    const patch: Partial<Row> = {};
    if (prior.channel !== desired.channel) patch.channel = desired.channel;
    if ((prior.external_confirmation_code ?? null) !== desired.external_confirmation_code)
      patch.external_confirmation_code = desired.external_confirmation_code;
    if (prior.check_in?.slice(0, 10) !== desired.check_in) patch.check_in = desired.check_in;
    if (prior.check_out?.slice(0, 10) !== desired.check_out) patch.check_out = desired.check_out;
    if ((prior.nights ?? null) !== desired.nights) patch.nights = desired.nights;
    if (prior.status !== desired.status) patch.status = desired.status;
    if (desired.guest_name != null && prior.guest_name !== desired.guest_name)
      patch.guest_name = desired.guest_name;
    if (Number(prior.payout ?? NaN) !== Number(desired.payout ?? NaN))
      patch.payout = desired.payout;

    if (Object.keys(patch).length > 0) toUpdate.push({ external_booking_id: id, patch });
  }

  const base = {
    ok: true as const,
    total_guesty_reservations: gr.length,
    already_backfilled: gr.length - toInsert.length - skippedInvalid - skippedUnknownProperty,
    skipped_invalid: skippedInvalid,
    skipped_unknown_property: skippedUnknownProperty,
    to_insert: toInsert.length,
    to_update: toUpdate.length,
  };

  if (dryRun) {
    return { ...base, dryRun: true, inserted: 0, updated: 0, deduped: 0, skipped_already_present: 0 };
  }

  // Belt and braces on top of the paged read. Nothing in the database stops a
  // duplicate guesty_legacy row: the insert carries no onConflict and the only
  // index on external_booking_id is non-unique and partial. So before writing,
  // re-ask for exactly the ids about to be inserted. This is bounded (only the
  // ids in hand) and it makes a duplicate impossible on a short read rather
  // than merely unlikely. It narrows but does not close a true concurrent-run
  // race; the nightly cron is the only scheduled caller.
  const VERIFY_CHUNK = 100; // keeps the `in` list well inside URL length limits
  const alreadyPresent = new Set<string>();
  for (let i = 0; i < toInsert.length; i += VERIFY_CHUNK) {
    const ids = toInsert.slice(i, i + VERIFY_CHUNK).map((r) => r.external_booking_id);
    const { data, error } = await sb
      .from('bookings')
      .select('external_booking_id')
      .eq('source', 'guesty_legacy')
      .in('external_booking_id', ids);
    if (error) throw new Error(`verify before insert: ${error.message}`);
    for (const row of data ?? []) alreadyPresent.add(row.external_booking_id as string);
  }
  if (alreadyPresent.size > 0) {
    console.warn(
      `[guesty-backfill] ${alreadyPresent.size} row(s) were already in bookings despite being absent from the loaded map -- the bookings read looks short`,
    );
  }
  const insertable = toInsert.filter((r) => !alreadyPresent.has(r.external_booking_id));

  let inserted = 0;
  const chunkSize = 500;
  for (let i = 0; i < insertable.length; i += chunkSize) {
    const chunk = insertable.slice(i, i + chunkSize);
    const { error: insErr } = await sb.from('bookings').insert(chunk);
    if (insErr) throw new Error(`insert chunk ${i / chunkSize}: ${insErr.message}`);
    inserted += chunk.length;
  }

  let updated = 0;
  for (const u of toUpdate) {
    const { error: updErr } = await sb
      .from('bookings')
      .update(u.patch)
      .eq('source', 'guesty_legacy')
      .eq('external_booking_id', u.external_booking_id);
    if (updErr) throw new Error(`update ${u.external_booking_id}: ${updErr.message}`);
    updated += 1;
  }

  // Newly inserted / refreshed guesty_legacy rows are duplicates of any
  // iCal-imported rows for the same stays. Reconcile so each physical stay
  // counts once and a fresh cancellation collapses its stale twin.
  let deduped = 0;
  try {
    const d = await dedupeAllBookings();
    deduped = d.duplicates;
  } catch (err) {
    console.error('[guesty-backfill] dedupe failed:', err);
  }

  return { ...base, dryRun: false, inserted, updated, deduped, skipped_already_present: alreadyPresent.size };
}

function mapChannel(raw: string | null): BookingChannel {
  if (!raw) return 'other';
  const c = raw.toLowerCase();
  if (c.includes('airbnb')) return 'airbnb';
  if (c.includes('vrbo') || c.includes('homeaway')) return 'vrbo';
  if (c.includes('booking')) return 'booking_com';
  if (c.includes('manual') || c.includes('direct')) return 'direct';
  return 'other';
}

function mapStatus(raw: string | null): BookingStatus {
  if (!raw) return 'confirmed';
  const s = raw.toLowerCase();
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('inquiry')) return 'inquiry';
  if (s.includes('pending')) return 'pending';
  if (s.includes('completed')) return 'completed';
  return 'confirmed';
}
