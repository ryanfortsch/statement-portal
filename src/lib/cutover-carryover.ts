/**
 * What a home carries across the cutover, and what Booking.com says about it.
 *
 * At the flip Guesty stops writing: the guesty_legacy backfill, the Guesty
 * aggregate feed and every reconciler skip a Helm-run home. Whatever those
 * sources put in `bookings` is frozen from that moment, so each Guesty-era
 * row has to be handed to something that can still move it, or it holds its
 * nights (and a turnover) for good:
 *
 *   - An Airbnb or VRBO stay moves with its direct-feed twin: the dedupe
 *     already clusters them, and the feed row's cancel cancels the cluster.
 *     A Guesty-era stay with no live direct-feed twin cannot learn it was
 *     cancelled; the preflight refuses the flip until it has one
 *     (`untwinnedGuestyStays`).
 *   - A Booking.com reservation cannot have a feed twin: Booking.com's iCal
 *     publishes it as a bare "CLOSED - Not available" hold, which the dedupe
 *     never date-joins. It is compared night by night with Booking.com's
 *     closures instead, before and after the flip (`bookingComNotShown`):
 *     a reservation on file whose nights Booking.com has reopened was most
 *     likely cancelled there. The same check covers a Booking.com booking
 *     entered by hand after the flip, which is how every one is recorded
 *     now (runbook step 0.2).
 *   - A block on the Guesty aggregate feed is cancelled by the flip
 *     (`guestyBlocks`). Guesty's iCal labels every block the same ("Blocked
 *     by Guesty"), its own rolling booking-window and advance-notice rules
 *     included, so none can be carried over blind: adopted, the rolling
 *     horizon froze into a fixed block that shrank each home's bookable
 *     window by a day every day. The preflight instead refuses the flip
 *     while any block that is not one of those rules has no Helm block
 *     over its nights (`guestyHoldsUncarried`): the operator re-enters each
 *     real hold in Helm, deliberately. The rules themselves are replaced by
 *     the rate plan's booking window and advance notice and each OTA's own
 *     availability settings.
 *   - A Booking.com reservation on file on a home whose Booking.com feed
 *     Helm does not read (`bookingComUnwatched`) can never be seen to
 *     cancel; the preflight refuses until the feed is wired or the stays
 *     are over.
 *
 * And the other direction: a Booking.com closure with no reservation on file
 * behind it and nothing Helm sends Booking.com covering it
 * (`bookingComUnexplained`) is either a Booking.com booking nobody has
 * entered (no turnover, no cleaner line) or a closure left behind in the
 * extranet, which Helm forwards to Airbnb and VRBO and so keeps those
 * nights closed everywhere. Either way a person has to look.
 * `bookingComOrphaned` is the same kind of closure from a feed Helm no
 * longer reads; nothing will ever cancel it, and only the operator can
 * release it.
 *
 * Pure: relative imports only, so node:test covers it
 * (src/lib/__tests__/cutover-carryover.test.ts).
 */

import { exportableBooking, isOtaHold } from './ical-export.ts';

export type CarryRow = {
  id: string;
  property_id: string;
  source: string;
  channel: string;
  status: string;
  check_in: string;
  check_out: string;
  duplicate_of: string | null;
  hold_kind: string | null;
  channel_listing_id: string | null;
  created_at: string;
  guest_name?: string | null;
  /** bookings.missing_since: set while a feed row is observed missing. */
  missing_since?: string | null;
  /** bookings.cancelled_at. */
  cancelled_at?: string | null;
};

export type CarryListing = {
  id: string;
  channel: string;
  is_active: boolean;
  ical_import_url: string | null;
  ical_import_enabled?: boolean;
  last_import_status: string | null;
  last_imported_at: string | null;
  /** channel_listings.export_subscribed: this OTA imports Helm's export. */
  export_subscribed?: boolean;
};

