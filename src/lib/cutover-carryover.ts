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
import { isRealHoldType } from './calendar-holds.ts';
import { ECHO_LAG_GRACE_MS, echoExplained, heldBeforeCancel, type HeldAge } from './echo-cause.ts';

export { ECHO_LAG_GRACE_MS };

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
  /** bookings.ical_uid; Guesty's carries the block type (guestyBlockTag). */
  ical_uid?: string | null;
  /** bookings.live_since: when this row's current dates began. */
  live_since?: string | null;
  /** bookings.held_ages: nights it already held before its last move, and
   *  since when (lib/echo-cause nightHeldSinceMs). */
  held_ages?: readonly HeldAge[] | null;
  /** Set only on the synthetic rows for Guesty calendar holds (MirrorHold.kind). */
  raw_kind?: string;
  /** bookings.notes (read for CARRIED_SEASON_NOTE). */
  notes?: string | null;
  /** Set on a listed Guesty hold whose end is Guesty's rolling horizon. */
  rolling?: boolean;
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
  export_subscribed_at?: string | null;
};

/**
 * A hold Guesty's own calendar shows (property_calendar_days while Guesty
 * runs the home, block types isRealHoldType: manual, owner, ...), grouped
 * into runs of nights. The source of Guesty holds on a home with no Guesty
 * aggregate feed (65 Calderwood by design, and 8 of 18 production homes),
 * where no bookings row ever carries them. The mirror keeps its last rows
 * when the Guesty listing is deleted (calendar-days writes nothing on a
 * listing that 404s), so it still says what Guesty held after runbook step 7.
 */
export type MirrorHold = {
  check_in: string;
  check_out: string;
  block_type: string | null;
  note?: string | null;
  /** hold: an owner's or the team's; closed_from_date: Guesty's 'bd' rule;
   *  unknown: a closed night the mirror has no type for (read as a hold). */
  kind?: 'hold' | 'closed_from_date' | 'unknown';
  /** The run reaches the mirror's last night: its end is Guesty's rolling
   *  horizon, which moves every day. */
  rolling?: boolean;
  /** An unknown run's Guesty rule type (block_rule_type of its first night). */
  rule?: string | null;
};

/** A property_calendar_days row as the handover reads it. */
export type MirrorDay = {
  date: string;
  status: string | null;
  block_type: string | null;
  block_rule_type?: string | null;
  block_ref_id: string | null;
  block_note: string | null;
  /** The covering hold ref's last night (Guesty's endDate, inclusive). */
  block_end?: string | null;
  synced_at?: string | null;
};

/**
 * Group a home's calendar-mirror nights (ordered by date, from today) into
 * the runs the handover must carry, plus the first night of Guesty's
 * rolling booking window and the mirror's last night. See
 * loadGuestyMirrorHolds in lib/cutover.ts:
 *   - a real hold (block_type m, o, ...) is a hold, one run per Guesty
 *     block ref;
 *   - a night Guesty's "closed from a fixed date" rule closes ('bd') is a
 *     closed_from_date run;
 *   - a closed night with no recorded type (mirror rows written before
 *     block_rule_type existed), or with a rule type nobody has classified,
 *     is an unknown run, carried like a hold, except a lone night today or
 *     tomorrow, which is advance notice (ruleTypeOf promises an unknown
 *     rule reads as a rule, never as an open night);
 *   - 'bw' marks the rolling window (its first night is returned apart);
 *     advance notice ('an') and reservation padding ('b', 'a') are skipped.
 * The mirror stops about a year out (the Guesty sync's window). A hold run
 * that reaches its last night ends where its Guesty ref says (block_end);
 * any other run that reaches it has a rolling end, which the handover
 * carries to its own horizon.
 */
