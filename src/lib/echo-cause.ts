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
 * A row's hold starts when its current nights began (bookings.live_since,
 * stamped by ical-sync when a feed row's dates move or it comes back after
 * a real absence), not when its UID was first seen: a stay that moved onto
 * the nights of a guest nobody entered did not cause that guest's closure.
 * The one allowance is a move within the echo lag of a row that predates
 * the closure: an extension the OTA has not pulled yet still shows the old
 * closure for the same stay.
 *
 * What time cannot tell apart is left to a person: a hold typed in the
 * minutes between an OTA guest's booking and Helm's next import of that OTA
 * reads as the closure's cause.
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
 * A feed row back within this long of its cancel keeps its age (ical-sync
 * freshSince): a feed that dropped the event for a beat or two, not a new
 * booking. Two looks cancel a missing row after about an hour, so this
 * covers an outage of a few beats; a real reopen and re-close takes an OTA
 * pull on each side and restarts the age.
 */
export const REVIVAL_GAP_MS = 2 * 3_600_000;

/** What the live_since rule reads off a feed row already on file. */
export type PriorRow = {
  status: string;
  check_in: string;
  check_out: string;
  cancelled_at: string | null;
};

/**
 * Whether a feed row's nights (re)appeared at this upsert, so ical-sync
 * restarts its live_since (heldSinceMs):
 *   - a row not on file anywhere, or dates that moved: yes;
 *   - a row back after a cancel: yes, unless the absence was shorter than
 *     REVIVAL_GAP_MS. A feed that drops an event for a beat or two and
 *     publishes it again is the same booking, held all along; restarted, a
 *     Booking.com guest's closure that blinked out for an hour came back
 *     looking caused by the Airbnb stay sold in that hour;
 *   - anything else (live before, same dates): no.
 */
export function freshSince(prior: PriorRow | null, row: { check_in: string; check_out: string }, at: Date): boolean {
  if (!prior) return true;
  if (prior.check_in !== row.check_in || prior.check_out !== row.check_out) return true;
  if (prior.status !== 'cancelled') return false;
  const gone = Date.parse(prior.cancelled_at ?? '');
  return !Number.isFinite(gone) || at.getTime() - gone > REVIVAL_GAP_MS;
}

/** The columns the judgement reads off a cover row. */
export type CoverRow = {
  id: string;
  status: string;
  check_in: string;
  check_out: string;
  created_at: string;
  live_since?: string | null;
  cancelled_at?: string | null;
};

/** The columns the judgement reads off the closure. */
export type ClosureRow = {
  check_in: string;
  check_out: string;
  created_at: string;
  live_since?: string | null;
};

/** When a row's current nights began to be held: live_since, else created_at. */
export function heldSinceMs(r: { created_at: string; live_since?: string | null }): number {
  return Date.parse(r.live_since ?? r.created_at);
}

type Interval = { row: CoverRow; start: number; end: number };

function coverInterval(r: CoverRow, now: number, graceMs: number): Interval | null {
  const since = heldSinceMs(r);
  // An unknown age reads as held all along, as the checks this replaced did.
  let start = Number.isFinite(since) ? since : -Infinity;
  if (r.status === 'cancelled') {
    const end = Date.parse(r.cancelled_at ?? '');
    if (!Number.isFinite(end)) return null;
    return { row: r, start, end };
  }
  const created = Date.parse(r.created_at);
  if (r.live_since && !r.cancelled_at && Number.isFinite(created) && created < start && now - start <= graceMs) {
    start = created;
  }
  return { row: r, start, end: Infinity };
}

/**
 * Night by night, whether `covers` account for `nights` of `closure` as an
 * echo (see the module docblock), and the live rows at the end of the
 * chains. `covers` are the rows the OTA was sent: live ones, and cancelled
 * ones with cancelled_at (withdrawn then). A night no chain reaches leaves
 * the closure unexplained.
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
  const age = heldSinceMs(input.closure);
  const since = Number.isFinite(age) ? age : Infinity;
  const intervals = input.covers
    .map((r) => coverInterval(r, input.now, grace))
    .filter((iv): iv is Interval => iv !== null)
    .sort((a, b) => a.start - b.start);
  const causes = new Map<string, CoverRow>();
  for (const night of input.nights) {
    let started = false;
    let frontier = -Infinity;
    const live: CoverRow[] = [];
    for (const iv of intervals) {
      if (!(iv.row.check_in <= night && night < iv.row.check_out)) continue;
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
