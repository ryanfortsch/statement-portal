/**
 * Night-level availability for a Helm-run home, in the exact AvailabilityDay
 * shape staycapeann.com already consumes from Guesty (stay-cape-ann
 * lib/types.ts: date, available, price, minNights, reserved).
 *
 * A night is available when nothing in Helm holds it and the rate plan lets
 * it be sold: no canonical confirmed / completed stay covers it, no block
 * covers it, its rate day is not closed, the property's rental periods say
 * it is open (isOpenOn; no periods = open year-round), it is not in the past,
 * it is outside the advance-notice window and inside the booking window.
 *
 * `reserved` is the SCA flag that says a REAL GUEST holds the night, distinct
 * from merely unavailable: the 2027 pre-release overlay must never offer a
 * reserved night, while an owner block or a closed season is just not on
 * sale. A stay sets it, and so does a Booking.com closure (Booking.com
 * publishes its bookings that way); any other block never does.
 *
 * A block imported from an OTA's own feed (hold_kind 'ota') holds its
 * nights here like any other block, even when the dedupe filed it as a
 * duplicate: it may be an echo of Helm's export, a Booking.com reservation
 * (published as "CLOSED - Not available") or an owner block set in the
 * Airbnb app, and a night nobody can tell is free is not sold. See
 * nightHolds.
 *
 * Pure: relative imports only, so node:test can load it
 * (src/lib/__tests__/availability.test.ts). The database edge is
 * property-rates.ts (loadPricingBundle) plus a canonical bookings read.
 */

import { isOpenOn, type RentalPeriod } from './rental-periods.ts';
import { nightsBetween, shiftIsoDay, todayInEastern } from './sca-quotes-types.ts';
import {
  resolveMinNights,
  resolveNightlyCents,
  stayNights,
  zonedTimeToMs,
  type RateDayRow,
  type RatePlanRow,
} from './rate-plan.ts';

/** Byte-compatible with staycapeann.com's AvailabilityDay. */
export type HelmAvailabilityDay = {
  date: string;
  available: boolean;
  price?: number;
  minNights?: number;
  reserved?: boolean;
};

/** The slice of a bookings row availability needs. Pass canonical rows plus
 *  any live OTA closure, duplicate or not (nightHolds skips other duplicates). */
export type AvailabilityBooking = {
  status: string;
  check_in: string;
  check_out: string;
  duplicate_of?: string | null;
  /** bookings.hold_kind; a block with 'ota' came from an OTA's feed. */
  hold_kind?: string | null;
  /** bookings.source; an OTA closure is 'ical_import' with hold_kind 'ota'. */
  source?: string | null;
  /** bookings.channel; a Booking.com closure may be a guest (see nightHolds). */
  channel?: string | null;
};

const STAY_STATUSES: ReadonlySet<string> = new Set(['confirmed', 'completed']);

export type BuildAvailabilityInput = {
  /** Canonical rows overlapping the window; anything else is ignored here too. */
  bookings: readonly AvailabilityBooking[];
  /** null when the home has no rate plan yet: no price, no rules, holds only. */
  plan: RatePlanRow | null;
  rateDays: Map<string, RateDayRow>;
  rentalPeriods: readonly RentalPeriod[];
  /** Inclusive ISO window. */
  start: string;
  end: string;
  now?: Date;
  timeZone?: string;
};

/**
 * Which rows hold a night: reserved (a canonical stay) or blocked (any
 * canonical hold). A block imported from an OTA's feed (hold_kind 'ota')
 * holds its nights too, deliberately, and whatever its duplicate mark: it
 * may be an echo of Helm's own export, but it may be a Booking.com
 * reservation (its iCal publishes every closed night, bookings included, as
 * "CLOSED - Not available") or an owner block set in the Airbnb app. The
 * dedupe's pass four files such a closure under the stay it overlaps, and
 * that mark can outlive the stay until the next dedupe run; skipped as a
 * duplicate, a Booking.com guest's nights read free in that window. Selling
 * a night nobody can tell is free is the failure that costs a double
 * booking; holding one that is free costs a few hours until the closure's
 * source drops it.
 */
export function nightHolds(bookings: readonly AvailabilityBooking[]): {
  reserved: Set<string>;
  blocked: Set<string>;
} {
  const reserved = new Set<string>();
  const blocked = new Set<string>();
  for (const b of bookings) {
    const status = String(b.status ?? '').toLowerCase();
    const otaClosure = status === 'block' && b.hold_kind === 'ota' && b.source === 'ical_import';
    if (b.duplicate_of && !otaClosure) continue;
    const target = STAY_STATUSES.has(status) ? reserved : status === 'block' ? blocked : null;
    if (!target) continue;
    // A Booking.com closure is how Booking.com publishes a booking, so its
    // nights are reserved as well as blocked: the SCA pre-release overlay
    // offers every unavailable night that is NOT reserved, and must never
    // offer a Booking.com guest's.
    const bcomGuest = otaClosure && b.channel === 'booking_com';
    for (const night of stayNights(b.check_in, b.check_out)) {
      target.add(night);
      if (bcomGuest) reserved.add(night);
    }
  }
  return { reserved, blocked };
}

