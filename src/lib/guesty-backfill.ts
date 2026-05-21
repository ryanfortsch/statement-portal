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
  inserted: number;
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

  const { data: existing, error: exErr } = await sb
    .from('bookings')
    .select('external_booking_id')
    .eq('source', 'guesty_legacy');
  if (exErr) throw new Error(`read bookings: ${exErr.message}`);
  const haveIds = new Set((existing ?? []).map((r) => r.external_booking_id as string));

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

  const rows: Row[] = [];
  let skippedExisting = 0;
  let skippedInvalid = 0;
  let skippedUnknownProperty = 0;

  for (const r of (gr ?? [])) {
    const id = r.guesty_reservation_id as string | null;
    if (!id) { skippedInvalid++; continue; }
    if (haveIds.has(id)) { skippedExisting++; continue; }
    if (!r.property_id || !r.check_in || !r.check_out) { skippedInvalid++; continue; }
    if (!knownPropertyIds.has(r.property_id as string)) { skippedUnknownProperty++; continue; }

    rows.push({
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
    });
  }

  const base = {
    ok: true as const,
    total_guesty_reservations: gr?.length ?? 0,
    already_backfilled: skippedExisting,
    skipped_invalid: skippedInvalid,
    skipped_unknown_property: skippedUnknownProperty,
    to_insert: rows.length,
  };

  if (dryRun) {
    return { ...base, dryRun: true, inserted: 0, deduped: 0 };
  }

  let inserted = 0;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error: insErr } = await sb.from('bookings').insert(chunk);
    if (insErr) throw new Error(`insert chunk ${i / chunkSize}: ${insErr.message}`);
    inserted += chunk.length;
  }

  // Newly inserted guesty_legacy rows are duplicates of any iCal-imported rows
  // for the same stays. Reconcile so each physical stay counts once.
  let deduped = 0;
  try {
    const d = await dedupeAllBookings();
    deduped = d.duplicates;
  } catch (err) {
    console.error('[guesty-backfill] dedupe failed:', err);
  }

  return { ...base, dryRun: false, inserted, deduped };
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
