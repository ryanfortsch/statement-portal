/**
 * Is an OTA's closure the OTA echoing nights Helm sent it?
 *
 * An OTA's iCal publishes a night it closed because Helm's export told it to
 * exactly as it publishes a night one of its own guests booked ("CLOSED - Not
 * available"). The only evidence is time: Helm had to hold the night, the OTA
 * had to pull Helm's export, and only then could the closure appear. So a
 * closure is an echo when the nights were held by rows the OTA was sent from
 * before the closure appeared, and have stayed held ever since: had they been
 * let go, the OTA would have reopened them at its next pull and the closure
 * would be gone.
 *
 * Judged night by night, as a chain of cover over time:
 *   - the first link is a row that held the night before the closure
 *     appeared (and was not let go more than the echo lag before it);
 *   - each later link took over within the echo lag of the one before (a
 *     guest's cancel and a rebook of the same nights inside the OTA's pull
 *     lag never reopened them, so the closure stayed up for the rebook);
 *   - the chain reaches now: a live row, or, where the caller allows it, one
 *     let go within the echo lag (the OTA has not pulled since).
 *
 * How long a row has held a night (nightHeldSinceMs) is read off three
 * columns, written by ical-sync for feed rows and by helm_move_booking for
 * Helm's own (the same rule, nextAge): live_since, when the row's current
 * dates began, and a kept range (kept_check_in, kept_check_out, kept_since)
 * of nights it already held before its last move, with the age they had. So
 * an extension keeps the age of the nights the stay already held (the OTA's
 * unchanged closures of them are still its echo), while a stay moved onto
 * the nights of a guest nobody entered starts those nights at the move and
 * is not that guest's cause. A row back within the lag of its cancel keeps
 * its age; one back later starts again.
 *
 * What time cannot tell apart is left to a person: a hold typed in the
 * minutes between an OTA guest's booking and Helm's next import of that OTA
 * reads as the closure's cause; and until the OTA pulls, a stay moved away
 * leaves its old closure unexplained for a few hours.
 *
 * Pure: no imports, so node:test covers it (src/lib/__tests__/echo-cause.test.ts).
 * Used by the cutover handover (lib/cutover-carryover bookingComUnexplained)
 * and by the dedupe's echo suppression (lib/booking-dedupe pass four), so the
 * hub and the calendar agree on which closures are someone's echo.
 */

/**
 * How long after Helm lets a night go that an OTA's closure of it is still
 * expected: the OTA has to pull Helm's export (Booking.com every few hours)
 * and reopen, and Helm has to see the closure gone twice.
 */
export const ECHO_LAG_GRACE_MS = 8 * 3_600_000;

/**
 * An OTA's own closure back within this long of its cancel keeps its age
 * (nextAge): a feed that dropped the event for a beat or two, not a new
 * closure. Two looks cancel a missing row after about an hour, so this
 * covers an outage of a few beats; a real reopen and re-close takes an OTA
 * pull on each side and restarts the age. Shorter than the echo lag on
 * purpose: kept, a closure's age makes it harder to explain (fail closed),
 * while a stay or hold back within ECHO_LAG_GRACE_MS keeps its age because a
 * chain of cover would bridge that gap anyway.
 */
export const REVIVAL_GAP_MS = 2 * 3_600_000;

const HOLDING = new Set(['confirmed', 'completed', 'block']);

/** The age columns (bookings.live_since, kept_check_in / kept_check_out /
 *  kept_since) with the row's dates and creation. */
export type AgeRow = {
  check_in: string;
  check_out: string;
  created_at: string;
  live_since?: string | null;
  kept_check_in?: string | null;
  kept_check_out?: string | null;
  kept_since?: string | null;
};

/** What a writer stores in the age columns. */
export type AgeWrite = {
  live_since: string;
  kept_check_in: string | null;
  kept_check_out: string | null;
  kept_since: string | null;
};

/** A row already on file, as the age rule reads it. */
export type PriorRow = AgeRow & {
  status: string;
  cancelled_at: string | null;
};

/** When a row's current dates began: live_since, else created_at. */
export function heldSinceMs(r: { created_at: string; live_since?: string | null }): number {
  return Date.parse(r.live_since ?? r.created_at);
}

/** When a row began holding one of its nights: the kept range's age for a
 *  night it already held before its last move, else heldSinceMs. */
export function nightHeldSinceMs(r: AgeRow, night: string): number {
  if (r.kept_since && r.kept_check_in && r.kept_check_out && r.kept_check_in <= night && night < r.kept_check_out) {
    const kept = Date.parse(r.kept_since);
    if (Number.isFinite(kept)) return kept;
  }
  return heldSinceMs(r);
}

function fresh(at: Date): AgeWrite {
  return { live_since: at.toISOString(), kept_check_in: null, kept_check_out: null, kept_since: null };
}

/**
 * The ages after a row's dates move from `prior` to `next` at `at`:
 * live_since restarts, and the nights both ranges share keep the age they
 * had. One kept range holds one age, so the shared nights take the LATEST
 * age any of them had (never older than the truth: a kept night can only
 * read as younger, which lists a closure, never hides one).
 */