export function mirrorRunsFromDays(
  rows: readonly MirrorDay[],
  todayIso: string,
): { holds: MirrorHold[]; bw: { check_in: string; seen_at: string } | null; lastDate: string | null } {
  const next = (d: string) => shiftDay(d, 1);
  const lastDate = rows.length > 0 ? String(rows[rows.length - 1].date).slice(0, 10) : null;
  const tomorrow = next(todayIso);
  type Kind = NonNullable<MirrorHold['kind']>;
  const kindOf = (r: MirrorDay): Kind | 'bw' | 'skip' => {
    if (String(r.status ?? '') !== 'unavailable') return 'skip';
    if (isRealHoldType(r.block_type)) return 'hold';
    const rule = r.block_rule_type ?? null;
    if (rule === 'bd') return 'closed_from_date';
    if (rule === 'bw') return 'bw';
    if (rule === 'an' || rule === 'b' || rule === 'a') return 'skip';
    return 'unknown';
  };
  const out: MirrorHold[] = [];
  let bw: { check_in: string; seen_at: string } | null = null;
  let run: (MirrorHold & { key: string; last: string; blockEnd: string | null }) | null = null;
  const flush = () => {
    if (!run) return;
    const oneNightNotice = run.kind === 'unknown' && run.check_out === next(run.check_in) && run.check_in <= tomorrow;
    if (!oneNightNotice) {
      const atEdge = !!lastDate && run.last === lastDate;
      // A hold past the mirror's edge ends where its Guesty ref says.
      const refEnd = run.kind === 'hold' && run.blockEnd ? next(run.blockEnd) : null;
      const check_out = atEdge && refEnd && refEnd > run.check_out ? refEnd : run.check_out;
      out.push({ check_in: run.check_in, check_out, block_type: run.block_type, note: run.note, kind: run.kind, rolling: atEdge && !refEnd, rule: run.rule ?? null });
    }
    run = null;
  };
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    const kind = kindOf(r);
    if (kind === 'bw') {
      if (!bw) bw = { check_in: date, seen_at: r.synced_at ?? '' };
      flush();
      continue;
    }
    if (kind === 'skip') {
      flush();
      continue;
    }
    const key = `${kind}|${kind === 'hold' ? r.block_ref_id ?? '' : ''}`;
    const blockEnd = r.block_end ? String(r.block_end).slice(0, 10) : null;
    if (run && run.key === key && next(run.last) === date) {
      run.last = date;
      run.check_out = next(date);
      if (blockEnd) run.blockEnd = blockEnd;
      continue;
    }
    flush();
    const note = r.block_note ?? (kind === 'unknown' && r.block_rule_type ? `Guesty rule ${r.block_rule_type}` : null);
    run = { check_in: date, check_out: next(date), block_type: r.block_type, note, kind, rolling: false, key, last: date, blockEnd, rule: r.block_rule_type ?? null };
  }
  flush();
  // A closure that runs on UNDER the mirror's last nights (a hold or a stay
  // sits on them) still rolls. Only the closure that ends exactly where
  // that unbroken tail of held or stayed-in nights begins can, and only
  // when the tail's own rule type says the closure is still beneath it
  // (calendar-days records it under holds and stays too): 'bd' for a
  // fixed-date closure, the run's own type for an unknown one (both null:
  // rows written before the column, which fails closed). Judged per run, a
  // hold on the last nights made a season look bounded and the rest of it
  // was never asked for; judged loosely, a hold on the last night made any
  // earlier, finished closure roll.
  const tail = rows[rows.length - 1];
  if (tail && String(tail.status ?? '') !== 'available') {
    const tailKind = kindOf(tail);
    if (tailKind === 'hold' || tailKind === 'skip') {
      let i = rows.length - 1;
      while (i > 0) {
        const prev = rows[i - 1];
        const pk = kindOf(prev);
        const contiguous = next(String(prev.date).slice(0, 10)) === String(rows[i].date).slice(0, 10);
        if (!contiguous || String(prev.status ?? '') === 'available' || !(pk === 'hold' || pk === 'skip')) break;
        i -= 1;
      }
      const tailStart = String(rows[i].date).slice(0, 10);
      const tailRule = tail.block_rule_type ?? null;
      const beneath = out.find((h) => h.check_out === tailStart && (h.kind === 'closed_from_date' || h.kind === 'unknown'));
      if (beneath && (beneath.kind === 'closed_from_date' ? tailRule === 'bd' : tailRule === (beneath.rule ?? null))) {
        beneath.rolling = true;
      }
    }
  }
  return { holds: out, bw, lastDate };
}

