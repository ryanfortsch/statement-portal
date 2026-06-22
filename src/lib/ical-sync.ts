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
import { parseIcal, isBookingEvent, guessGuestNameFromIcal, isPlaceholderGuestName } from '@/lib/ical';
import { CHANNEL_LABELS, type BookingChannel, type BookingSource } from '@/lib/channels-types';
import { recordSyncFailure, recordSyncResult } from '@/lib/sync-status';

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
    // Mirrors the competitors sync's zero-result guard. The only case this
    // declines to act on is a feed that legitimately emptied to nothing, which
    // is rare for an active listing and ages out by checkout date anyway; that
    // is a safe trade against silently cancelling real upcoming stays.
    const liveExisting = (existing ?? []).filter((r) => r.status !== 'cancelled');
    if (rows.length === 0 && liveExisting.length > 0) {
      result.bookings_added = 0;
      result.bookings_updated = 0;
      result.bookings_cancelled = 0;
      result.success = false;
      result.error = `empty-feed guard: parsed 0 bookings but ${liveExisting.length} live booking(s) exist; skipped cancel pass (suspected transient or broken feed)`;
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
 * Canonical-source priority. When the same physical stay appears in
 * `bookings` from more than one source, the highest-priority row is kept
 * canonical and the rest get `duplicate_of` pointed at it.
 *
 * direct_booking / manual are Helm-native and authoritative. ical_import is
 * the live channel truth. guesty_legacy is the frozen historical backfill
 * and always loses.
 */
const SOURCE_PRIORITY: Record<BookingSource, number> = {
  direct_booking: 5,
  manual: 4,
  ical_import: 3,
  email_parse: 2,
  guesty_legacy: 1,
};

type DedupRow = {
  id: string;
  property_id: string;
  source: BookingSource;
  status: string;
  check_in: string;
  check_out: string;
  duplicate_of: string | null;
  created_at: string;
  cancelled_at: string | null;
  // Which channel_listings feed this row arrived on. Used to tell a direct OTA
  // feed (reliable cancel signal) apart from the Guesty aggregate feed (which
  // can transiently drop a still-confirmed reservation).
  channel_listing_id: string | null;
  // Enrichment fields: a deduped cluster pools these onto the canonical row,
  // since no single source has all of them (Airbnb/Guesty iCal lack the guest
  // name; the guesty_legacy backfill lacks the confirmation code, etc).
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  external_confirmation_code: string | null;
  external_booking_id: string | null;
  payout: number | null;
  gross_amount: number | null;
  num_guests: number | null;
};

const ENRICH_FIELDS = [
  'guest_name',
  'guest_email',
  'guest_phone',
  'external_confirmation_code',
  'external_booking_id',
  'payout',
  'gross_amount',
  'num_guests',
] as const;

/** Whole days between two YYYY-MM-DD dates, absolute. */
function dayGap(d1: string, d2: string): number {
  const a = Date.parse(`${d1}T00:00:00Z`);
  const b = Date.parse(`${d2}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / 86400_000;
}

/**
 * Two bookings represent the same physical stay if their date ranges
 * overlap AND both endpoints sit within one day of each other.
 *
 * The overlap requirement is what stops two *consecutive* stays (one
 * guest's checkout day is the next guest's checkin day) from being merged.
 * The one-day endpoint tolerance absorbs the off-by-one that iCal's
 * exclusive-DTEND semantics occasionally produce across channels.
 */
function sameStay(a: DedupRow, b: DedupRow): boolean {
  const overlaps = a.check_in < b.check_out && b.check_in < a.check_out;
  if (!overlaps) return false;
  return dayGap(a.check_in, b.check_in) <= 1 && dayGap(a.check_out, b.check_out) <= 1;
}

/** Trim to null so an empty external id never matches another empty one. */
function normId(v: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Two rows are the SAME reservation when they share a non-empty confirmation
 * code or booking id. This is the reliable cross-source join: a single Airbnb
 * stay arrives as a direct-feed iCal row, a Guesty aggregate-feed iCal row,
 * and a guesty_legacy row, all carrying the same channel confirmation code.
 */
function shareIdentity(a: DedupRow, b: DedupRow): boolean {
  const ca = normId(a.external_confirmation_code);
  const cb = normId(b.external_confirmation_code);
  if (ca && cb && ca === cb) return true;
  const ia = normId(a.external_booking_id);
  const ib = normId(b.external_booking_id);
  return !!(ia && ib && ia === ib);
}

/**
 * Two rows are EXPLICITLY different reservations when both carry a code (or
 * both a booking id) and they differ. Such a pair must never be merged by a
 * bare date overlap -- that's what keeps a cancel-then-rebook (fresh code on
 * the same dates) and a genuine same-date double-booking as separate stays.
 */
function conflictingIdentity(a: DedupRow, b: DedupRow): boolean {
  const ca = normId(a.external_confirmation_code);
  const cb = normId(b.external_confirmation_code);
  if (ca && cb && ca !== cb) return true;
  const ia = normId(a.external_booking_id);
  const ib = normId(b.external_booking_id);
  return !!(ia && ib && ia !== ib);
}

// Positive (non-cancelled) statuses, most-live first. Used to pick a cluster's
// effective status when no trustworthy cancellation is present.
const POSITIVE_STATUS_ORDER = ['completed', 'confirmed', 'pending', 'inquiry', 'block'];

/**
 * The effective status of a same-reservation cluster.
 *
 * A cancellation only "wins" when it comes from a TRUSTED source: a direct OTA
 * feed (Airbnb's own calendar export), or a Helm-native / Guesty-API row. The
 * Guesty per-listing AGGREGATE feed is excluded -- it has been observed to drop
 * a still-confirmed reservation (the direct Airbnb feed and the Guesty API both
 * kept showing it), so an aggregate-only disappearance must not hide a real
 * stay. When nothing trustworthy says cancelled, the most-live positive status
 * present wins; a cluster of nothing but aggregate cancellations is treated as
 * cancelled because there's no positive signal left.
 */
function clusterEffectiveStatus(
  cluster: DedupRow[],
  isFromAggregateFeed: (r: DedupRow) => boolean,
): string {
  const trustedCancel = cluster.some(
    (r) => r.status === 'cancelled' && !isFromAggregateFeed(r),
  );
  if (trustedCancel) return 'cancelled';
  for (const s of POSITIVE_STATUS_ORDER) {
    if (cluster.some((r) => r.status === s)) return s;
  }
  return 'cancelled';
}

/**
 * Pick the canonical row of a cluster. It must carry the cluster's effective
 * status so downstream reads (which filter on status) see the right thing
 * without us mutating any source row: prefer rows whose status equals the
 * effective status, then a real booking over a block, then higher source
 * priority, then the earliest-created row.
 */
function pickCanonical(cluster: DedupRow[], effectiveStatus: string): DedupRow {
  return [...cluster].sort((a, b) => {
    const aMatch = a.status === effectiveStatus ? 0 : 1;
    const bMatch = b.status === effectiveStatus ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;           // effective-status first
    const aBlock = a.status === 'block' ? 1 : 0;
    const bBlock = b.status === 'block' ? 1 : 0;
    if (aBlock !== bBlock) return aBlock - bBlock;            // non-block first
    const ap = SOURCE_PRIORITY[a.source] ?? 0;
    const bp = SOURCE_PRIORITY[b.source] ?? 0;
    if (ap !== bp) return bp - ap;                           // higher priority first
    return a.created_at.localeCompare(b.created_at);         // earliest first
  })[0];
}

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
  const { data, error } = await sb
    .from('bookings')
    .select('id, property_id, source, status, check_in, check_out, duplicate_of, created_at, cancelled_at, channel_listing_id, guest_name, guest_email, guest_phone, external_confirmation_code, external_booking_id, payout, gross_amount, num_guests');
  if (error) throw new Error(`dedupe load: ${error.message}`);

  // The Guesty per-listing feed (channel_listings.channel = 'guesty') is an
  // aggregate of every channel and has been seen to drop a still-confirmed
  // reservation. A cancellation that exists ONLY on the aggregate feed is not
  // trusted to hide a stay (a direct OTA feed or the Guesty API would still
  // show it); see clusterEffectiveStatus.
  const { data: listingData, error: listingErr } = await sb
    .from('channel_listings')
    .select('id, channel');
  if (listingErr) throw new Error(`dedupe load listings: ${listingErr.message}`);
  const aggregateListingIds = new Set(
    (listingData ?? []).filter((l) => l.channel === 'guesty').map((l) => l.id as string),
  );
  const isFromAggregateFeed = (r: DedupRow): boolean =>
    r.source === 'ical_import' &&
    r.channel_listing_id != null &&
    aggregateListingIds.has(r.channel_listing_id);

  const rows = (data ?? []) as DedupRow[];
  const byProperty = new Map<string, DedupRow[]>();
  for (const r of rows) {
    const list = byProperty.get(r.property_id);
    if (list) list.push(r);
    else byProperty.set(r.property_id, [r]);
  }

  const desired = new Map<string, string | null>();
  // Per-canonical field patches: fields the canonical is missing but a
  // duplicate in its cluster provides.
  const enrichPatches = new Map<string, Record<string, unknown>>();
  let clusterCount = 0;
  let dupCount = 0;

  for (const list of byProperty.values()) {
    // Union-find over same-stay pairs within the property.
    const parent = new Map<string, string>(list.map((r) => [r.id, r.id]));
    const find = (x: string): string => {
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root)!;
      let cur = x;
      while (parent.get(cur) !== root) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    const union = (x: string, y: string) => {
      const rx = find(x);
      const ry = find(y);
      if (rx !== ry) parent.set(rx, ry);
    };

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        // Same reservation across sources -> always one stay.
        if (shareIdentity(a, b)) {
          union(a.id, b.id);
          continue;
        }
        // Blocks (owner holds) are distinct calendar entities; only ever fold
        // them in by a shared id, never by a bare date overlap.
        if (a.status === 'block' || b.status === 'block') continue;
        // Don't let a date overlap merge two explicitly-different reservations.
        if (conflictingIdentity(a, b)) continue;
        // Same dates, no conflicting identity -> same stay (covers a direct-feed
        // row that lacks the channel code lining up with its Guesty twin).
        if (sameStay(a, b)) union(a.id, b.id);
      }
    }

    const clusters = new Map<string, DedupRow[]>();
    for (const r of list) {
      const root = find(r.id);
      const c = clusters.get(root);
      if (c) c.push(r);
      else clusters.set(root, [r]);
    }

    for (const cluster of clusters.values()) {
      if (cluster.length === 1) {
        desired.set(cluster[0].id, null);
        continue;
      }
      clusterCount += 1;
      const effective = clusterEffectiveStatus(cluster, isFromAggregateFeed);
      const canonical = pickCanonical(cluster, effective);
      for (const r of cluster) {
        if (r.id === canonical.id) {
          desired.set(r.id, null);
        } else {
          desired.set(r.id, canonical.id);
          dupCount += 1;
        }
      }

      // Pool enrichment fields onto the canonical: for each field the canonical
      // is missing, take the first value from a duplicate. guest_name is special
      // -- a placeholder ("Reservation HM…") counts as missing so a real name
      // from the Guesty side overwrites the iCal code.
      const patch: Record<string, unknown> = {};
      for (const field of ENRICH_FIELDS) {
        if (field === 'guest_name') {
          if (!isPlaceholderGuestName(canonical.guest_name)) continue;
          const donor = cluster.find(
            (r) => r.id !== canonical.id && !isPlaceholderGuestName(r.guest_name),
          );
          if (donor) patch.guest_name = (donor.guest_name as string).trim();
          continue;
        }
        if (canonical[field] != null) continue;
        const donor = cluster.find((r) => r.id !== canonical.id && r[field] != null);
        if (donor) patch[field] = donor[field];
      }
      if (Object.keys(patch).length > 0) {
        enrichPatches.set(canonical.id, patch);
      }
    }
  }

  // Write only changed rows, batched by target value to minimize round trips.
  const toNull: string[] = [];
  const toCanonical = new Map<string, string[]>();
  let changed = 0;
  for (const r of rows) {
    const want = desired.get(r.id) ?? null;
    if ((r.duplicate_of ?? null) === want) continue;
    changed += 1;
    if (want === null) {
      toNull.push(r.id);
    } else {
      const arr = toCanonical.get(want);
      if (arr) arr.push(r.id);
      else toCanonical.set(want, [r.id]);
    }
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

  return { clusters: clusterCount, duplicates: dupCount, changed, enriched };
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
