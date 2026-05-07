/**
 * iCal import engine.
 *
 * Pulls .ics feeds from each connected channel listing, parses them, and
 * upserts `bookings`. Also tracks every run in `ical_sync_runs` for
 * dashboard display and debugging.
 *
 * Uses the service-role Supabase client so the cron route can write
 * without going through RLS-friendly anon paths.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseIcal, isBookingEvent, guessGuestNameFromIcal } from '@/lib/ical';
import { CHANNEL_LABELS, type BookingChannel } from '@/lib/channels-types';

let _service: SupabaseClient | null = null;
function getServiceClient(): SupabaseClient {
  if (_service) return _service;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase service-role env vars not configured');
  _service = createClient(url, key, { auth: { persistSession: false } });
  return _service;
}

export type SyncListingResult = {
  listing_id: string;
  property_id: string;
  channel: BookingChannel;
  display_name: string | null;
  success: boolean;
  events_total: number;
  bookings_added: number;
  bookings_updated: number;
  bookings_cancelled: number;
  error: string | null;
  duration_ms: number;
};

/**
 * Sync a single channel listing. Wraps fetch + parse + upsert + log.
 */
export async function syncListing(opts: {
  listing_id: string;
  property_id: string;
  channel: BookingChannel;
  display_name: string | null;
  ical_import_url: string;
}): Promise<SyncListingResult> {
  const startedAt = new Date();
  const sb = getServiceClient();

  const result: SyncListingResult = {
    listing_id: opts.listing_id,
    property_id: opts.property_id,
    channel: opts.channel,
    display_name: opts.display_name,
    success: false,
    events_total: 0,
    bookings_added: 0,
    bookings_updated: 0,
    bookings_cancelled: 0,
    error: null,
    duration_ms: 0,
  };

  let httpStatus: number | null = null;
  let responseSize = 0;

  try {
    // --- Fetch ---
    const res = await fetch(opts.ical_import_url, {
      headers: { Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' },
      cache: 'no-store',
    });
    httpStatus = res.status;
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${maskUrl(opts.ical_import_url)}`);
    }
    const text = await res.text();
    responseSize = text.length;

    // --- Parse ---
    const events = parseIcal(text);
    result.events_total = events.length;

    // --- Build upsert rows ---
    const rows = events
      .filter(isBookingEvent)
      .map((e) => {
        const guest = guessGuestNameFromIcal(e);
        return {
          property_id: opts.property_id,
          channel_listing_id: opts.listing_id,
          channel: opts.channel,
          source: 'ical_import' as const,
          ical_uid: e.uid,
          check_in: e.dtstart,
          check_out: e.dtend,
          nights: nightsBetween(e.dtstart, e.dtend),
          status: 'confirmed' as const,
          guest_name: guest,
          raw_summary: e.summary,
          raw_description: e.description,
          raw_url: e.url,
          last_seen_at: startedAt.toISOString(),
          // first_seen_at intentionally unset — DB default applies on insert,
          // the upsert path below preserves the existing value on update.
        };
      });

    // --- Diff to count adds/updates/cancels ---
    const incomingUids = new Set(rows.map((r) => r.ical_uid));
    const { data: existing, error: existingErr } = await sb
      .from('bookings')
      .select('id, ical_uid, status, check_in, check_out')
      .eq('channel_listing_id', opts.listing_id)
      .eq('source', 'ical_import');
    if (existingErr) throw new Error(`select existing: ${existingErr.message}`);

    const existingByUid = new Map<string, { id: string; status: string; check_in: string; check_out: string }>(
      (existing ?? []).map((r) => [r.ical_uid as string, r as { id: string; status: string; check_in: string; check_out: string }]),
    );

    let added = 0;
    let updated = 0;
    for (const row of rows) {
      const prior = existingByUid.get(row.ical_uid);
      if (!prior) {
        added += 1;
      } else if (
        prior.check_in !== row.check_in ||
        prior.check_out !== row.check_out ||
        prior.status !== 'confirmed'
      ) {
        updated += 1;
      }
    }

    // Anything previously imported but missing this run is a cancellation /
    // disappearance. Mark cancelled rather than delete — keeps history.
    const disappeared = (existing ?? [])
      .filter((r) => r.status !== 'cancelled' && !incomingUids.has(r.ical_uid as string))
      .map((r) => r.id as string);

    // --- Upsert ---
    if (rows.length > 0) {
      const { error: upsertErr } = await sb
        .from('bookings')
        .upsert(rows, { onConflict: 'channel,ical_uid' });
      if (upsertErr) throw new Error(`upsert bookings: ${upsertErr.message}`);
    }

    if (disappeared.length > 0) {
      const { error: cancelErr } = await sb
        .from('bookings')
        .update({ status: 'cancelled', cancelled_at: startedAt.toISOString() })
        .in('id', disappeared);
      if (cancelErr) throw new Error(`cancel bookings: ${cancelErr.message}`);
    }

    result.bookings_added = added;
    result.bookings_updated = updated;
    result.bookings_cancelled = disappeared.length;
    result.success = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.success = false;
  }

  const completedAt = new Date();
  result.duration_ms = completedAt.getTime() - startedAt.getTime();

  // --- Persist sync_run + listing summary ---
  await sb.from('ical_sync_runs').insert({
    channel_listing_id: opts.listing_id,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: result.duration_ms,
    success: result.success,
    error_message: result.error,
    http_status: httpStatus,
    events_total: result.events_total,
    bookings_added: result.bookings_added,
    bookings_updated: result.bookings_updated,
    bookings_cancelled: result.bookings_cancelled,
    raw_response_size: responseSize,
  });

  await sb
    .from('channel_listings')
    .update({
      last_imported_at: completedAt.toISOString(),
      last_import_status: result.success ? 'success' : 'error',
      last_import_error: result.error,
      last_import_event_count: result.events_total,
    })
    .eq('id', opts.listing_id);

  return result;
}

/**
 * Run sync for every active listing that has a feed URL configured. The
 * cron entrypoint calls this with no args.
 */
export async function syncAllListings(opts: { onlyListingId?: string } = {}): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  results: SyncListingResult[];
}> {
  const sb = getServiceClient();
  let q = sb
    .from('channel_listings')
    .select('id, property_id, channel, display_name, ical_import_url, ical_import_enabled, is_active');
  if (opts.onlyListingId) q = q.eq('id', opts.onlyListingId);

  const { data, error } = await q;
  if (error) throw new Error(`load channel_listings: ${error.message}`);

  const eligible = (data ?? []).filter(
    (l) => l.is_active && l.ical_import_enabled && !!l.ical_import_url,
  );

  const results: SyncListingResult[] = [];
  for (const l of eligible) {
    const r = await syncListing({
      listing_id: l.id as string,
      property_id: l.property_id as string,
      channel: l.channel as BookingChannel,
      display_name: l.display_name as string | null,
      ical_import_url: l.ical_import_url as string,
    });
    results.push(r);
  }

  return {
    total: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

function nightsBetween(checkIn: string, checkOut: string): number | null {
  if (!checkIn || !checkOut) return null;
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400_000);
}

function maskUrl(url: string): string {
  // OTAs put a private token in the path. Don't dump it into error_message.
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/[^/]+$/, '…')}`;
  } catch {
    return '…';
  }
}

export function _channelLabel(c: BookingChannel): string {
  return CHANNEL_LABELS[c];
}