/**
 * The nights a plan's turnover buffer keeps free around each stay: `days`
 * nights before its arrival and `days` nights from its checkout on (what
 * Guesty's preparation time did with its 'b' and 'a' padding, which the flip
 * drops). Stays only, canonical only: an owner hold needs no turnover.
 */
export function bufferNights(bookings: readonly AvailabilityBooking[], days: number): Set<string> {
  const out = new Set<string>();
  const n = Math.max(0, Math.floor(Number(days) || 0));
  if (n === 0) return out;
  for (const b of bookings) {
    if (b.duplicate_of || !STAY_STATUSES.has(String(b.status ?? '').toLowerCase())) continue;
    for (let i = 1; i <= n; i++) out.add(shiftIsoDay(b.check_in, -i));
    for (let i = 0; i < n; i++) out.add(shiftIsoDay(b.check_out, i));
  }
  // A night a stay itself holds is the stay's, not a buffer.
  for (const b of bookings) {
    if (b.duplicate_of || !STAY_STATUSES.has(String(b.status ?? '').toLowerCase())) continue;
    for (const night of stayNights(b.check_in, b.check_out)) out.delete(night);
  }
  return out;
}

/**
 * One AvailabilityDay per date in [start, end]. The window is inclusive at
 * both ends, like Guesty's calendar endpoint, so a caller asking for a month
 * gets the last day too.
 */
export function buildAvailability(input: BuildAvailabilityInput): HelmAvailabilityDay[] {
  const start = input.start.slice(0, 10);
  const end = input.end.slice(0, 10);
  if (start > end) return [];
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? 'America/New_York';
  const today = todayInEastern(now);
  const { plan } = input;
  const { reserved, blocked } = nightHolds(input.bookings);
  const buffer = bufferNights(input.bookings, plan?.turnover_buffer_days ?? 0);

  const noticeHours = plan ? Math.max(0, Number(plan.advance_notice_hours) || 0) : 0;
  const windowDays = plan ? Number(plan.booking_window_days) || 0 : 0;
  const checkinTime = plan?.checkin_time ?? '16:00';

  const out: HelmAvailabilityDay[] = [];
  for (let date = start; date <= end && out.length < 3660; date = shiftIsoDay(date, 1)) {
    const day = input.rateDays.get(date) ?? null;
    const isReserved = reserved.has(date);
    const isBlocked = blocked.has(date);
    const isClosed = !!day?.closed;
    const isOpen = isOpenOn(input.rentalPeriods, date);
    const isPast = date < today;
    // Advance notice: the check-in moment on this date must be at least
    // `noticeHours` ahead of now. Tonight is unbookable at 8 PM with a 24h
    // rule; so is tomorrow when its 4 PM arrival is under 24 hours away.
    const insideNotice =
      !!plan && zonedTimeToMs(date, checkinTime, timeZone) - now.getTime() < noticeHours * 3_600_000;
    const beyondWindow = !!plan && windowDays > 0 && nightsBetween(today, date) > windowDays;

    const row: HelmAvailabilityDay = {
      date,
      available: !isReserved && !isBlocked && !buffer.has(date) && !isClosed && isOpen && !isPast && !insideNotice && !beyondWindow,
      reserved: isReserved,
    };
    if (plan) {
      row.price = resolveNightlyCents(plan, day, date) / 100;
      row.minNights = resolveMinNights(plan, day);
    }
    out.push(row);
  }
  return out;
}

export type RangeCheck = {
  available: boolean;
  unavailableDates: string[];
  reservedDates: string[];
};

/**
 * Is [checkIn, checkOut) bookable? The checkout morning is not a night, so
 * the checkout day of one stay is the check-in day of the next (SCA's POST
 * /api/availability rule). A night the day list does not cover at all reads
 * as unavailable: a night that was never evaluated is never sold.
 */
export function checkRange(days: readonly HelmAvailabilityDay[], checkIn: string, checkOut: string): RangeCheck {
  const byDate = new Map<string, HelmAvailabilityDay>();
  for (const d of days) byDate.set(d.date, d);
  const unavailableDates: string[] = [];
  const reservedDates: string[] = [];
  for (const night of stayNights(checkIn, checkOut)) {
    const d = byDate.get(night);
    if (!d) {
      unavailableDates.push(night);
      continue;
    }
    if (!d.available) unavailableDates.push(night);
    if (d.reserved) reservedDates.push(night);
  }
  return { available: unavailableDates.length === 0 && stayNights(checkIn, checkOut).length > 0, unavailableDates, reservedDates };
}
