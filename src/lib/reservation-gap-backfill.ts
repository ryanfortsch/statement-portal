/**
 * Reservation gap audit -- the standing check that every sold night has a
 * reservation behind it, and the repair when one does not.
 *
 * WHY A STANDING CHECK. `/v1/reservations` has now silently dropped whole
 * classes of reservation twice. It stopped returning a stay the moment it left
 * `confirmed` (the cancel leak, healed by lib/reservation-reconcile.ts), and it
 * only ever returned stays whose checkIn was today or later, so anything booked
 * and started between two pulls was never captured at all -- 225 Washington's
 * Andrea Richmond, Aug 22-29 2026, booked at 2:10 PM on the morning she
 * arrived, was absent from `bookings` three days later while she was in the
 * house. #1334 fixed that second one by moving the floor server-side.
 *
 * Both were invisible for weeks for the same reason: nothing compared the feed
 * against anything. A pull that returns 400 rows instead of 600 looks exactly
 * like a pull with 400 reservations. reconcileStaleReservations() cannot cover
 * it either -- it re-queries rows it already has by confirmationCode, and a
 * stay that never landed has no row and so no code to query with. This pass is
 * the missing half: an invariant that fails loudly instead of a feed trusted to
 * be complete.
 *
 * THE SECOND OPINION. Guesty's per-day availability calendar is a separate
 * endpoint with separate filtering, and Helm already mirrors it into
 * `property_calendar_days` on the 30-minute channels-sync beat. It reported
 * Andrea's nights as sold the whole time she was missing. So:
 *
 *   1. take every `booked` day in the window from the mirror
 *   2. subtract the nights covered by a known, non-cancelled reservation
 *   3. what is left is sold with nothing on file
 *   4. re-fetch just those listings from Guesty, narrowed to the run's window
 *   5. run the guesty_reservations -> bookings backfill so a recovered stay
 *      reaches the turnover rail, revenue, cleaner scheduling and messaging
 *
 * Detection is exact and free; only step 4 talks to Guesty, and only when a
 * gap exists, so the steady-state cost is one paged database read. It also
 * reaches where the bulk feed cannot: the feed is scoped to a 90-day floor, so
 * a stay older than that is gone for good once missed -- 73 Rocky Neck, May
 * 3-8 2026, five sold nights with no reservation, still open on 2026-08-25.
 *
 * Unresolved runs back off via a probe memo, because a run can be legitimately
 * un-fetchable (a Guesty-side hold that reads as sold, a listing outside our
 * map) and a permanent gap must not become a permanent probe loop.
 *
 * PR #1330 taught the field packets calendar to read this same mirror as an
 * occupancy backstop. This closes the hole underneath it.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { getGuestyToken } from '@/lib/guesty-client';
import { selectAllPaged } from '@/lib/paged-select';
import { recordSyncFailure, recordSyncResult } from '@/lib/sync-status';
import { backfillGuestyToBookings } from '@/lib/guesty-backfill';
import {
  fetchListingReservations,
  mapReservationRow,
  upsertGuestyReservations,
  type GuestyReservation,
} from '@/lib/guesty-reservations';
import {
  expandNights,
  staysOverlap,
  uncoveredRuns,
  type BookedRun,
} from '@/lib/booked-runs';

/** Runs probed per pass. Bounds the Guesty calls a single sweep can make. */
const MAX_RUNS_PER_PASS = 8;
/** How long an unresolved run rests before it is probed again. */
const PROBE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Statuses that mean nobody is actually staying, so a row carrying one can
 * never be the thing behind a sold night. `inquiry` belongs here -- Guesty
 * holds 180 of them and an inquiry sitting over a genuinely-missing stay would
 * mask it. `closed` does NOT: that is a completed stay, closed out.
 */
const NON_OCCUPYING_STATUSES = new Set([
  'canceled',
  'cancelled',
  'declined',
  'expired',
  'inquiry',
]);

