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
import {
  parseIcal,
  isBookingEvent,
  guessGuestNameFromIcal,
  isPlaceholderGuestName,
  airbnbConfirmationCode,
} from '@/lib/ical';
import { CHANNEL_LABELS, type BookingChannel } from '@/lib/channels-types';
import { recordSyncFailure, recordSyncResult } from '@/lib/sync-status';
import { selectAllPaged } from '@/lib/paged-select';
import { planDedupe, type DedupRow } from '@/lib/booking-dedupe';

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
    // A Guesty per-listing feed (channel='guesty') is an aggregate of every
    // channel; parse each event into its real channel + confirmation code. A
    // normal single-channel feed uses the listing's own channel.
    const isGuestyFeed = opts.channel === 'guesty';
    const rows = events
      .filter(isBookingEvent)
      .map((e) => {
        const guest = guessGuestNameFromIcal(e);
        let channel: BookingChannel = opts.channel;
        let externalConfirmationCode: string | null = null;
        let status: 'confirmed' | 'block' = 'confirmed';
        if (isGuestyFeed) {
          const parsed = parseGuestySummary(e.summary);
          channel = parsed.channel;
          externalConfirmationCode = parsed.code;
          if (parsed.isBlock) status = 'block';
        } else {
          // A direct Airbnb feed names no guest but links the reservation in
          // DESCRIPTION; the code in that link is the cross-source identity
          // the dedupe joins on. Anything else (VRBO, a block) yields null.
          externalConfirmationCode = airbnbConfirmationCode(e.description);
        }
        return {
          property_id: opts.property_id,
          channel_listing_id: opts.listing_id,
          channel,
          source: 'ical_import' as const,
          ical_uid: e.uid,
          check_in: e.dtstart,
          check_out: e.dtend,
          nights: nightsBetween(e.dtstart, e.dtend),
          status,
          guest_name: guest,
          external_confirmation_code: externalConfirmationCode,
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

    // Guard against a transient or broken feed wiping a live calendar.
    // A 200-but-empty (or unparseable) response parses to zero booking rows.
    // If we proceeded, every still-live booking for this listing would be
    // marked cancelled and vanish from the turnover and check-in views, only
    // to reappear on the next good sync (and this cron runs every 30 min). So
    // when the parse comes back empty but we still hold live bookings, skip
    // the diff/cancel pass entirely and surface a soft failure for review.
    // Mirrors the competitors sync's zero-result guard.
    //
    // "Live" means not cancelled AND not already checked out. Past stays roll
    // off an OTA feed by design -- Airbnb drops a reservation the day after
    // checkout -- so counting them leaves the guard permanently tripped on any
    // listing whose forward calendar has legitimately emptied. 4 Brier Neck's
    // Airbnb feed is the case in point: after the Armstrong offboarding blocked
    // the calendar out, one completed Aug 8-12 stay held the guard open for 892
    // consecutive runs from Aug 14, and every one of those runs skipped the
    // cancel pass, so cancel detection on that listing was dead for 19 days.
    // The date bound is what the old "ages out by checkout date anyway" comment
    // claimed but never implemented.
    //
    // Letting a rolled-off past booking cancel is the established behaviour on
    // every other listing (~780 such rows) and touches no payout math -- money
    // reads guesty_reservations, never bookings. The stays this still declines
    // to act on are the ones worth protecting: real upcoming reservations.
    const cutoff = startedAt.toISOString().slice(0, 10);
    const liveExisting = (existing ?? []).filter(
      (r) => r.status !== 'cancelled' && String(r.check_out) >= cutoff,
    );
    if (rows.length === 0 && liveExisting.length > 0) {
      result.bookings_added = 0;
      result.bookings_updated = 0;
      result.bookings_cancelled = 0;
      result.success = false;
      result.error = `empty-feed guard: parsed 0 bookings but ${liveExisting.length} upcoming booking(s) exist; skipped cancel pass (suspected transient or broken feed)`;
    } else {
      // Anything previously imported but missing this run is a cancellation /
      // disappearance. Mark cancelled rather than delete, to keep history.
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
    }
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

export type DedupResult = {
  clusters: number;
  duplicates: number;
  changed: number;
  enriched: number;
  /**
   * Rows that came out of clustering as singletons but whose existing
   * duplicate_of pointed at a row this run did not load. Clearing those would
   * destroy a correct mark on the strength of an incomplete read, so they are
   * left alone and counted here. A paged load makes this 0; any non-zero value
   * means the load was short and is worth investigating.
   */
  skipped_unverifiable: number;
};

/**
 * Run sync for every active listing that has a feed URL configured, then
 * run a portfolio-wide dedup pass. The cron entrypoint calls this with no
 * args.
 */
export async function syncAllListings(opts: { onlyListingId?: string } = {}): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  results: SyncListingResult[];
  dedup: DedupResult | null;
}> {
  try {
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

    // A stay can land in `bookings` more than once -- e.g. the same Airbnb
    // reservation arriving via the iCal feed AND via the guesty_legacy
    // backfill. Reconcile after every sync so downstream counts, the
    // calendar, and conflict detection treat each physical stay once.
    // A dedup failure must not fail the sync itself.
    let dedup: DedupResult | null = null;
    try {
      dedup = await dedupeAllBookings();
    } catch (err) {
      console.error('[ical-sync] dedupe failed:', err);
    }

    // Aggregate iCal status into sync_status so the daily brief can flag
    // "iCal feed N stuck" without scanning the per-listing ical_sync_runs +
    // channel_listings.last_import_status log. Per-listing details still live
    // there; sync_status is the watchdog surface.
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const firstFailed = results.find((r) => !r.success);
    await recordSyncResult('ical', {
      processed: succeeded,
      failed,
      firstError: firstFailed
        ? `${firstFailed.display_name ?? firstFailed.listing_id}: ${firstFailed.error ?? 'unknown'}`
        : undefined,
      result: { succeeded, failed, total: results.length },
    });

    return {
      total: results.length,
      succeeded,
      failed,
      results,
      dedup,
    };
  } catch (err) {
    // syncAllListings rarely throws hard -- syncListing catches per-listing.
    // But if loading channel_listings itself fails, surface that.
    await recordSyncFailure('ical', err);
    throw err;
  }
}

// ── Cross-source dedup ────────────────────────────────────────────────

/**
 * Portfolio-wide cross-source reconciliation. Loads EVERY booking (cancelled
 * included), clusters rows that represent the same physical stay per property
 * with union-find, and writes `duplicate_of` so each stay is counted once and
 * the canonical row carries the cluster's effective status + a real guest name.
 *
 * Cancelled rows are loaded too: a stay that one source still reports
 * `confirmed` but a trusted source reports `cancelled` must collapse onto the
 * cancelled row, or it lingers as a phantom on the turnover calendar. Status is
 * never mutated -- the cancelled row is simply chosen as canonical so its stale
 * twin becomes a hidden duplicate.
 *
 * Idempotent: only rows whose `duplicate_of` (or pooled fields) actually change
 * are written, so a steady-state re-run is a near no-op.
 */
export async function dedupeAllBookings(): Promise<DedupResult> {
  const sb = getServiceClient();

  // Page through EVERY booking. A bare .select() is capped by PostgREST at
  // 1000 rows, and this function is destructive on a short read: a row whose
  // cluster twin fell outside the slice looks like a singleton, and the writer
  // below then CLEARS its correct duplicate_of. Because the cap was also
  // unordered, the surviving slice shifted between runs as those very updates
  // rewrote tuples, so a different set of stays resurfaced each time.
  // Order by id so the offset windows are stable while we read.
  const rows = await selectAllPaged<DedupRow>(
    (from, to) =>
      sb
        .from('bookings')
        .select('id, property_id, source, status, check_in, check_out, duplicate_of, created_at, cancelled_at, channel_listing_id, guest_name, guest_email, guest_phone, external_confirmation_code, external_booking_id, payout, gross_amount, num_guests')
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'dedupe load' },
  );

  // The Guesty per-listing feed (channel_listings.channel = 'guesty') is an
  // aggregate of every channel and has been seen to drop a still-confirmed
  // reservation. A cancellation that exists ONLY on the aggregate feed is not
  // trusted to hide a stay (a direct OTA feed or the Guesty API would still
  // show it); see clusterEffectiveStatus.
  //
  // Paged for the same reason: a truncated listing set would leave aggregate
  // rows unrecognised, which flips their cancellations from untrusted to
  // trusted and can hide a live stay.
  const listings = await selectAllPaged<{ id: string; channel: string }>(
    (from, to) =>
      sb.from('channel_listings').select('id, channel').order('id', { ascending: true }).range(from, to),
    { label: 'dedupe load listings' },
  );
  const aggregateListingIds = new Set(
    listings.filter((l) => l.channel === 'guesty').map((l) => l.id),
  );
  const isFromAggregateFeed = (r: DedupRow): boolean =>
    r.source === 'ical_import' &&
    r.channel_listing_id != null &&
    aggregateListingIds.has(r.channel_listing_id);

  const {
    desired,
    enrichPatches,
    clusters: clusterCount,
    duplicates: dupCount,
  } = planDedupe(rows, { isFromAggregateFeed, isPlaceholderGuestName });

  // Write only changed rows, batched by target value to minimize round trips.
  const loadedIds = new Set(rows.map((r) => r.id));
  const toNull: string[] = [];
  const toCanonical = new Map<string, string[]>();
  let changed = 0;
  let skippedUnverifiable = 0;
  for (const r of rows) {
    const want = desired.get(r.id) ?? null;
    const current = r.duplicate_of ?? null;
    if (current === want) continue;
    // Belt and braces on top of the paged load above. Clearing a mark is the
    // only destructive thing this function does, and it is only sound when we
    // actually saw the parent and it still did not cluster with this row.
    // duplicate_of is `references bookings(id) on delete set null`, so a
    // non-null value always has a live parent: if that parent is absent from
    // the loaded set, this read was short and the mark must stand.
    if (want === null && current !== null && !loadedIds.has(current)) {
      skippedUnverifiable += 1;
      continue;
    }
    changed += 1;
    if (want === null) {
      toNull.push(r.id);
    } else {
      const arr = toCanonical.get(want);
      if (arr) arr.push(r.id);
      else toCanonical.set(want, [r.id]);
    }
  }
  if (skippedUnverifiable > 0) {
    console.warn(
      `[dedupe] ${skippedUnverifiable} row(s) kept their duplicate_of because the parent was not in the loaded set -- the bookings read looks short`,
    );
  }

  if (toNull.length > 0) {
    const { error: nullErr } = await sb
      .from('bookings')
      .update({ duplicate_of: null })
      .in('id', toNull);
    if (nullErr) throw new Error(`dedupe clear: ${nullErr.message}`);
  }
  for (const [canonicalId, ids] of toCanonical) {
    const { error: setErr } = await sb
      .from('bookings')
      .update({ duplicate_of: canonicalId })
      .in('id', ids);
    if (setErr) throw new Error(`dedupe set: ${setErr.message}`);
  }

  // Apply enrichment patches (one update per canonical that gained fields).
  let enriched = 0;
  for (const [canonicalId, patch] of enrichPatches) {
    const { error: enrichErr } = await sb
      .from('bookings')
      .update(patch)
      .eq('id', canonicalId);
    if (enrichErr) throw new Error(`dedupe enrich: ${enrichErr.message}`);
    enriched += 1;
  }

  return {
    clusters: clusterCount,
    duplicates: dupCount,
    changed,
    enriched,
    skipped_unverifiable: skippedUnverifiable,
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

/**
 * Parse a Guesty per-listing iCal event SUMMARY into its real channel and
 * confirmation code. Guesty formats reservations as "Reservation <CODE>"
 * where the code prefix identifies the channel:
 *   HM…  Airbnb          HA-  VRBO / HomeAway
 *   BC-  Booking.com     GY-  Guesty direct / manual
 * Events that aren't reservations (owner blocks, "Not available") carry no
 * code and are treated as blocks.
 */
function parseGuestySummary(summary: string | null): {
  channel: BookingChannel;
  code: string | null;
  isBlock: boolean;
} {
  const m = (summary ?? '').trim().match(/^Reservation\s+(\S+)/i);
  if (!m) return { channel: 'block', code: null, isBlock: true };
  const code = m[1];
  const u = code.toUpperCase();
  let channel: BookingChannel = 'other';
  if (u.startsWith('HM')) channel = 'airbnb';
  else if (u.startsWith('HA')) channel = 'vrbo';
  else if (u.startsWith('BC')) channel = 'booking_com';
  else if (u.startsWith('GY')) channel = 'direct';
  return { channel, code, isBlock: false };
}

export function _channelLabel(c: BookingChannel): string {
  return CHANNEL_LABELS[c];
}