export function movedAge(prior: AgeRow, next: { check_in: string; check_out: string }, at: Date): AgeWrite {
  const from = prior.check_in > next.check_in ? prior.check_in : next.check_in;
  const to = prior.check_out < next.check_out ? prior.check_out : next.check_out;
  if (from >= to) return fresh(at);
  let since = heldSinceMs(prior);
  const keptSince = Date.parse(prior.kept_since ?? '');
  if (prior.kept_check_in && prior.kept_check_out && Number.isFinite(keptSince) && prior.kept_check_in <= from && to <= prior.kept_check_out) {
    since = keptSince;
  }
  if (!Number.isFinite(since)) return fresh(at);
  return { live_since: at.toISOString(), kept_check_in: from, kept_check_out: to, kept_since: new Date(since).toISOString() };
}

/**
 * The ages a writer stores when it writes `next` over `prior` at `at`, or
 * null to leave them as they are:
 *   - a row not on file, or one that held nothing (an inquiry confirmed):
 *     new;
 *   - a row back from a cancel: new when the absence was longer than the
 *     gap (REVIVAL_GAP_MS for an OTA's own closure, ECHO_LAG_GRACE_MS for
 *     anything else), else as if it had never gone;
 *   - dates that moved: movedAge;
 *   - anything else: unchanged.
 * ical-sync applies it to feed rows; helm_move_booking implements the same
 * rule in SQL for Helm's rows (keep the two in step).
 */
export function nextAge(
  prior: PriorRow | null,
  next: { check_in: string; check_out: string; hold_kind?: string | null },
  at: Date,
): AgeWrite | null {
  if (!prior) return fresh(at);
  if (prior.status === 'cancelled') {
    const gone = Date.parse(prior.cancelled_at ?? '');
    const gap = next.hold_kind === 'ota' ? REVIVAL_GAP_MS : ECHO_LAG_GRACE_MS;
    if (!Number.isFinite(gone) || at.getTime() - gone > gap) return fresh(at);
  } else if (!HOLDING.has(prior.status)) {
    return fresh(at);
  }
  if (prior.check_in !== next.check_in || prior.check_out !== next.check_out) return movedAge(prior, next, at);
  return null;
}

/**
 * Whether a cancelled row held nights before its cancel, so it can be a
 * link in a chain of cover. A feed row always did (feeds publish only what
 * is held); a row Helm wrote did only if it ever held (helm_create_booking
 * and helm_move_booking stamp live_since when it does), so a declined
 * inquiry is never taken for a stay Booking.com was sent.
 */
export function heldBeforeCancel(r: { source: string; live_since?: string | null }): boolean {
  if (r.source === 'manual' || r.source === 'direct_booking') return !!r.live_since;
  return true;
}

/** The columns the judgement reads off a cover row. */
export type CoverRow = AgeRow & {
  id: string;
  status: string;
  cancelled_at?: string | null;
};

/** The columns the judgement reads off the closure. */
export type ClosureRow = AgeRow;

/**
 * Night by night, whether `covers` account for `nights` of `closure` as an
 * echo (see the module docblock), and the live rows at the end of the
 * chains. `covers` are the rows the OTA was sent: live ones, and cancelled
 * ones with cancelled_at (withdrawn then) that held nights before. A night
 * no chain reaches leaves the closure unexplained.
 */
export function echoExplained(input: {
  closure: ClosureRow;
  nights: readonly string[];
  covers: readonly CoverRow[];
  now: number;
  graceMs?: number;
  /** A chain whose last row was let go within graceMs of now still counts:
   *  the OTA has not pulled since. */
  allowRecentWithdrawal: boolean;
}): { explained: boolean; causes: CoverRow[] } {
  const grace = input.graceMs ?? ECHO_LAG_GRACE_MS;
  const causes = new Map<string, CoverRow>();
  for (const night of input.nights) {
    const age = nightHeldSinceMs(input.closure, night);
    const since = Number.isFinite(age) ? age : Infinity;
    const intervals: Array<{ row: CoverRow; start: number; end: number }> = [];
    for (const r of input.covers) {
      if (!(r.check_in <= night && night < r.check_out)) continue;
      const held = nightHeldSinceMs(r, night);
      // An unknown age reads as held all along, as the checks this replaced did.
      const start = Number.isFinite(held) ? held : -Infinity;
      if (r.status === 'cancelled') {
        const end = Date.parse(r.cancelled_at ?? '');
        if (Number.isFinite(end)) intervals.push({ row: r, start, end });
      } else {
        intervals.push({ row: r, start, end: Infinity });
      }
    }
    intervals.sort((a, b) => a.start - b.start);
    let started = false;
    let frontier = -Infinity;
    const live: CoverRow[] = [];
    for (const iv of intervals) {
      if (iv.start <= since) {
        // A first link. One let go more than the lag before the closure
        // appeared can never reach now, so it needs no test of its own.
        started = true;
      } else if (iv.start > frontier + grace) {
        // A later link must take over within the lag of the one before.
        break;
      }
      if (iv.end > frontier) frontier = iv.end;
      if (iv.end === Infinity) live.push(iv.row);
    }
    const reachesNow = frontier === Infinity || (input.allowRecentWithdrawal && frontier >= input.now - grace);
    if (!started || !reachesNow) return { explained: false, causes: [] };
    for (const r of live) causes.set(r.id, r);
  }
  return { explained: true, causes: [...causes.values()] };
}
