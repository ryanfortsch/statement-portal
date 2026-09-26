/**
 * Is a hold an OTA just published an echo of Helm's own export?
 *
 * Every OTA on a Helm-run home imports Helm's export, and every OTA's own
 * export then shows the nights Helm closed as "Airbnb (Not available)",
 * "Blocked" or "CLOSED - Not available". Helm imports those back as holds
 * (bookings.status 'block', hold_kind 'ota'). Most are echoes; some are
 * real: an owner block the operator set in the Airbnb app, or a Booking.com
 * reservation, which Booking.com's iCal publishes as "CLOSED - Not
 * available" like any other closed night.
 *
 * Content cannot tell them apart. What Helm was sending that OTA can: a
 * hold is an echo when every one of its nights was, at the moment it
 * appeared, held by a row Helm was exporting TO THAT SAME OTA. So a cover
 * counts only if the OTA's own feed would carry it (lib/ical-export.ts):
 *
 *   - never a row of the hold's own channel, and never its own listing's
 *     rows: Helm does not send an OTA its own bookings and holds back, so
 *     they cannot be what the OTA is echoing. This is also what keeps a
 *     real hold that the OTA re-keys or merges (Airbnb coalesces back-to-back
 *     closed nights into one event, and re-keys a span when it changes) from
 *     being judged an echo of itself;
 *   - never a stamped echo: it is exported to nobody, so nobody can echo it.
 *     Counting it once let a real hold be judged an echo of its own echoes
 *     on the other OTAs, and a Booking.com guest's nights reopened on Airbnb
 *     and VRBO for good;
 *   - never a cancelled row, an inquiry, a pending request or a duplicate.
 *
 * The decision is taken when ical-sync first inserts the hold, and taken
 * again whenever the row comes back to life (its UID reappears after it was
 * cancelled) or its dates move; never while it stays live on the same
 * dates. It is kept on bookings.echo_seen_at. A stamped echo is never
 * exported; an unstamped OTA hold is exported to every other channel.
 *
 * Why a kept stamp and not a live test: once the stay that caused an echo is
 * cancelled, the echo stands uncovered; published, it would keep the nights
 * closed on the other OTAs, which keep echoing it back, forever.
 *
 * Pure and import-free, so `npm test` covers it directly.
 */

/** Statuses under which a row holds its nights in Helm's export. */
export const ECHO_COVER_STATUSES: ReadonlySet<string> = new Set(['confirmed', 'completed', 'block']);

/** bookings.hold_kind of a block imported from an OTA's own feed. */
const OTA_HOLD = 'ota';

export type EchoHold = {
  check_in: string;
  check_out: string;
  /** The channel that published the hold (bookings.channel of the new row). */
  channel: string;
  channel_listing_id: string | null;
};

export type EchoCover = {
  status: string;
  check_in: string;
  check_out: string;
  duplicate_of: string | null;
  source: string;
  channel_listing_id: string | null;
  channel: string;
  hold_kind?: string | null;
  echo_seen_at?: string | null;
};

/** Every night [check_in, check_out) as YYYY-MM-DD. */
function nightsOf(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${checkIn.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${checkOut.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return out;
  for (let t = start; t < end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Was Helm exporting this row to the channel that published the hold? */
export function coverCounts(hold: EchoHold, c: EchoCover): boolean {
  if (c.duplicate_of) return false;
  if (!ECHO_COVER_STATUSES.has(c.status)) return false;
  if (c.status === 'block' && c.hold_kind === OTA_HOLD && c.echo_seen_at) return false;
  if (c.channel === hold.channel) return false;
  if (hold.channel_listing_id != null && c.channel_listing_id === hold.channel_listing_id) return false;
  return true;
}

/**
 * True when every night of the hold was held by a cover Helm was exporting
 * to the hold's own channel. Coverage is by the union of the covers, night
 * by night, so a coalesced echo of a stay and a Helm block back to back is
 * still an echo. An empty or reversed range is never an echo.
 */
export function isEchoAtFirstSight(hold: EchoHold, covers: readonly EchoCover[]): boolean {
  const nights = nightsOf(hold.check_in, hold.check_out);
  if (nights.length === 0) return false;
  const held = new Set<string>();
  for (const c of covers) {
    if (!coverCounts(hold, c)) continue;
    for (const n of nightsOf(c.check_in, c.check_out)) held.add(n);
  }
  return nights.every((n) => held.has(n));
}

/** The slice of an incoming feed row the decision planner reads. */
export type IncomingHoldRow = {
  ical_uid: string;
  status: string;
  hold_kind?: string | null;
  check_in: string;
  check_out: string;
};

/** The slice of a stored row the decision planner reads. */
export type PriorHoldRow = {
  id: string;
  status: string;
  check_in: string;
  check_out: string;
};

/**
 * Which incoming OTA holds need an echo decision this run:
 *   insert    first sight of the UID for this listing
 *   redecide  the UID is on file but the row was cancelled (it came back to
 *             life) or its dates moved, so the old verdict no longer
 *             describes these nights
 * A hold that stayed live on the same dates keeps its verdict.
 */
export function echoDecisionTargets(
  rows: readonly IncomingHoldRow[],
  priorByUid: ReadonlyMap<string, PriorHoldRow>,
): { insert: IncomingHoldRow[]; redecide: Array<IncomingHoldRow & { prior_id: string }> } {
  const insert: IncomingHoldRow[] = [];
  const redecide: Array<IncomingHoldRow & { prior_id: string }> = [];
  for (const r of rows) {
    if (r.status !== 'block' || r.hold_kind !== OTA_HOLD) continue;
    const prior = priorByUid.get(r.ical_uid);
    if (!prior) {
      insert.push(r);
      continue;
    }
    if (prior.status === 'cancelled' || prior.check_in !== r.check_in || prior.check_out !== r.check_out) {
      redecide.push({ ...r, prior_id: prior.id });
    }
  }
  return { insert, redecide };
}
