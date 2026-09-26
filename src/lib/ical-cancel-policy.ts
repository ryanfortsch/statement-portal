/**
 * Which imported bookings the iCal cancel pass may cancel this run.
 *
 * The pure half of the cancel pass in ical-sync.ts. An event that was in a
 * feed last run and is not in it this run has "disappeared", and the sync
 * used to cancel it on the spot. That is the right call for a feed with a
 * second witness (a Guesty-managed home has the aggregate feed, and the
 * dedupe refuses an aggregate-only cancel), and the wrong call for a
 * Guesty-free home, where a transient short feed from the OTA would empty
 * the calendar for half an hour and put every stay back on the next run,
 * with a cancelled_at stamped on each. Four rules, in order:
 *
 *   1. Reclassification. A row a direct feed stored as `confirmed` whose
 *      raw_summary is a hold ("Blocked", "Airbnb (Not available)", "CLOSED -
 *      Not available") was never a stay; the classifier had not been written
 *      when it landed. It cancels immediately, is reported separately, and
 *      never counts against the guard: nothing is lost by cancelling it.
 *   2. Roll-off. A row whose check_out is before today left the feed because
 *      OTAs drop past events as routine. It cancels immediately, as it always
 *      has (the dedupe already reads a post-stay cancel as history, not as a
 *      cancellation of the stay), and never counts against the guard: the
 *      guard must never trip permanently on a listing whose forward calendar
 *      has legitimately emptied.
 *   3. Two consecutive runs. An upcoming row is cancelled only once it has
 *      been missing for longer than CANCEL_AFTER_MISSING_MS, measured from
 *      its own last_seen_at (which the upsert stamps on every run that sees
 *      it). The cron runs every 30 minutes, so the first missing run defers
 *      and the second cancels; a one-off short feed costs nothing.
 *   4. Mass-cancel guard. If the UPCOMING rows that would cancel this run
 *      exceed max(MASS_CANCEL_MIN, MASS_CANCEL_SHARE of the upcoming live
 *      rows), none of them cancel and the guard is reported; the sync
 *      surfaces it as a soft error for review. Rules 1 and 2 still apply.
 *
 * The existing empty-feed guard (zero parsed events while live upcoming rows
 * exist: skip the whole cancel pass) stays in the sync, ahead of this.
 *
 * Import-free so `npm test` covers it with no bundler and no database.
 */

/** How long a row must be missing before an upcoming stay is cancelled.
 *  55 minutes: strictly more than one 30-minute cron beat, less than two. */
export const CANCEL_AFTER_MISSING_MS = 55 * 60_000;
/** The guard never trips below this many upcoming disappearances. */
export const MASS_CANCEL_MIN = 5;
/** ... nor below this share of the listing's upcoming live rows. */
export const MASS_CANCEL_SHARE = 0.4;

export type CancelCandidate = {
  id: string;
  status: string;
  /** YYYY-MM-DD */
  check_in: string;
  /** YYYY-MM-DD, exclusive */
  check_out: string;
  /** ISO timestamp of the last run that saw this event, or null. */
  last_seen_at: string | null;
  raw_summary: string | null;
};

export type CancelPassInput = {
  /** Every ical_import row of the listing, cancelled ones included. */
  existing: CancelCandidate[];
  /** The ical_uid of every event this run parsed and kept. Keyed by the
   *  row id the caller resolved for it: see `seenIds` below. */
  incomingUids: Set<string>;
  /** Resolves a candidate to its feed uid. Defaults to reading `ical_uid`
   *  off the row when present, so a caller may pass rows carrying it. */
  uidOf?: (row: CancelCandidate) => string | null;
  now: Date;
  /** Today's date, YYYY-MM-DD, in the caller's frame. */
  todayIso: string;
  /** lib/ical's hold-keyword test over a stored raw_summary, injected so
   *  this module stays import-free. */
  isBlockSummary: (raw: string | null) => boolean;
};

export type CancelGuard = null | 'mass_cancel';

export type CancelGuardDetail = {
  /** Non-cancelled rows with check_out >= today, before this run's cancels. */
  upcoming_live: number;
  /** Upcoming rows that have been missing long enough to cancel. */
  upcoming_missing: number;
  /** max(MASS_CANCEL_MIN, ceil(MASS_CANCEL_SHARE * upcoming_live)). */
  threshold: number;
};

export type CancelPassPlan = {
  /** Rows to mark cancelled now: rolled-off past rows plus upcoming rows
   *  missing past the grace period (when the guard did not trip). */
  cancelNow: string[];
  /** Upcoming rows missing this run but not yet long enough, plus every
   *  upcoming row the guard held back. Nothing is written for these. */
  deferred: string[];
  /** Rows stored confirmed whose summary was a hold: cancelled now, reported
   *  apart from stay cancels, never counted against the guard. */
  reclassified: string[];
  guard: CancelGuard;
  guardDetail: CancelGuardDetail;
};

/** True when the row has been out of the feed for longer than the grace period. */
function missingLongEnough(row: CancelCandidate, now: Date): boolean {
  if (!row.last_seen_at) return true; // never stamped: nothing vouches for it
  const seen = Date.parse(row.last_seen_at);
  if (!Number.isFinite(seen)) return true;
  return now.getTime() - seen > CANCEL_AFTER_MISSING_MS;
}

export function massCancelThreshold(upcomingLive: number): number {
  return Math.max(MASS_CANCEL_MIN, Math.ceil(MASS_CANCEL_SHARE * upcomingLive));
}

export function planCancelPass(input: CancelPassInput): CancelPassPlan {
  const { existing, incomingUids, now, todayIso, isBlockSummary } = input;
  const uidOf =
    input.uidOf ??
    ((row: CancelCandidate) => {
      const v = (row as CancelCandidate & { ical_uid?: string | null }).ical_uid;
      return typeof v === 'string' ? v : null;
    });

  const cancelNow: string[] = [];
  const deferred: string[] = [];
  const reclassified: string[] = [];
  const upcomingReady: string[] = [];

  let upcomingLive = 0;
  for (const row of existing) {
    if (row.status === 'cancelled') continue;
    const upcoming = String(row.check_out) >= todayIso;
    if (upcoming) upcomingLive += 1;

    const uid = uidOf(row);
    if (uid !== null && incomingUids.has(uid)) continue; // seen this run: the upsert owns it

    // Rule 1: a hold the old sync mistook for a stay. Never a stay cancel.
    if (row.status === 'confirmed' && isBlockSummary(row.raw_summary)) {
      reclassified.push(row.id);
      continue;
    }
    // Rule 2: a past stay rolling off the feed is history, not a cancel.
    if (!upcoming) {
      cancelNow.push(row.id);
      continue;
    }
    // Rule 3: an upcoming row needs two consecutive missing runs.
    if (missingLongEnough(row, now)) upcomingReady.push(row.id);
    else deferred.push(row.id);
  }

  // Rule 4: too many upcoming rows vanishing at once is a broken feed until
  // a human says otherwise.
  const threshold = massCancelThreshold(upcomingLive);
  const guardDetail: CancelGuardDetail = {
    upcoming_live: upcomingLive,
    upcoming_missing: upcomingReady.length,
    threshold,
  };
  let guard: CancelGuard = null;
  if (upcomingReady.length > threshold) {
    guard = 'mass_cancel';
    deferred.push(...upcomingReady);
  } else {
    cancelNow.push(...upcomingReady);
  }

  return { cancelNow, deferred, reclassified, guard, guardDetail };
}