/** Cap on what a single pass writes into sync_status.last_result. Runs are
 *  single digits in normal operation; this only stops a fleet-wide mirror
 *  desync from writing an unbounded blob every half hour. */
const MAX_REPORTED = 50;

export type { BookedRun };

export type ReservationGapResult = {
  window: { startDate: string; endDate: string };
  booked_days: number;
  runs_found: number;
  runs_probed: number;
  runs_skipped_cooldown: number;
  reservations_inserted: number;
  recovered: Array<{
    property_id: string;
    check_in: string | null;
    check_out: string | null;
    confirmation_code: string | null;
    guest_name: string | null;
    status: string | null;
  }>;
  unresolved: BookedRun[];
  bookings_backfill: { inserted: number; updated: number; deduped: number } | null;
  errors?: string[];
};

function runKey(r: BookedRun): string {
  return `${r.property_id}|${r.check_in}|${r.check_out}`;
}

/**
 * Diff the calendar mirror against `guesty_reservations` for [startDate,
 * endDate] and recover whatever is missing. Never throws: per-run failures
 * collect into `errors` and are recorded against the `guesty-reservation-gaps`
 * feed so a broken probe surfaces in the daily brief instead of going quiet.
 */
export async function backfillReservationGaps(opts: {
  startDate: string;
  endDate: string;
  /** Ignore the probe cooldown (manual re-run). */
  force?: boolean;
  maxRuns?: number;
}): Promise<ReservationGapResult> {
  const { startDate, endDate } = opts;
  const maxRuns = opts.maxRuns ?? MAX_RUNS_PER_PASS;
  const sb = supabaseAdmin;
  const errors: string[] = [];

  const result: ReservationGapResult = {
    window: { startDate, endDate },
    booked_days: 0,
    runs_found: 0,
    runs_probed: 0,
    runs_skipped_cooldown: 0,
    reservations_inserted: 0,
    recovered: [],
    unresolved: [],
    bookings_backfill: null,
  };

  try {
    // 1. Booked nights from the mirror. Paged: a full 15-month window across
    //    the fleet is ~9k rows, well past PostgREST's silent 1000-row cap.
    const bookedRows = await selectAllPaged<{ property_id: string; date: string }>(
      (from, to) =>
        sb
          .from('property_calendar_days')
          .select('property_id, date')
          .eq('status', 'booked')
          .gte('date', startDate)
          .lte('date', endDate)
          .order('property_id', { ascending: true })
          .order('date', { ascending: true })
          .range(from, to),
      { label: 'calendar-day gap scan' },
    );
    result.booked_days = bookedRows.length;
    if (bookedRows.length === 0) {
      await recordSyncResult('guesty-reservation-gaps', {
        processed: 0,
        failed: 0,
        result: result as unknown as Record<string, unknown>,
      });
      return result;
    }

    const bookedByProperty = new Map<string, Set<string>>();
    for (const row of bookedRows) {
      const set = bookedByProperty.get(row.property_id) ?? new Set<string>();
      set.add(row.date);
      bookedByProperty.set(row.property_id, set);
    }

    // 2. Nights already accounted for by a real stay. A cancelled or
    //    inquiry-only row covers nothing -- if the mirror still calls the
    //    night sold, the two disagree and we want the probe.
    const reservationRows = await selectAllPaged<{
      property_id: string | null;
      check_in: string | null;
      check_out: string | null;
      status: string | null;
    }>(
      (from, to) =>
        sb
          .from('guesty_reservations')
          .select('property_id, check_in, check_out, status')
          .lte('check_in', endDate)
          .gt('check_out', startDate)
          .order('guesty_reservation_id', { ascending: true })
          .range(from, to),
      { label: 'reservation gap scan' },
    );

    const coveredByProperty = new Map<string, Set<string>>();
    for (const r of reservationRows) {
      if (!r.property_id || !r.check_in || !r.check_out) continue;
      if (NON_OCCUPYING_STATUSES.has((r.status ?? '').toLowerCase())) continue;
      const set = coveredByProperty.get(r.property_id) ?? new Set<string>();
      for (const night of expandNights(r.check_in, r.check_out)) set.add(night);
      coveredByProperty.set(r.property_id, set);
    }

    // 3. The runs.
    const allRuns: BookedRun[] = [];
    for (const [propertyId, booked] of bookedByProperty) {
      allRuns.push(
        ...uncoveredRuns(propertyId, booked, coveredByProperty.get(propertyId) ?? new Set()),
      );
    }
    allRuns.sort((a, b) => (a.check_in < b.check_in ? 1 : a.check_in > b.check_in ? -1 : 0));
    result.runs_found = allRuns.length;
    if (allRuns.length === 0) {
      await writeMemo({}, result, errors);
      return result;
    }

    // Cooldown: a run we already probed and failed to resolve rests before it
    // costs another set of Guesty calls.
    const memo = await readProbeMemo(sb);
    const now = Date.now();
    const eligible = opts.force
      ? allRuns
      : allRuns.filter((r) => {
          const last = memo[runKey(r)];
          const lastMs = last ? Date.parse(last) : NaN;
          return Number.isNaN(lastMs) || now - lastMs >= PROBE_COOLDOWN_MS;
        });
    result.runs_skipped_cooldown = allRuns.length - eligible.length;
    const probing = eligible.slice(0, maxRuns);
    result.runs_probed = probing.length;

    if (probing.length === 0) {
      result.unresolved = allRuns;
      await writeMemo(memo, result, errors);
      return result;
    }

    // 4. Re-fetch the listings behind those runs.
    const { data: listingRows, error: listingErr } = await sb
      .from('guesty_listings')
      .select('listing_id, property_id');
    if (listingErr) throw new Error(`guesty_listings read: ${listingErr.message}`);
    const listingsByProperty = new Map<string, string[]>();
    const propertyByListing = new Map<string, string>();
    for (const l of (listingRows ?? []) as Array<{ listing_id: string; property_id: string }>) {
      if (!l.listing_id || !l.property_id) continue;
      propertyByListing.set(l.listing_id, l.property_id);
      const list = listingsByProperty.get(l.property_id) ?? [];
      list.push(l.listing_id);
      listingsByProperty.set(l.property_id, list);
    }

    const known = new Set(
      (
        await selectAllPaged<{ guesty_reservation_id: string }>(
          (from, to) =>
            sb
              .from('guesty_reservations')
              .select('guesty_reservation_id')
              .order('guesty_reservation_id', { ascending: true })
              .range(from, to),
          { label: 'known reservation ids' },
        )
      ).map((r) => r.guesty_reservation_id),
    );

    const token = await getGuestyToken();
    const syncedAt = new Date().toISOString();
    // One fetch per (listing, run window); several runs on one listing in the
    // same pass reuse it.
    const fetched = new Map<string, GuestyReservation[]>();
    const fresh = new Map<string, { reservation: GuestyReservation; propertyId: string }>();

    for (const run of probing) {
      const listingIds = listingsByProperty.get(run.property_id) ?? [];
      if (listingIds.length === 0) {
        errors.push(`${run.property_id}: no Guesty listing mapped, cannot probe`);
        continue;
      }
      for (const listingId of listingIds) {
        const cacheKey = `${listingId}|${run.check_in}|${run.check_out}`;
        if (!fetched.has(cacheKey)) {
          try {
            fetched.set(
              cacheKey,
              await fetchListingReservations(token, listingId, {
                from: run.check_in,
                to: run.check_out,
              }),
            );
          } catch (err) {
            fetched.set(cacheKey, []);
            errors.push(
              `${run.property_id}/${listingId} ${run.check_in}: ${err instanceof Error ? err.message : String(err)}`,
            );
            continue;
          }
        }
        for (const r of fetched.get(cacheKey)!) {
          if (!r?._id || known.has(r._id) || fresh.has(r._id)) continue;
          const propertyId = r.listingId ? propertyByListing.get(r.listingId) : undefined;
          if (!propertyId) continue;
          fresh.set(r._id, { reservation: r, propertyId });
        }
      }
    }

    const rows = [...fresh.values()].map(({ reservation, propertyId }) =>
      mapReservationRow(reservation, propertyId, syncedAt),
    );
    if (rows.length > 0) {
      await upsertGuestyReservations(sb, rows);
      result.reservations_inserted = rows.length;
      result.recovered = rows.map((r) => ({
        property_id: r.property_id,
        check_in: r.check_in,
        check_out: r.check_out,
        confirmation_code: r.confirmation_code,
        guest_name: r.guest_name,
        status: r.status,
      }));
    }

    // Which probed runs are now covered? Recompute against what we inserted so
    // an un-fetchable run goes on the cooldown list and a healed one comes off.
    const nextMemo: Record<string, string> = {};
    const nowIso = new Date().toISOString();
    const stillOpen = (run: BookedRun) =>
      !rows.some(
        (r) =>
          r.property_id === run.property_id &&
          !NON_OCCUPYING_STATUSES.has((r.status ?? '').toLowerCase()) &&
          r.check_in &&
          r.check_out &&
          staysOverlap(r.check_in, r.check_out, run.check_in, run.check_out),
      );
    for (const run of allRuns) {
      if (!stillOpen(run)) continue;
      result.unresolved.push(run);
      // Only a run this pass actually probed earns a fresh cooldown stamp. One
      // that was merely over the per-pass cap keeps whatever it had (usually
      // nothing), so the tail of a long backlog is never starved.
      const carried = probing.includes(run) ? nowIso : memo[runKey(run)];
      if (carried) nextMemo[runKey(run)] = carried;
    }

    // 5. Carry the recovered stays through to `bookings`, which is what the
    //    turnover rail, revenue and messaging actually read.
    if (rows.length > 0) {
      try {
        const b = await backfillGuestyToBookings({});
        result.bookings_backfill = { inserted: b.inserted, updated: b.updated, deduped: b.deduped };
      } catch (err) {
        errors.push(`bookings backfill: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await writeMemo(nextMemo, result, errors);
    return result;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    result.errors = errors;
    await recordSyncFailure('guesty-reservation-gaps', errors[0]);
    return result;
  }
}

async function readProbeMemo(sb: typeof supabaseAdmin): Promise<Record<string, string>> {
  const { data } = await sb
    .from('sync_status')
    .select('last_result')
    .eq('source', 'guesty-reservation-gaps')
    .maybeSingle();
  const raw = (data?.last_result as { probe_attempts?: unknown } | null)?.probe_attempts;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Persist the result plus the probe memo. Entries for runs that no longer
 * exist are dropped by construction: `nextMemo` is rebuilt from this pass's
 * unresolved list, never merged into the old one.
 */
async function writeMemo(
  nextMemo: Record<string, string>,
  result: ReservationGapResult,
  errors: string[],
): Promise<void> {
  if (errors.length > 0) result.errors = errors.slice(0, MAX_REPORTED);
  const memoKeys = Object.keys(nextMemo).slice(0, MAX_REPORTED * 4);
  await recordSyncResult('guesty-reservation-gaps', {
    processed: result.runs_probed,
    failed: errors.length,
    firstError: errors[0],
    result: {
      ...result,
      recovered: result.recovered.slice(0, MAX_REPORTED),
      unresolved: result.unresolved.slice(0, MAX_REPORTED),
      probe_attempts: Object.fromEntries(memoKeys.map((k) => [k, nextMemo[k]])),
    } as unknown as Record<string, unknown>,
  });
}
