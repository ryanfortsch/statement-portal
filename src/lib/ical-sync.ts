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
  classifyIcalEvent,
  isBlockSummary,
  guessGuestNameFromIcal,
  isPlaceholderGuestName,
  airbnbConfirmationCode,
  bookedAtForImport,
  type IcalEvent,
} from '@/lib/ical';
import { CHANNEL_LABELS, type BookingChannel } from '@/lib/channels-types';
import { recordSyncFailure, recordSyncResult } from '@/lib/sync-status';
import { selectAllPaged } from '@/lib/paged-select';
import { planDedupe, type DedupRow } from '@/lib/booking-dedupe';
import { planCancelPass, keepsEmptyFeedGuardUp, holdsAreReservations, type CancelGuard } from '@/lib/ical-cancel-policy';
import { loadAggregateFeedPropertyIds, hasAggregateFeed, loadHelmRunCutovers } from '@/lib/pms-guards';

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
  /** Rows marked cancelled as stays or holds that left the feed (rolled-off
   *  past rows, and upcoming rows observed missing on two separate runs at
   *  least CANCEL_AFTER_MISSING_MS apart). */
  bookings_cancelled: number;
  /** Upcoming rows missing this run but not yet observed missing long enough
   *  to cancel, plus any the mass-cancel guard held. Only missing_since is
   *  written for these (on the first observation). */
  bookings_deferred: number;
  /** Rows a direct feed had stored as confirmed whose summary was a hold,
   *  cancelled now as a reclassification (never a stay cancel). */
  bookings_reclassified: number;
  /** 'mass_cancel' when too many upcoming stays vanished at once and the
   *  upcoming cancel set was held for review; 'empty_feed' when the feed
   *  parsed to nothing while upcoming stays were on file and the whole
   *  cancel pass was skipped; null otherwise. Either is released once by
   *  channel_listings.mass_cancel_acknowledged_at. */
  guard: CancelGuard;
  /** True when the operator's release (mass_cancel_acknowledged_at) let a
   *  set a guard would have held cancel this run (either guard). */
  mass_cancel_released: boolean;
  error: string | null;
  duration_ms: number;
};

/** How long one feed fetch may take, body included. A hung OTA endpoint
 *  used to hold the sequential listing loop until the cron function died at
 *  maxDuration, and every listing after it went unsynced that beat. */
export const FEED_FETCH_TIMEOUT_MS = 20_000;

/** Ids per `.in('id', ...)` write, so a large cancel set never builds an
 *  over-long request URL. */
const ID_WRITE_CHUNK = 200;

/** The columns the cancel pass reads off an existing ical_import row. */
type ExistingRow = {
  id: string;
  ical_uid: string;
  status: string;
  check_in: string;
  check_out: string;
  missing_since: string | null;
  raw_summary: string | null;
};

/** What the sync writes per event. booked_at is added on the insert only. */
type UpsertRow = {
  property_id: string;
  channel_listing_id: string;
  channel: BookingChannel;
  source: 'ical_import';
  ical_uid: string;
  check_in: string;
  check_out: string;
  nights: number | null;
  status: 'confirmed' | 'block';
  hold_kind: 'ota' | null;
  guest_name: string | null;
  external_confirmation_code: string | null;
  raw_summary: string | null;
  raw_description: string | null;
  raw_url: string | null;
  last_seen_at: string;
  /** Always null: the event is in the feed, so any earlier "first seen
   *  missing" observation is void (lib/ical-cancel-policy rule 3). */
  missing_since: null;
};

/**
 * Sync a single channel listing. Wraps fetch + parse + upsert + log.
 *
 * `aggregateFeedPropertyIds` is the set of property ids that still carry an
 * active Guesty aggregate feed (loadAggregateFeedPropertyIds); syncAllListings
 * loads it once per run. Absent, it is loaded here.
 *
 * `massCancelAcknowledgedAt` is channel_listings.mass_cancel_acknowledged_at,
 * the operator's release for the mass-cancel guard; syncAllListings passes
 * the value it read with the listing. Absent (undefined), it is read here.
 * A run that reaches the cancel pass consumes it: the guard is skipped for
 * that one run and the stamp is cleared, so it never stands as an exemption
 * for the next broken feed. A run that fails before the cancel pass leaves
 * it for the next one.
 */
