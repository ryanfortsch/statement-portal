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
 * sale. Only a stay sets it; a block never does.
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

/** The slice of a bookings row availability needs. Pass canonical rows only. */
export type AvailabilityBooking = {
  status: string;
  check_in: string;
  check_out: string;
  duplicate_of?: string | null;
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

/** Which canonical rows hold a night: reserved (a stay) or blocked (a hold). */
export function nightHolds(bookings: readonly AvailabilityBooking[]): {
  reserved: Set<string>;
  blocked: Set<string>;
} {
  const reserved = new Set<string>();
  const blocked = new Set<string>();
  for (const b of bookings) {
    if (b.duplicate_of) continue;
    const status = String(b.status ?? '').toLowerCase();
    const target = STAY_STATUSES.has(status) ? reserved : status === 'block' ? blocked : null;
    if (!target) continue;
    for (const night of stayNights(b.check_in, b.check_out)) target.add(night);
  }
  return { reserved, blocked };
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
      available: !isReserved && !isBlocked && !isClosed && isOpen && !isPast && !insideNotice && !beyondWindow,
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
