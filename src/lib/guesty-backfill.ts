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
};

export async function backfillGuestyToBookings(
  opts: { dryRun?: boolean } = {},
): Promise<BackfillResult> {
  const dryRun = opts.dryRun === true;
  const sb = getServiceClient();

  const { data: gr, error: grErr } = await sb
    .from('guesty_reservations')
    .select('guesty_reservation_id, property_id, guest_name, confirmation_code, check_in, check_out, nights, channel, status, host_payout');
  if (grErr) throw new Error(`read guesty_reservations: ${grErr.message}`);

  // Existing guesty_legacy rows, with the fields we mirror from
  // guesty_reservations, so we can update a row in place when Guesty changes a
  // reservation (status, guest name, dates, payout). Keyed by
  // external_booking_id. INSERT-only would freeze a row at its first-seen
  // state: a later cancellation or rename in Guesty would never reach
  // `bookings`, leaving a stale `confirmed` row behind.
  const { data: existing, error: exErr } = await sb
    .from('bookings')
    .select('external_booking_id, channel, external_confirmation_code, check_in, check_out, nights, status, guest_name, payout')
    .eq('source', 'guesty_legacy');
  if (exErr) throw new Error(`read bookings: ${exErr.message}`);
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
  const existingByBid = new Map<string, ExistingRow>();
  for (const e of (existing ?? []) as ExistingRow[]) {
    if (e.external_booking_id) existingByBid.set(e.external_booking_id, e);
  }

  // Only properties Helm actually manages -- guesty_reservations can reference
  // personal listings absent from `properties`, which the FK would reject.
  const { data: propRows, error: propErr } = await sb.from('properties').select('id');
  if (propErr) throw new Error(`read properties: ${propErr.message}`);
  const knownPropertyIds = new Set((propRows ?? []).map((r) => r.id as string));

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

  for (const r of (gr ?? [])) {
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
    total_guesty_reservations: gr?.length ?? 0,
    already_backfilled: (gr?.length ?? 0) - toInsert.length - skippedInvalid - skippedUnknownProperty,
    skipped_invalid: skippedInvalid,
    skipped_unknown_property: skippedUnknownProperty,
    to_insert: toInsert.length,
    to_update: toUpdate.length,
  };

  if (dryRun) {
    return { ...base, dryRun: true, inserted: 0, updated: 0, deduped: 0 };
  }

  let inserted = 0;
  const chunkSize = 500;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
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

  return { ...base, dryRun: false, inserted, updated, deduped };
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
