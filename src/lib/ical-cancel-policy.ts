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
 *   3. Observations, not minutes. The first successful run that finds an
 *      upcoming row absent stamps it (`stampMissing`, which the sync writes
 *      to bookings.missing_since) and defers it. The row cancels only on a
 *      later successful run that still finds it absent, once missing_since is
 *      older than CANCEL_AFTER_MISSING_MS. The upsert clears missing_since
 *      every time the event is seen, so a cancel always takes at least two
 *      runs that each saw the row gone, however many runs failed or were
 *      skipped in between. (The old rule measured from last_seen_at, which a
 *      failed run never stamps, so one failed beat followed by one short feed
 *      cancelled on the first miss ever observed.) With the 30-minute cron,
 *      the third consecutive missing run is the one that cancels.
 *   4. Mass-cancel guard, over STAYS only. If the upcoming stays that would
 *      cancel this run exceed max(MASS_CANCEL_MIN, MASS_CANCEL_SHARE of the
 *      upcoming live stays), none of them cancel and the guard is reported;
 *      the sync surfaces it as a soft error for review. Rules 1 and 2 still
 *      apply, and so do vanished holds: an upcoming `block` row (an OTA's
 *      "Not available", VRBO's "Blocked") gets rule 3's grace period and then
 *      cancels, but never enters the guard's count, missing or live. Airbnb
 *      re-keys a hold whenever its span changes and drops it when the
 *      operator opens the dates, so a routine bulk unblock removes many holds
 *      at once; counted, that alone tripped the guard, forever.
 *      The same stays recount above the threshold on every later run, so the
 *      guard is released only by a human: the operator's "these
 *      cancellations are real" (channel_listings.mass_cancel_acknowledged_at)
 *      reaches this function as `allowMassCancel`, which skips the guard for
 *      that one run.
 *
 * The existing empty-feed guard (zero parsed events while live upcoming rows
 * exist: skip the whole cancel pass) stays in the sync, ahead of this.
 *
 * Import-free so `npm test` covers it with no bundler and no database.
 */

/** How long a row must have been observed missing (bookings.missing_since)
 *  before it is cancelled. 55 minutes: strictly more than one 30-minute cron
 *  beat, so the run that stamps it and the very next run can never cancel
 *  between them; a third look is always required. */
export const CANCEL_AFTER_MISSING_MS = 55 * 60_000;
/** The guard never trips below this many upcoming stay disappearances. */
export const MASS_CANCEL_MIN = 5;
/** ... nor below this share of the listing's upcoming live stays. */
export const MASS_CANCEL_SHARE = 0.4;

export type CancelCandidate = {
  id: string;
  status: string;
  /** YYYY-MM-DD */
  check_in: string;
  /** YYYY-MM-DD, exclusive */
  check_out: string;
  /** ISO timestamp of the first successful run that found this row absent
   *  from its feed, or null when the last run saw it (the upsert clears it). */
  missing_since: string | null;
  raw_summary: string | null;
};

export type CancelPassInput = {
  /** Every ical_import row of the listing, cancelled ones included. */
  existing: CancelCandidate[];
  /** The ical_uid of every event this run parsed and kept. */
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
  /** The operator said the disappearances on this feed are real
   *  (channel_listings.mass_cancel_acknowledged_at): skip rule 4 for this
   *  one run. The sync clears the stamp once the pass has run. */
  allowMassCancel?: boolean;
};

export type CancelGuard = null | 'mass_cancel';

export type CancelGuardDetail = {
  /** Non-cancelled upcoming STAYS (check_out >= today, not a hold), before
   *  this run's cancels. */
  upcoming_live: number;
  /** Upcoming stays that have been missing long enough to cancel. */
  upcoming_missing: number;
  /** max(MASS_CANCEL_MIN, ceil(MASS_CANCEL_SHARE * upcoming_live)). */
  threshold: number;
};

export type CancelPassPlan = {
  /** Rows to mark cancelled now: rolled-off past rows, upcoming holds past
   *  the grace period, and upcoming stays past it (when the guard did not
   *  trip or was released). */
  cancelNow: string[];
  /** Upcoming rows missing this run but not yet observed missing long
   *  enough, plus every upcoming stay the guard held back. */
  deferred: string[];
  /** The subset of `deferred` seen missing for the first time: the caller
   *  stamps bookings.missing_since on these (and only where it is null). */
  stampMissing: string[];
  /** Rows stored confirmed whose summary was a hold: cancelled now, reported
   *  apart from stay cancels, never counted against the guard. */
  reclassified: string[];
  guard: CancelGuard;
  /** True when the guard would have tripped and `allowMassCancel` let the
   *  stays cancel instead. */
  released: boolean;
  guardDetail: CancelGuardDetail;
};

/** Rule 3: has this row been observed missing for longer than the grace
 *  period? 'first' when no earlier run has observed it missing. */
function missingState(row: CancelCandidate, now: Date): 'first' | 'waiting' | 'ready' {
  if (!row.missing_since) return 'first';
  const since = Date.parse(row.missing_since);
  if (!Number.isFinite(since)) return 'first';
  return now.getTime() - since > CANCEL_AFTER_MISSING_MS ? 'ready' : 'waiting';
}

/**
 * Does this stored row keep the empty-feed guard up? Only an upcoming live
 * STAY does. A feed that parses to nothing while such a stay is on file is
 * most likely broken, so the cancel pass is skipped. A hold does not count:
 * when a feed's only event was an owner block and the owner lifts it, the
 * feed legitimately parses to nothing, and counting the hold kept the guard
 * tripped every run, so the lifted block never cancelled and stayed
 * exported to the other channels. It goes through rule 3's two-look grace
 * period instead.
 */
export function keepsEmptyFeedGuardUp(
  row: { status: string; check_out: string; raw_summary: string | null },
  todayIso: string,
  isBlockSummary: (raw: string | null) => boolean,
): boolean {
  if (row.status === 'cancelled' || row.status === 'block') return false;
  if (String(row.check_out) < todayIso) return false;
  if (row.status === 'confirmed' && isBlockSummary(row.raw_summary)) return false;
  return true;
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
  const stampMissing: string[] = [];
  const reclassified: string[] = [];
  const upcomingReady: string[] = [];

  let upcomingLive = 0;
  for (const row of existing) {
    if (row.status === 'cancelled') continue;
    const upcoming = String(row.check_out) >= todayIso;
    const isHold = row.status === 'block';
    const isMisfiledHold = row.status === 'confirmed' && isBlockSummary(row.raw_summary);
    // Only a stay is "live" for the guard: a hold, or a hold the old sync
    // stored as confirmed, is never a guest.
    if (upcoming && !isHold && !isMisfiledHold) upcomingLive += 1;

    const uid = uidOf(row);
    if (uid !== null && incomingUids.has(uid)) continue; // seen this run: the upsert owns it

    // Rule 1: a hold the old sync mistook for a stay. Never a stay cancel.
    if (isMisfiledHold) {
      reclassified.push(row.id);
      continue;
    }
    // Rule 2: a past row rolling off the feed is history, not a cancel.
    if (!upcoming) {
      cancelNow.push(row.id);
      continue;
    }
    // Rule 3: an upcoming row needs two separate observations of its absence.
    const state = missingState(row, now);
    if (state !== 'ready') {
      deferred.push(row.id);
      if (state === 'first') stampMissing.push(row.id);
      continue;
    }
    // A vanished hold has had its grace period; it never feeds the guard.
    if (isHold) {
      cancelNow.push(row.id);
      continue;
    }
    upcomingReady.push(row.id);
  }

  // Rule 4: too many upcoming stays vanishing at once is a broken feed until
  // a human says otherwise, and allowMassCancel is that human.
  const threshold = massCancelThreshold(upcomingLive);
  const guardDetail: CancelGuardDetail = {
    upcoming_live: upcomingLive,
    upcoming_missing: upcomingReady.length,
    threshold,
  };
  const wouldTrip = upcomingReady.length > threshold;
  let guard: CancelGuard = null;
  let released = false;
  if (wouldTrip && !input.allowMassCancel) {
    guard = 'mass_cancel';
    deferred.push(...upcomingReady);
  } else {
    released = wouldTrip;
    cancelNow.push(...upcomingReady);
  }

  return { cancelNow, deferred, stampMissing, reclassified, guard, released, guardDetail };
}