export async function syncListing(opts: {
  listing_id: string;
  property_id: string;
  channel: BookingChannel;
  display_name: string | null;
  ical_import_url: string;
  aggregateFeedPropertyIds?: Set<string>;
  massCancelAcknowledgedAt?: string | null;
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
    bookings_deferred: 0,
    bookings_reclassified: 0,
    guard: null,
    mass_cancel_released: false,
    error: null,
    duration_ms: 0,
  };

  let httpStatus: number | null = null;
  let responseSize = 0;

  try {
    // --- Fetch ---
    // Bounded (FEED_FETCH_TIMEOUT_MS covers the body too): one hung OTA must
    // not starve every later listing of the run.
    let text: string;
    try {
      const res = await fetch(opts.ical_import_url, {
        headers: { Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' },
        cache: 'no-store',
        signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
      });
      httpStatus = res.status;
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${maskUrl(opts.ical_import_url)}`);
      }
      text = await res.text();
    } catch (err) {
      const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error(`timed out after ${FEED_FETCH_TIMEOUT_MS / 1000}s fetching ${maskUrl(opts.ical_import_url)}`);
      }
      throw err;
    }
    responseSize = text.length;

    // --- Parse ---
    const events = parseIcal(text);
    result.events_total = events.length;

    // --- Classify and build upsert rows ---
    // A Guesty per-listing feed (channel='guesty') is an aggregate of every
    // channel; parse each event into its real channel + confirmation code. A
    // normal single-channel feed uses the listing's own channel, and
    // classifyIcalEvent (lib/ical) says per channel whether an event is a
    // stay, a block or nothing. The old filter dropped every summary
    // containing "available" and stored the rest as confirmed, so Airbnb's
    // "Airbnb (Not available)" vanished and a VRBO "Blocked" became a guest.
    //
    // While a home still rides Guesty's aggregate feed, a direct feed's
    // blocks are echoes of the availability Guesty pushed to that OTA (and
    // Guesty's own holds arrive on the aggregate feed), so they are dropped
    // here, which is exactly what the old filter did to them. A home with
    // no active aggregate feed, or one whose OTAs already import Helm's
    // export (the cutover window, lib/pms-guards), stores them as blocks.
    const isGuestyFeed = opts.channel === 'guesty';
    const aggregateFeeds = opts.aggregateFeedPropertyIds ?? (await loadAggregateFeedPropertyIds(sb));
    const dropDirectBlocks = !isGuestyFeed && hasAggregateFeed(aggregateFeeds, opts.property_id);
    const rows: UpsertRow[] = [];
    // CREATED / DTSTAMP per uid, for booked_at on the rows that turn out new.
    const stampsByUid = new Map<string, Pick<IcalEvent, 'created' | 'dtstamp'>>();
    for (const e of events) {
      const kind = classifyIcalEvent(e, opts.channel);
      if (kind === 'skip') continue;
      let channel: BookingChannel = opts.channel;
      let externalConfirmationCode: string | null = null;
      let status: 'confirmed' | 'block' = kind === 'block' ? 'block' : 'confirmed';
      let holdKind: 'ota' | null = null;
      if (isGuestyFeed) {
        const parsed = parseGuestySummary(e.summary);
        channel = parsed.channel;
        externalConfirmationCode = parsed.code;
        status = parsed.isBlock ? 'block' : 'confirmed';
      } else if (kind === 'block') {
        if (dropDirectBlocks) continue;
        holdKind = 'ota';
      } else {
        // A direct Airbnb feed names no guest but links the reservation in
        // DESCRIPTION; the code in that link is the cross-source identity
        // the dedupe joins on. Anything else (VRBO) yields null.
        externalConfirmationCode = airbnbConfirmationCode(e.description);
      }
      // A hold has no guest; "Airbnb (Not available)" must not become one.
      const guest = status === 'block' ? null : guessGuestNameFromIcal(e);
      rows.push({
        property_id: opts.property_id,
        channel_listing_id: opts.listing_id,
        channel,
        source: 'ical_import',
        ical_uid: e.uid,
        check_in: e.dtstart,
        check_out: e.dtend,
        nights: nightsBetween(e.dtstart, e.dtend),
        status,
        hold_kind: holdKind,
        guest_name: guest,
        external_confirmation_code: externalConfirmationCode,
        raw_summary: e.summary,
        raw_description: e.description,
        raw_url: e.url,
        last_seen_at: startedAt.toISOString(),
        missing_since: null,
        // first_seen_at intentionally unset: the DB default applies on
        // insert, the upsert path below preserves the existing value on
        // update. booked_at is added on the insert set only, below.
      });
      stampsByUid.set(e.uid, { created: e.created ?? null, dtstamp: e.dtstamp ?? null });
    }

    // --- Diff to count adds/updates/cancels ---
    // Paged: cancelled rows are kept forever as history, so a busy listing
    // outgrows PostgREST's silent 1000-row cap. A short read here would send
    // live rows down the insert path (overcounting adds) and hide them from
    // the cancel pass, so a stay past the cap could never cancel.
    const incomingUids = new Set(rows.map((r) => r.ical_uid));
    const existing = await selectAllPaged<ExistingRow>(
      (from, to) =>
        sb
          .from('bookings')
          .select('id, ical_uid, status, check_in, check_out, missing_since, raw_summary')
          .eq('channel_listing_id', opts.listing_id)
          .eq('source', 'ical_import')
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'select existing' },
    );

    const existingByUid = new Map<string, ExistingRow>(existing.map((r) => [r.ical_uid, r]));

    let updated = 0;
    for (const row of rows) {
      const prior = existingByUid.get(row.ical_uid);
      if (
        prior &&
        (prior.check_in !== row.check_in ||
          prior.check_out !== row.check_out ||
          prior.status !== row.status)
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
    // Stays only, except on Booking.com, whose closures may be guests: a
    // lifted hold that was an Airbnb or VRBO feed's last event must be able
    // to cancel (lib/ical-cancel-policy keepsEmptyFeedGuardUp).
    const reservationHolds = holdsAreReservations(opts.channel);
    const liveExisting = existing.filter((r) => keepsEmptyFeedGuardUp(r, cutoff, isBlockSummary, reservationHolds));
    // The operator's release, when one is waiting: it lets either guard
    // through once (the empty-feed guard here, the mass-cancel guard in the
    // cancel pass), then it is consumed below.
    const ackAt =
      opts.massCancelAcknowledgedAt === undefined
        ? await readMassCancelAck(sb, opts.listing_id)
        : opts.massCancelAcknowledgedAt;
    // An empty feed with rows on file that keep its guard up is released
    // only by an operator answering THAT guard (the listing's newest run was
    // 'empty_feed'): a release given for a mass cancel must never become
    // licence to empty the whole calendar because the endpoint broke next.
    const emptyFeed = rows.length === 0 && liveExisting.length > 0;
    const emptyReleased = emptyFeed && !!ackAt && (await readLastGuard(sb, opts.listing_id)) === 'empty_feed';
    if (emptyFeed && !emptyReleased) {
      result.bookings_added = 0;
      result.bookings_updated = 0;
      result.bookings_cancelled = 0;
      result.success = false;
      result.guard = 'empty_feed';
      result.error = `empty-feed guard: parsed 0 bookings but ${liveExisting.length} upcoming booking(s) exist; skipped cancel pass (suspected transient or broken feed)`;
    } else {
      // Anything previously imported but missing this run has disappeared.
      // planCancelPass (lib/ical-cancel-policy) decides what that means:
      // a rolled-off past row and a hold stored as confirmed cancel now; an
      // upcoming row is stamped missing_since on its first observed absence
      // and cancels only on a later run that still misses it; and no upcoming
      // stay cancels when too many vanish at once, unless the operator has
      // released the guard. Mark cancelled rather than delete, to keep history.
      const plan = planCancelPass({
        existing,
        incomingUids,
        uidOf: (r) => (r as ExistingRow).ical_uid,
        now: startedAt,
        todayIso: cutoff,
        isBlockSummary,
        allowMassCancel: !!ackAt,
        holdsAreReservations: reservationHolds,
        // The operator confirmed the empty feed: their word is the second
        // look, so what is missing cancels now rather than starting the
        // two-look clock (which the guard would trip over again next beat).
        treatMissingAsReady: emptyReleased,
      });

      // --- Upsert ---
      // booked_at is written on a genuine insert and never again. PostgREST
      // takes the column list from the first object, so rows already on
      // file go in a separate write that does not carry the key at all.
      // The insert itself is ON CONFLICT DO NOTHING: a row the listing read
      // did not return can still exist under (channel, ical_uid) (its
      // channel_listing_id was nulled when a feed row was deleted and
      // re-added), and an upsert would overwrite its stamp. Whatever the
      // insert did not create joins the update write instead.
      const newRows = rows.filter((r) => !existingByUid.has(r.ical_uid));
      const updates = rows.filter((r) => existingByUid.has(r.ical_uid));
      let added = 0;
      if (newRows.length > 0) {
        const firstImport = existing.length === 0 && !(await hasSucceededBefore(sb, opts.listing_id));
        const inserts = newRows.map((r) => ({
          ...r,
          booked_at: bookedAtForImport(stampsByUid.get(r.ical_uid) ?? {}, { fetchedAt: startedAt, firstImport }),
        }));
        const { data: insertedData, error: insertErr } = await sb
          .from('bookings')
          .upsert(inserts, { onConflict: 'channel,ical_uid', ignoreDuplicates: true })
          .select('channel, ical_uid');
        if (insertErr) throw new Error(`insert bookings (new): ${insertErr.message}`);
        const created = new Set(
          ((insertedData ?? []) as Array<{ channel: string; ical_uid: string }>).map((r) => `${r.channel}|${r.ical_uid}`),
        );
        for (const r of newRows) {
          if (created.has(`${r.channel}|${r.ical_uid}`)) added += 1;
          else {
            updates.push(r);
            updated += 1;
          }
        }
      }
      if (updates.length > 0) {
        const { error: upsertErr } = await sb
          .from('bookings')
          .upsert(updates, { onConflict: 'channel,ical_uid' });
        if (upsertErr) throw new Error(`upsert bookings: ${upsertErr.message}`);
      }
      // First observation of an absence: stamp it, so the next run that
      // still misses the row can count a second look (rule 3). Only where
      // unset, so a concurrent run cannot push an earlier stamp later.
      for (const ids of chunk(plan.stampMissing, ID_WRITE_CHUNK)) {
        const { error: stampErr } = await sb
          .from('bookings')
          .update({ missing_since: startedAt.toISOString() })
          .in('id', ids)
          .is('missing_since', null);
        if (stampErr) throw new Error(`stamp missing: ${stampErr.message}`);
      }
      for (const ids of chunk(plan.cancelNow, ID_WRITE_CHUNK)) {
        const { error: cancelErr } = await sb
          .from('bookings')
          .update({
            status: 'cancelled',
            cancelled_at: startedAt.toISOString(),
            cancelled_by: 'ical-sync',
            cancel_reason: 'missing_from_feed',
          })
          .in('id', ids);
        if (cancelErr) throw new Error(`cancel bookings: ${cancelErr.message}`);
      }
      for (const ids of chunk(plan.reclassified, ID_WRITE_CHUNK)) {
        const { error: reclassErr } = await sb
          .from('bookings')
          .update({
            status: 'cancelled',
            cancelled_at: startedAt.toISOString(),
            cancelled_by: 'ical-sync',
            cancel_reason: 'reclassified_hold',
          })
          .in('id', ids);
        if (reclassErr) throw new Error(`reclassify holds: ${reclassErr.message}`);
      }

      result.bookings_added = added;
      result.bookings_updated = updated;
      result.bookings_cancelled = plan.cancelNow.length;
      result.bookings_deferred = plan.deferred.length;
      result.bookings_reclassified = plan.reclassified.length;
      result.guard = plan.guard;
      result.mass_cancel_released = plan.released || emptyReleased;
      if (plan.guard === 'mass_cancel') {
        const d = plan.guardDetail;
        result.success = false;
        result.error = `mass-cancel guard: ${d.upcoming_missing} of ${d.upcoming_live} upcoming stay(s) vanished from the feed (threshold ${d.threshold}); held them and skipped the upcoming cancel pass (suspected transient or broken feed)`;
      } else {
        result.success = true;
      }

      // The release answered this run; consume it. Conditional on the value
      // read, so a newer click made while this run was in flight survives
      // for the next one.
      if (ackAt) {
        const { error: clearErr } = await sb
          .from('channel_listings')
          .update({ mass_cancel_acknowledged_at: null })
          .eq('id', opts.listing_id)
          .lte('mass_cancel_acknowledged_at', ackAt);
        if (clearErr) {
          result.success = false;
          result.error = `mass-cancel release applied but its stamp could not be cleared: ${clearErr.message}`;
        }
      }
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
    // Every row this run marked cancelled, reclassified holds included; the
    // result splits them, the run log records what happened to the table.
    bookings_cancelled: result.bookings_cancelled + result.bookings_reclassified,
    bookings_deferred: result.bookings_deferred,
    bookings_reclassified: result.bookings_reclassified,
    guard: result.guard,
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
  /** Sum of bookings_deferred across listings. */
  deferred: number;
  /** Sum of bookings_reclassified across listings. */
  reclassified: number;
  /** Listings whose mass-cancel or empty-feed guard tripped this run. */
  guarded: number;
  results: SyncListingResult[];
  dedup: DedupResult | null;
}> {
  try {
    const sb = getServiceClient();
    let q = sb
      .from('channel_listings')
      .select('id, property_id, channel, display_name, ical_import_url, ical_import_enabled, is_active, mass_cancel_acknowledged_at');
    if (opts.onlyListingId) q = q.eq('id', opts.onlyListingId);

    const { data, error } = await q;
    if (error) throw new Error(`load channel_listings: ${error.message}`);

    const eligible = (data ?? []).filter(
      (l) => l.is_active && l.ical_import_enabled && !!l.ical_import_url,
    );

    // Which homes still ride Guesty's aggregate feed, read once per run:
    // their direct-feed blocks are dropped at import (see syncListing).
    const aggregateFeedPropertyIds = await loadAggregateFeedPropertyIds(sb);

    const results: SyncListingResult[] = [];
    for (const l of eligible) {
      const r = await syncListing({
        listing_id: l.id as string,
        property_id: l.property_id as string,
        channel: l.channel as BookingChannel,
        display_name: l.display_name as string | null,
        ical_import_url: l.ical_import_url as string,
        aggregateFeedPropertyIds,
        massCancelAcknowledgedAt: (l.mass_cancel_acknowledged_at as string | null) ?? null,
      });
      results.push(r);
    }

    // Closures whose feed is no longer read, retired on every full run (a
    // run for one listing does not see the others as eligible). The listing
    // actions retire them when a feed is removed; this heals the race where
    // a sync already in flight wrote one back live afterwards, or a retire
    // that threw. Never fails the sync.
    let staleHoldsRetired = 0;
    if (!opts.onlyListingId) {
      try {
        staleHoldsRetired = await retireStaleOtaHolds(sb, new Set(eligible.map((l) => l.id as string)));
      } catch (err) {
        console.error('[ical-sync] stale-hold sweep failed:', err);
      }
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
    const deferred = results.reduce((n, r) => n + r.bookings_deferred, 0);
    const reclassified = results.reduce((n, r) => n + r.bookings_reclassified, 0);
    const guarded = results.filter((r) => r.guard !== null).length;
    const firstFailed = results.find((r) => !r.success);
    await recordSyncResult('ical', {
      processed: succeeded,
      failed,
      firstError: firstFailed
        ? `${firstFailed.display_name ?? firstFailed.listing_id}: ${firstFailed.error ?? 'unknown'}`
        : undefined,
      result: { succeeded, failed, total: results.length, deferred, reclassified, guarded, stale_holds_retired: staleHoldsRetired },
    });

    return {
      total: results.length,
      succeeded,
      failed,
      deferred,
      reclassified,
      guarded,
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
        .select('id, property_id, source, status, check_in, check_out, duplicate_of, created_at, cancelled_at, channel_listing_id, channel, raw_summary, guest_name, guest_email, guest_phone, external_confirmation_code, external_booking_id, payout, gross_amount, num_guests')
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
  } = planDedupe(rows, {
    isFromAggregateFeed,
    isPlaceholderGuestName,
    isBlockSummary,
    // Helm-run homes and their cutover moments (lib/booking-dedupe
    // DedupOptions). A failed read throws: the dedupe run fails and the
    // previous marks stand, rather than a run on Guesty rules being written.
    ...(await strictOptions(sb)),
  });

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

  // Apply enrichment patches (one update per canonical whose pooled fields
  // change: filled from a twin, or a borrowed booking id corrected or cleared).
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

/**
 * Cancel every live OTA closure (source ical_import, status block,
 * hold_kind 'ota') whose feed is no longer read: no listing (the row was
 * deleted) or a listing outside `eligible` (retired, import disabled, no
 * URL). Such a closure can never be cancelled by its feed again, and it
 * holds its nights on staycapeann.com and in the writer's overlap check.
 *
 * Booking.com's are left live on purpose (lib/ical-cancel-policy
 * holdsAreReservations): one may be a guest, and it is the one kind Helm
 * forwards to Airbnb and VRBO. The channel hub lists them for the operator.
 */
async function retireStaleOtaHolds(sb: SupabaseClient, eligible: ReadonlySet<string>): Promise<number> {
  const live = await selectAllPaged<{ id: string; channel: string; channel_listing_id: string | null }>(
    (from, to) =>
      sb
        .from('bookings')
        .select('id, channel, channel_listing_id')
        .eq('source', 'ical_import')
        .eq('status', 'block')
        .eq('hold_kind', 'ota')
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'stale ota holds' },
  );
  const stale = live
    .filter((r) => !holdsAreReservations(r.channel))
    .filter((r) => !r.channel_listing_id || !eligible.has(r.channel_listing_id))
    .map((r) => r.id);
  for (const ids of chunk(stale, ID_WRITE_CHUNK)) {
    const { error } = await sb
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: 'ical-sync',
        cancel_reason: 'feed_retired',
      })
      .in('id', ids)
      .eq('status', 'block');
    if (error) throw new Error(`retire stale holds: ${error.message}`);
  }
  return stale.length;
}

/** The dedupe's Helm-run options, from one registry read that throws. */
async function strictOptions(sb: SupabaseClient): Promise<{ strictChannelPropertyIds: Set<string>; cutoverAtByProperty: Map<string, string> }> {
  const cutovers = await loadHelmRunCutovers(sb);
  const cutoverAtByProperty = new Map<string, string>();
  for (const [id, at] of cutovers) if (at) cutoverAtByProperty.set(id, at);
  return { strictChannelPropertyIds: new Set(cutovers.keys()), cutoverAtByProperty };
}

/** The guard on the listing's newest sync run, or null (none, or a failed
 *  read: a read error never releases a guard). */
async function readLastGuard(sb: SupabaseClient, listingId: string): Promise<string | null> {
  const { data, error } = await sb
    .from('ical_sync_runs')
    .select('guard')
    .eq('channel_listing_id', listingId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return ((data as { guard?: string | null }).guard as string | null) ?? null;
}

/** channel_listings.mass_cancel_acknowledged_at for one listing; null on a
 *  failed read, so a read error never releases the guard. */
async function readMassCancelAck(sb: SupabaseClient, listingId: string): Promise<string | null> {
  const { data, error } = await sb
    .from('channel_listings')
    .select('mass_cancel_acknowledged_at')
    .eq('id', listingId)
    .maybeSingle();
  if (error || !data) return null;
  return ((data as { mass_cancel_acknowledged_at?: string | null }).mass_cancel_acknowledged_at as string | null) ?? null;
}

/**
 * Has this listing ever completed a successful import? A listing with no
 * rows on file AND no successful run is on its first import, where every
 * stay already on the calendar is new to Helm but not newly booked
 * (bookedAtForImport). A listing that imported an empty calendar before is
 * not: its next new UID really is a new booking. A failed read answers
 * false, the side that keeps nine stale "new booking" texts from going out.
 */
async function hasSucceededBefore(sb: SupabaseClient, listingId: string): Promise<boolean> {
  const { data, error } = await sb
    .from('ical_sync_runs')
    .select('id')
    .eq('channel_listing_id', listingId)
    .eq('success', true)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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