/** Guesty's rolling booking window versus the rate plan's, when they disagree. */
export type BookingWindowGap = {
  /** First night Guesty's rule closed. */
  closedFrom: string;
  /** The widest plan window that keeps that night closed (Helm's semantics). */
  maxPlanWindow: number;
  /** The plan's booking_window_days; null or 0 = unlimited. */
  planWindow: number | null;
};

export type Carryover = {
  untwinnedGuestyStays: CarryRow[];
  bookingComNotShown: CarryRow[];
  bookingComUnwatched: CarryRow[];
  bookingComUnexplained: CarryRow[];
  bookingComOrphaned: CarryRow[];
  /** Every block still ahead on the Guesty aggregate feed: the flip cancels them. */
  guestyBlocks: CarryRow[];
  /** The ones that are not Guesty's rolling rules and have no Helm row over
   *  them yet, plus, on a home with no aggregate feed, Guesty calendar holds
   *  with none (ids 'mirror:<from>'). */
  guestyHoldsUncarried: CarryRow[];
  /** Guesty's rolling window reached less far than the rate plan would. */
  bookingWindowGap: BookingWindowGap | null;
  /** On a home Guesty runs with no aggregate feed, the first night past
   *  Guesty's calendar mirror, when Helm could sell further than it reaches:
   *  a hold that starts after it cannot be seen. Null otherwise. */
  mirrorBlindFrom: string | null;
  /** The live Helm blocks that carry a closure with a rolling end over its
   *  last demanded night: the flip notes them (CARRIED_SEASON_NOTE), so a
   *  block typed by hand before the tick is followed up like one entered
   *  from the hub's link. */
  carriedSeasonBlockIds: string[];
  /** Helm blocks carried from a Guesty closed season (CARRIED_SEASON_NOTE)
   *  whose end the booking window reaches within 60 days: extend them, or
   *  the season's nights go on sale. After the flip nothing else says so. */
  carriedSeasonsEnding: CarryRow[];
  /** Upcoming stays from a direct feed Helm no longer reads (retired,
   *  switched off or deleted): nothing will cancel them if the guest does.
   *  For a person to check; not a flip blocker (an 'other' platform's feed
   *  is retired before the flip by design, and its stays are real). */
  unreadFeedStays: CarryRow[];
};

/** How far ahead a closure whose END is Guesty's rolling horizon (a
 *  "closed from date" block, one day longer every night) must be carried.
 *  Every other hold is carried to its own end, however far out: a fixed
 *  owner week beyond the rate plan's window is sold the day the window
 *  reaches it. */
export const DEFAULT_CARRY_HORIZON_DAYS = 540;

/** How far past the horizon a closure with a rolling end is LISTED (and the
 *  hub's re-enter link pre-filled). Coverage is demanded only to the
 *  horizon, which moves a day every day: a block pre-filled to exactly it
 *  failed the preflight the next morning, and left no time to extend it
 *  before the booking window reached its end. */
export const CARRY_SLACK_DAYS = 365;

/** The note the hub's re-enter link pre-fills on a closed season carried as
 *  a Helm block; Carryover.carriedSeasonsEnding finds those blocks by it. */
export const CARRIED_SEASON_NOTE = 'Closed season carried from Guesty';

/** YYYY-MM-DD of an instant in America/New_York (Guesty keys its rules on
 *  the listing's local date). */
function easternDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A hand-entered Booking.com booking gets this long before its absence from
 *  Booking.com's feed means anything: the feed is read every 30 minutes. */
export const NOT_SHOWN_GRACE_MS = 2 * 3_600_000;

/**
 * The block type Guesty writes into each iCal UID
 * (`<listing>_<type>_<from>_<to>@guesty.com_...`, the same tags
 * lib/calendar-holds.ts reads), or null for an untagged UID.
 */
export function guestyBlockTag(uid: string | null | undefined): string | null {
  if (!uid) return null;
  const m = /^[0-9a-f]+_([a-z]+)_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}@guesty\.com/i.exec(uid);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Guesty's own ROLLING availability rules, read off the UID's type tag:
 * advance notice ('an'), the rolling booking window ('bw', which starts a
 * fixed number of days ahead and moves every day), and reservation padding
 * ('b' / 'a'). Each is replaced by a setting (the rate plan's advance notice
 * and booking window, each OTA's own), not by a block.
 *
 * Deliberately NOT a rule here: 'bd', Guesty's "closed from a fixed date"
 * setting. It runs to the calendar horizon like the rolling window, but its
 * start does not move (20 Hammond: closed from 2027-01-01; 30 Woodward: from
 * 2026-12-01), and no rolling setting can express it; classed by its end
 * date, the flip cancelled it and reopened a closed season on every
 * channel. And an untagged block is an owner's hold or a reservation Guesty
 * blocked out. Both have to be carried into Helm.
 */
export function isGuestyRule(r: { ical_uid?: string | null }): boolean {
  const tag = guestyBlockTag(r.ical_uid);
  return tag === 'an' || tag === 'bw' || tag === 'b' || tag === 'a';
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
  /** properties.calendar_authority; absent reads as 'guesty'. */
  calendarAuthority?: string | null;
  /** Guesty calendar holds (MirrorHold); used on a home with no aggregate feed. */
  mirrorHolds?: readonly MirrorHold[];
  /** Guesty's rolling window from its calendar mirror: the first closed night
   *  and when the mirror saw it (a home with no aggregate 'bw' row). */
  mirrorBookingWindow?: { check_in: string; seen_at: string } | null;
  /** The calendar mirror's last night (mirrorRunsFromDays lastDate); null
   *  when it has none. Absent: not known (older callers), nothing reported. */
  mirrorLastDate?: string | null;
  /** property_rate_plans.booking_window_days; null or 0 = unlimited. */
  planWindowDays?: number | null;
}): Carryover {
  const { rows, listings, todayIso, now } = input;
  const planWindow = input.planWindowDays ?? null;
  const horizonEnd = shiftDay(todayIso, Math.max(DEFAULT_CARRY_HORIZON_DAYS, planWindow && planWindow > 0 ? planWindow + 1 : 0));
  /** The nights of a Guesty hold a carrier must cover: every night still
   *  ahead, and for a closure whose end is Guesty's rolling horizon only as
   *  far as horizonEnd (its end moves a day every night). */
  const nightsToCarry = (r: { check_in: string; check_out: string }, rollingEnd: boolean): string[] =>
    nights(r.check_in > todayIso ? r.check_in : todayIso, rollingEnd && r.check_out > horizonEnd ? horizonEnd : r.check_out);
  const aggregateIds = new Set(listings.filter((l) => l.channel === 'guesty').map((l) => l.id));
  const readingIds = new Set(listings.filter(reads).map((l) => l.id));
  const readingBcom = listings.filter((l) => l.channel === 'booking_com' && reads(l));
  // While Guesty runs a home and no OTA imports Helm's export yet, ical-sync
  // drops every direct-feed closure (lib/listing-scope guestyEchoPropertyIds),
  // so Booking.com's closures are not on file and saying "Booking.com no
  // longer shows it" would be about nothing.
  const ticks = listings
    .filter((l) => l.channel !== 'guesty' && l.is_active && !!l.export_subscribed)
    .map((l) => Date.parse(l.export_subscribed_at ?? ''))
    .filter(Number.isFinite);
  const closuresImported =
    input.calendarAuthority === 'helm' || listings.some((l) => l.channel !== 'guesty' && l.is_active && !!l.export_subscribed);
  // Booking.com's closures start arriving only at the first Booking.com sync
  // after the first tick; before that, every reservation on file would read
  // as "no longer shown".
  const firstTick = ticks.length > 0 ? Math.min(...ticks) : null;
  const bcomReadSinceTick =
    firstTick === null ||
    input.calendarAuthority === 'helm' ||
    listings.filter((l) => l.channel === 'booking_com' && reads(l)).every((l) => Date.parse(l.last_imported_at ?? '') > firstTick);
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
  if (closuresImported && bcomReadSinceTick && readingBcom.length > 0 && readingBcom.every((l) => l.last_import_status === 'success')) {
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
  const bcomReservationNights = new Set<string>();
  for (const r of bcomReservations) for (const n of nights(r.check_in, r.check_out)) bcomReservationNights.add(n);
  // What Booking.com was sent: every row Helm's export gives it now, and
  // every row it gave it until its cancel (what it was before: a hold if it
  // has a kind, else a stay; exportableBooking then says whether Booking.com
  // was sent it, and an OTA's own closure never was). lib/echo-cause judges
  // whether they held the closure's nights from before it appeared until now.
  const sentToBcom = rows.filter((r) => exportableBooking(r, { channel: 'booking_com', listingId: null }));
  const withdrawnFromBcom = rows.filter(
    (r) =>
      r.status === 'cancelled' &&
      !!r.cancelled_at &&
      heldBeforeCancel(r) &&
      exportableBooking({ ...r, status: r.hold_kind ? 'block' : 'confirmed' }, { channel: 'booking_com', listingId: null }),
  );
  const bcomCovers = [...sentToBcom, ...withdrawnFromBcom];
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
    // A Booking.com reservation on file is the closure's cause outright;
    // every other night must be Booking.com echoing what Helm sent it.
    const echoNights = nightsAhead(h, todayIso).filter((n) => !bcomReservationNights.has(n));
    // Its own feed's other closures of these nights: a run re-issued under a
    // new UID is the same closure (lib/echo-cause closureNightSinceMs).
    const siblings = rows.filter(
      (r) => r.source === 'ical_import' && r.hold_kind === 'ota' && r.channel_listing_id === h.channel_listing_id,
    );
    const echo = echoExplained({
      closure: h,
      nights: echoNights,
      covers: bcomCovers,
      now: now.getTime(),
      allowRecentWithdrawal: true,
      closureSiblings: siblings,
    });
    if (!echo.explained) bookingComUnexplained.push(h);
  }

  // 4. Upcoming holds on the Guesty aggregate feed: all cancelled by the
  // flip; the ones that may be an owner's hold must be in Helm first.
  const guestyBlocks = rows.filter((r) => fromAggregate(r) && r.status === 'block' && upcoming(r));
  // What still closes the nights after the flip: any live canonical row
  // that is neither one of these Guesty blocks nor an OTA's own closure. A
  // Helm block, and also a Guesty-era reservation Guesty had blocked out
  // (20 Enon's owner stays are both), which survives the flip on its own.
  const carriers = rows.filter(
    (r) => r.duplicate_of == null && LIVE.has(r.status) && !isOtaHold(r) && !(fromAggregate(r) && r.status === 'block'),
  );
  // Guesty's horizon on the aggregate feed: the furthest end among its
  // window rules. A block reaching it has a rolling end.
  const horizonMark = guestyBlocks
    .filter((r) => {
      const t = guestyBlockTag(r.ical_uid);
      return t === 'bw' || t === 'bd';
    })
    .reduce<string | null>((m, r) => (!m || r.check_out > m ? r.check_out : m), null);
  const rollingEnd = (r: CarryRow): boolean => guestyBlockTag(r.ical_uid) === 'bd' || (!!horizonMark && r.check_out >= horizonMark);
  const listEnd = shiftDay(horizonEnd, CARRY_SLACK_DAYS);
  // The Helm blocks over the last night Helm could sell of each closure
  // with a rolling end: they are what keeps that season shut after the flip.
  const lastDemanded = shiftDay(horizonEnd, -1);
  const carriedSeasonBlockIds = new Set<string>();
  const noteCarriers = (from: string) => {
    if (from > lastDemanded) return;
    for (const c of carriers) {
      if (c.status === 'block' && c.source !== 'ical_import' && c.check_in <= lastDemanded && lastDemanded < c.check_out) {
        carriedSeasonBlockIds.add(c.id);
      }
    }
  };
  for (const r of guestyBlocks) if (!isGuestyRule(r) && rollingEnd(r)) noteCarriers(r.check_in);
  const guestyHoldsUncarried = guestyBlocks
    .filter((r) => !isGuestyRule(r) && !coveredBy(nightsToCarry(r, rollingEnd(r)), carriers))
    .map((r) => (rollingEnd(r) ? { ...r, rolling: true, check_out: r.check_out > listEnd ? r.check_out : listEnd } : r));
  // A home with no Guesty aggregate feed: the only record of Guesty's holds
  // is its calendar mirror (MirrorHold). The mirror stops about a year out,
  // so a run with a rolling end is carried to horizonEnd, not to the
  // mirror's edge: stopped there, the flip sold the rest of a closed season
  // and the hub's own "re-enter" link pre-filled the short range.
  const mirrorOnly = aggregateIds.size === 0 && input.calendarAuthority !== 'helm';
  let mirrorBlindFrom: string | null = null;
  if (mirrorOnly) {
    for (const m of input.mirrorHolds ?? []) if (m.rolling && m.check_out > todayIso) noteCarriers(m.check_in);
    for (const m of input.mirrorHolds ?? []) {
      if (m.check_out <= todayIso) continue;
      const end = m.rolling ? horizonEnd : m.check_out;
      if (coveredBy(nights(m.check_in > todayIso ? m.check_in : todayIso, end), carriers)) continue;
      // Listed with slack past the horizon (CARRY_SLACK_DAYS); covered only to it.
      guestyHoldsUncarried.push({
        id: `mirror:${m.check_in}`,
        // Shown to the operator: say what it was on Guesty's calendar.
        raw_kind: m.kind ?? 'hold',
        property_id: rows[0]?.property_id ?? '',
        source: 'guesty_calendar',
        channel: 'block',
        status: 'block',
        check_in: m.check_in,
        check_out: m.rolling ? listEnd : end,
        rolling: !!m.rolling,
        duplicate_of: null,
        hold_kind: null,
        channel_listing_id: null,
        created_at: '',
        guest_name: m.note ?? null,
      });
    }
    // Past the mirror's last night nobody has read Guesty's calendar: a
    // fixed hold that starts out there is not listed. Say from where, so
    // a person checks Guesty before it goes (the disconnect acknowledgement
    // carries it).
    if (input.mirrorLastDate !== undefined) {
      const from = input.mirrorLastDate ? shiftDay(input.mirrorLastDate, 1) : todayIso;
      if (from < horizonEnd) mirrorBlindFrom = from;
    }
  }

  // Guesty's rolling booking window: the newest 'bw' row, measured from the
  // Eastern day Guesty published it (not from now: at 20:00 EDT the UTC date
  // is already tomorrow, and a row frozen by the listing's deletion keeps
  // its own day). Guesty closes check_in onward, so the widest plan window
  // that keeps that night closed is (check_in - published) - 1, because
  // Helm sells a night when it is at most booking_window_days away.
  let bookingWindowGap: BookingWindowGap | null = null;
  const aggregateBw = guestyBlocks
    .filter((r) => guestyBlockTag(r.ical_uid) === 'bw')
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))[0];
  // On a home with no aggregate feed, the mirror's own first 'bw' night.
  const mirrorBw = aggregateIds.size === 0 && input.calendarAuthority !== 'helm' ? input.mirrorBookingWindow ?? null : null;
  const bw = aggregateBw
    ? { check_in: aggregateBw.check_in, seen: aggregateBw.created_at }
    : mirrorBw
    ? { check_in: mirrorBw.check_in, seen: mirrorBw.seen_at }
    : null;
  if (bw) {
    const published = easternDate(bw.seen) ?? todayIso;
    const maxPlanWindow = daysBetween(published, bw.check_in) - 1;
    if (planWindow == null || planWindow <= 0 || planWindow > maxPlanWindow) {
      bookingWindowGap = { closedFrom: bw.check_in, maxPlanWindow, planWindow: planWindow && planWindow > 0 ? planWindow : null };
    }
  }

  // 5. Stays whose only cancellation signal was a direct feed Helm no
  // longer reads: judged per cluster, so a stay typed by hand whose feed
  // twin sits on a retired feed is listed too. A Guesty-era stay with no
  // live twin is untwinnedGuestyStays' already.
  const untwinnedIds = new Set(untwinnedGuestyStays.map((r) => r.id));
  const unreadFeedStays: CarryRow[] = [];
  for (const [key, members] of clusters) {
    const canonical = byId.get(key);
    if (!canonical || canonical.duplicate_of != null || !STAY.has(canonical.status) || !upcoming(canonical) || isOtaHold(canonical)) continue;
    if (untwinnedIds.has(canonical.id)) continue;
    const feedMembers = members.filter(
      (m) => m.source === 'ical_import' && !isOtaHold(m) && !(m.channel_listing_id && aggregateIds.has(m.channel_listing_id)),
    );
    if (feedMembers.length === 0) continue;
    if (feedMembers.some((m) => !!m.channel_listing_id && readingIds.has(m.channel_listing_id))) continue;
    unreadFeedStays.push(canonical);
  }

  // 6. Carried closed seasons whose end the booking window is about to reach.
  const soon = shiftDay(todayIso, (planWindow && planWindow > 0 ? planWindow : DEFAULT_CARRY_HORIZON_DAYS) + 60);
  // A block whose end another live row already carries on from (a guest's
  // stay, the season's next block) is not running out.
  const liveCanonical = rows.filter((r) => r.duplicate_of == null && LIVE.has(r.status));
  const carriedSeasonsEnding = rows.filter(
    (r) =>
      r.status === 'block' &&
      r.duplicate_of == null &&
      r.source !== 'ical_import' &&
      String(r.notes ?? '').startsWith(CARRIED_SEASON_NOTE) &&
      r.check_out > todayIso &&
      r.check_out <= soon &&
      !liveCanonical.some((o) => o.id !== r.id && o.check_in <= r.check_out && r.check_out < o.check_out),
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
    bookingWindowGap,
    mirrorBlindFrom,
    carriedSeasonBlockIds: [...carriedSeasonBlockIds].sort(),
    carriedSeasonsEnding: carriedSeasonsEnding.sort(byDate),
    unreadFeedStays: unreadFeedStays.sort(byDate),
  };
}

/** True when nothing blocks the flip. guestyBlocks themselves are the
 *  flip's to cancel; only the uncarried ones need someone. unreadFeedStays
 *  are listed on the hub but never block (see Carryover). */
export function carryoverClear(c: Carryover): boolean {
  return (
    c.untwinnedGuestyStays.length === 0 &&
    c.bookingComNotShown.length === 0 &&
    c.bookingComUnwatched.length === 0 &&
    c.bookingComUnexplained.length === 0 &&
    c.bookingComOrphaned.length === 0 &&
    c.guestyHoldsUncarried.length === 0 &&
    c.bookingWindowGap === null
  );
}