export type Carryover = {
  untwinnedGuestyStays: CarryRow[];
  bookingComNotShown: CarryRow[];
  bookingComUnwatched: CarryRow[];
  bookingComUnexplained: CarryRow[];
  bookingComOrphaned: CarryRow[];
  /** Every block still ahead on the Guesty aggregate feed: the flip cancels them. */
  guestyBlocks: CarryRow[];
  /** The ones that are not Guesty's rolling rules and have no Helm block over them yet. */
  guestyHoldsUncarried: CarryRow[];
};

/** A hand-entered Booking.com booking gets this long before its absence from
 *  Booking.com's feed means anything: the feed is read every 30 minutes. */
export const NOT_SHOWN_GRACE_MS = 2 * 3_600_000;

/**
 * How long after a row Helm sent Booking.com is cancelled that Booking.com's
 * closure of it is still expected: Booking.com has to pull, reopen, and Helm
 * has to see the closure gone twice. Until then the closure is the accepted
 * echo lag, not a Booking.com booking nobody entered.
 */
export const ECHO_LAG_GRACE_MS = 8 * 3_600_000;

/** A Guesty booking-window block ends at Guesty's calendar horizon, about
 *  two years out; anything ending this far ahead is that rule. */
export const GUESTY_HORIZON_DAYS = 600;

/**
 * Guesty's own rolling availability rules, as its iCal shows them: the
 * booking-window block (runs to the calendar horizon) and the advance-notice
 * block (one night, today or tomorrow). Every other Guesty block may be an
 * owner's hold and has to be re-entered in Helm before the flip.
 */
export function isGuestyRule(r: { check_in: string; check_out: string }, todayIso: string): boolean {
  if (r.check_out >= shiftDay(todayIso, GUESTY_HORIZON_DAYS)) return true;
  return nights(r.check_in, r.check_out).length === 1 && r.check_in <= shiftDay(todayIso, 1);
}

const LIVE = new Set(['confirmed', 'completed', 'block']);
const STAY = new Set(['confirmed', 'completed']);
const FEED_TWINNED_CHANNELS = new Set(['airbnb', 'vrbo']);

function shiftDay(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Every night in [from, to) as YYYY-MM-DD. */
function nights(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to && out.length < 1100; d = shiftDay(d, 1)) out.push(d);
  return out;
}

/** The nights of a row still ahead (a stay in the house counts from today). */
function nightsAhead(r: CarryRow, todayIso: string): string[] {
  return nights(r.check_in > todayIso ? r.check_in : todayIso, r.check_out);
}

function coveredBy(target: readonly string[], covers: readonly CarryRow[]): boolean {
  if (target.length === 0) return true;
  const held = new Set<string>();
  for (const c of covers) for (const n of nights(c.check_in, c.check_out)) held.add(n);
  return target.every((n) => held.has(n));
}

function reads(l: CarryListing): boolean {
  return l.is_active && l.ical_import_enabled !== false && !!l.ical_import_url;
}

export function evaluateCarryover(input: {
  rows: readonly CarryRow[];
  listings: readonly CarryListing[];
  todayIso: string;
  now: Date;
}): Carryover {
  const { rows, listings, todayIso, now } = input;
  const aggregateIds = new Set(listings.filter((l) => l.channel === 'guesty').map((l) => l.id));
  const readingIds = new Set(listings.filter(reads).map((l) => l.id));
  const readingBcom = listings.filter((l) => l.channel === 'booking_com' && reads(l));
  // While a home rides Guesty's aggregate feed and no OTA imports Helm's
  // export yet, ical-sync drops every direct-feed closure (lib/pms-guards
  // loadAggregateFeedPropertyIds), so Booking.com's closures are not on file
  // and saying "Booking.com no longer shows it" would be about nothing.
  const closuresImported =
    !listings.some((l) => l.channel === 'guesty' && l.is_active) ||
    listings.some((l) => l.channel !== 'guesty' && l.is_active && !!l.export_subscribed);
  const bcomIds = new Set(listings.filter((l) => l.channel === 'booking_com').map((l) => l.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const canonicalOf = (r: CarryRow): CarryRow => (r.duplicate_of ? byId.get(r.duplicate_of) ?? r : r);
  /** The stay or hold the row belongs to is live: its canonical's status. */
  const effectivelyLive = (r: CarryRow): boolean => LIVE.has(canonicalOf(r).status) && LIVE.has(r.status);
  const upcoming = (r: CarryRow): boolean => r.check_out > todayIso;
  const fromAggregate = (r: CarryRow): boolean => r.source === 'ical_import' && !!r.channel_listing_id && aggregateIds.has(r.channel_listing_id);
  const guestyEra = (r: CarryRow): boolean => r.source === 'guesty_legacy' || fromAggregate(r);
  /** A cluster that is a Booking.com reservation on file: a Guesty record, a
   *  hand-entered booking, or an aggregate-feed row, never Booking.com's
   *  own closure. */
  const isBcomReservation = (members: readonly CarryRow[]): boolean =>
    members.some((m) => m.channel === 'booking_com' && STAY.has(m.status) && !isOtaHold(m) && (m.source !== 'ical_import' || fromAggregate(m)));

  const clusters = new Map<string, CarryRow[]>();
  for (const r of rows) {
    const key = canonicalOf(r).id;
    const list = clusters.get(key);
    if (list) list.push(r);
    else clusters.set(key, [r]);
  }

  // 1. Guesty-era Airbnb / VRBO stays with no live direct-feed twin.
  const untwinnedGuestyStays: CarryRow[] = [];
  for (const [key, members] of clusters) {
    const canonical = byId.get(key);
    if (!canonical || !STAY.has(canonical.status) || !upcoming(canonical)) continue;
    const era = members.filter((m) => guestyEra(m) && FEED_TWINNED_CHANNELS.has(m.channel) && STAY.has(m.status));
    if (era.length === 0) continue;
    const channels = new Set(era.map((m) => m.channel));
    const twinned = [...channels].every((ch) =>
      members.some(
        (m) =>
          m.source === 'ical_import' &&
          m.channel === ch &&
          !!m.channel_listing_id &&
          !aggregateIds.has(m.channel_listing_id) &&
          readingIds.has(m.channel_listing_id) &&
          STAY.has(m.status),
      ),
    );
    if (!twinned) untwinnedGuestyStays.push(canonical);
  }

  // Booking.com's own closures, live, from a feed Helm still reads.
  const liveBcomHolds = rows.filter(
    (r) => isOtaHold(r) && r.channel === 'booking_com' && !!r.channel_listing_id && readingIds.has(r.channel_listing_id),
  );

  // 2. Booking.com reservations on file whose nights Booking.com reopened.
  const bookingComNotShown: CarryRow[] = [];
  if (closuresImported && readingBcom.length > 0 && readingBcom.every((l) => l.last_import_status === 'success')) {
    for (const [key, members] of clusters) {
      const canonical = byId.get(key);
      if (!canonical || !STAY.has(canonical.status) || !upcoming(canonical) || isOtaHold(canonical)) continue;
      if (!isBcomReservation(members)) continue;
      const created = Math.min(...members.map((m) => Date.parse(m.created_at)).filter(Number.isFinite));
      if (Number.isFinite(created) && now.getTime() - created < NOT_SHOWN_GRACE_MS) continue;
      if (!coveredBy(nightsAhead(canonical, todayIso), liveBcomHolds)) bookingComNotShown.push(canonical);
    }
  }

  // 2b. Booking.com reservations on file with no Booking.com feed read at
  // all: a cancellation of these can never reach Helm.
  const bookingComUnwatched: CarryRow[] = [];
  if (readingBcom.length === 0) {
    for (const [key, members] of clusters) {
      const canonical = byId.get(key);
      if (!canonical || !STAY.has(canonical.status) || !upcoming(canonical) || isOtaHold(canonical)) continue;
      if (!isBcomReservation(members)) continue;
      const created = Math.min(...members.map((m) => Date.parse(m.created_at)).filter(Number.isFinite));
      if (Number.isFinite(created) && now.getTime() - created < NOT_SHOWN_GRACE_MS) continue;
      bookingComUnwatched.push(canonical);
    }
  }

  // 3. Booking.com closures nothing on file explains.
  const bcomReservations = rows.filter(
    (r) => r.channel === 'booking_com' && STAY.has(r.status) && !isOtaHold(r) && effectivelyLive(r),
  );
  const sentToBcom = rows.filter((r) => exportableBooking(r, { channel: 'booking_com', listingId: null }));
  // Rows Helm was sending Booking.com until a moment ago: their closures are
  // the echo lag (ECHO_LAG_GRACE_MS), not a booking nobody entered.
  const recentlyWithdrawn = rows.filter((r) => {
    if (r.status !== 'cancelled' || !r.cancelled_at) return false;
    const at = Date.parse(r.cancelled_at);
    if (!Number.isFinite(at) || now.getTime() - at > ECHO_LAG_GRACE_MS) return false;
    // What it was before the cancel: a hold if it has a kind, else a stay.
    // An OTA's own closure was never sent to Booking.com (Booking.com's own
    // are left out of its feed, the others go to no feed at all).
    if (r.hold_kind === 'ota' && r.source === 'ical_import') return false;
    return exportableBooking({ ...r, status: r.hold_kind ? 'block' : 'confirmed' }, { channel: 'booking_com', listingId: null });
  });
  const bookingComUnexplained: CarryRow[] = [];
  const bookingComOrphaned: CarryRow[] = [];
  for (const h of closuresImported ? rows : []) {
    if (!isOtaHold(h) || h.channel !== 'booking_com' || !upcoming(h)) continue;
    const orphaned = !h.channel_listing_id || !readingIds.has(h.channel_listing_id) || !bcomIds.has(h.channel_listing_id);
    if (orphaned) {
      bookingComOrphaned.push(h);
      continue;
    }
    // Already observed missing from Booking.com's feed: it is on its way
    // out (or held by a cancel guard, which the feed card shows), and
    // "Booking.com shows these nights closed" would be false.
    if (h.missing_since) continue;
    if (!coveredBy(nightsAhead(h, todayIso), [...bcomReservations, ...sentToBcom, ...recentlyWithdrawn])) bookingComUnexplained.push(h);
  }

  // 4. Upcoming holds on the Guesty aggregate feed: all cancelled by the
  // flip; the ones that may be an owner's hold must be in Helm first.
  const guestyBlocks = rows.filter((r) => fromAggregate(r) && r.status === 'block' && upcoming(r));
  const helmHolds = rows.filter((r) => (r.source === 'manual' || r.source === 'direct_booking') && LIVE.has(r.status));
  const guestyHoldsUncarried = guestyBlocks.filter(
    (r) => !isGuestyRule(r, todayIso) && !coveredBy(nightsAhead(r, todayIso), helmHolds),
  );

  const byDate = (a: CarryRow, b: CarryRow) => a.check_in.localeCompare(b.check_in) || a.id.localeCompare(b.id);
  return {
    untwinnedGuestyStays: untwinnedGuestyStays.sort(byDate),
    bookingComNotShown: bookingComNotShown.sort(byDate),
    bookingComUnwatched: bookingComUnwatched.sort(byDate),
    bookingComUnexplained: bookingComUnexplained.sort(byDate),
    bookingComOrphaned: bookingComOrphaned.sort(byDate),
    guestyBlocks: guestyBlocks.sort(byDate),
    guestyHoldsUncarried: guestyHoldsUncarried.sort(byDate),
  };
}

/** True when nothing needs a person. guestyBlocks themselves are the
 *  flip's to cancel; only the uncarried ones need someone. */
export function carryoverClear(c: Carryover): boolean {
  return (
    c.untwinnedGuestyStays.length === 0 &&
    c.bookingComNotShown.length === 0 &&
    c.bookingComUnwatched.length === 0 &&
    c.bookingComUnexplained.length === 0 &&
    c.bookingComOrphaned.length === 0 &&
    c.guestyHoldsUncarried.length === 0
  );
}
