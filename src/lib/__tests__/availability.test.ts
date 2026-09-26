/**
 * Night-level availability for a Helm-run home, in staycapeann.com's
 * AvailabilityDay shape.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildAvailability, checkRange, type AvailabilityBooking } from '../availability.ts';
import { rateDayMap, type RateDayRow, type RatePlanRow } from '../rate-plan.ts';
import type { RentalPeriod } from '../rental-periods.ts';

const plan: RatePlanRow = {
  property_id: '65_calderwood',
  currency: 'USD',
  base_nightly_cents: 35000,
  weekend_nightly_cents: 35000,
  weekend_days: [5, 6],
  guests_included: 4,
  extra_guest_cents_per_night: 3500,
  cleaning_fee_cents: 30000,
  pet_fee_cents: null,
  security_deposit_cents: 20000,
  weekly_discount_pct: 0,
  monthly_discount_pct: 0,
  direct_markup_pct: 0,
  min_nights_default: 3,
  max_nights: 91,
  advance_notice_hours: 24,
  booking_window_days: 365,
  turnover_buffer_days: 0,
  checkin_time: '16:00',
  checkout_time: '11:00',
  max_occupancy: 6,
  pets_allowed: false,
  quiet_hours: null,
  cancellation_policy_key: 'sca_50_30',
  cancellation_terms: null,
  house_rules: null,
};

const day = (date: string, patch: Partial<RateDayRow> = {}): RateDayRow => ({
  property_id: '65_calderwood',
  date,
  nightly_cents: null,
  min_nights: null,
  cta: false,
  ctd: false,
  closed: false,
  note: null,
  source: 'seed',
  ...patch,
});

/** Weeks before the window, so notice and past-date rules stay out of the way. */
const NOW = new Date('2026-09-26T16:00:00Z');

const bookings: AvailabilityBooking[] = [
  { status: 'confirmed', check_in: '2026-10-15', check_out: '2026-10-18' },
  // Back to back: check-in on the first stay's checkout morning.
  { status: 'completed', check_in: '2026-10-18', check_out: '2026-10-20' },
  { status: 'block', check_in: '2026-10-20', check_out: '2026-10-22' },
  // Ignored: a duplicate row and a cancelled one never hold a night.
  { status: 'confirmed', check_in: '2026-10-14', check_out: '2026-10-15', duplicate_of: 'some-canonical-id' },
  { status: 'cancelled', check_in: '2026-10-22', check_out: '2026-10-25' },
  { status: 'inquiry', check_in: '2026-10-22', check_out: '2026-10-25' },
];

const byDate = (days: ReturnType<typeof buildAvailability>) => new Map(days.map((d) => [d.date, d]));

describe('buildAvailability', () => {
  const days = buildAvailability({
    bookings,
    plan,
    rateDays: rateDayMap([day('2026-10-23', { closed: true }), day('2026-10-16', { nightly_cents: 52000, min_nights: 2 })]),
    rentalPeriods: [],
    start: '2026-10-14',
    end: '2026-10-25',
    now: NOW,
  });
  const m = byDate(days);

  test('one row per day, inclusive at both ends, in the SCA shape', () => {
    assert.equal(days.length, 12);
    assert.equal(days[0].date, '2026-10-14');
    assert.equal(days[11].date, '2026-10-25');
    for (const d of days) {
      assert.deepEqual(Object.keys(d).sort(), ['available', 'date', 'minNights', 'price', 'reserved']);
    }
  });

  test('a booked night is reserved and unavailable', () => {
    for (const iso of ['2026-10-15', '2026-10-16', '2026-10-17']) {
      assert.equal(m.get(iso)!.available, false, iso);
      assert.equal(m.get(iso)!.reserved, true, iso);
    }
  });

  test('the checkout day of one stay is the check-in day of the next', () => {
    const turnover = m.get('2026-10-18')!;
    assert.equal(turnover.reserved, true, 'held by the second stay, not freed by the first leaving');
    assert.equal(turnover.available, false);
    const afterSecond = m.get('2026-10-20')!;
    assert.equal(afterSecond.reserved, false, 'the second stay leaves on the 20th');
  });

  test('a block is unavailable but not reserved', () => {
    for (const iso of ['2026-10-20', '2026-10-21']) {
      assert.equal(m.get(iso)!.available, false, iso);
      assert.equal(m.get(iso)!.reserved, false, iso);
    }
    assert.equal(m.get('2026-10-22')!.available, true, 'the block ends on the 22nd');
  });

  test('a closed rate day reads unavailable', () => {
    assert.equal(m.get('2026-10-23')!.available, false);
    assert.equal(m.get('2026-10-23')!.reserved, false);
    assert.equal(m.get('2026-10-24')!.available, true);
  });

  test('duplicate, cancelled and inquiry rows hold nothing', () => {
    assert.equal(m.get('2026-10-14')!.available, true);
    assert.equal(m.get('2026-10-14')!.reserved, false);
    assert.equal(m.get('2026-10-22')!.available, true);
  });

  test('price and minNights come from the plan and its day overrides', () => {
    assert.equal(m.get('2026-10-14')!.price, 350);
    assert.equal(m.get('2026-10-14')!.minNights, 3);
    assert.equal(m.get('2026-10-16')!.price, 520, 'a booked night still shows its rate, as Guesty does');
    assert.equal(m.get('2026-10-16')!.minNights, 2);
  });
});

test('a rental period shuts the off-season', () => {
  const summer: RentalPeriod[] = [{ startMonth: 5, startDay: 1, endMonth: 10, endDay: 31 }];
  const days = byDate(
    buildAvailability({ bookings: [], plan, rateDays: new Map(), rentalPeriods: summer, start: '2026-10-30', end: '2026-11-02', now: NOW }),
  );
  assert.equal(days.get('2026-10-31')!.available, true, 'the last day of the season is inclusive');
  assert.equal(days.get('2026-11-01')!.available, false);
  assert.equal(days.get('2026-11-01')!.reserved, false, 'shut is not reserved');
  assert.equal(days.get('2026-11-02')!.available, false);
});

test('advance notice: tonight is gone at 8 PM and so is tomorrow under a 24h rule', () => {
  // 8 PM Eastern on Oct 15 = 00:00Z Oct 16 (EDT).
  const tonight = new Date('2026-10-16T00:00:00Z');
  const days = byDate(
    buildAvailability({ bookings: [], plan, rateDays: new Map(), rentalPeriods: [], start: '2026-10-14', end: '2026-10-18', now: tonight }),
  );
  assert.equal(days.get('2026-10-14')!.available, false, 'yesterday');
  assert.equal(days.get('2026-10-15')!.available, false, 'tonight, check-in hour already past');
  assert.equal(days.get('2026-10-16')!.available, false, '4 PM tomorrow is 20 hours away');
  assert.equal(days.get('2026-10-17')!.available, true);
  assert.equal(days.get('2026-10-15')!.reserved, false, 'a notice rule is not a guest');
});

test('the booking window closes 365 days out', () => {
  const days = byDate(
    buildAvailability({ bookings: [], plan, rateDays: new Map(), rentalPeriods: [], start: '2027-09-25', end: '2027-09-28', now: NOW }),
  );
  assert.equal(days.get('2027-09-26')!.available, true, 'exactly 365 days out');
  assert.equal(days.get('2027-09-27')!.available, false);
});

test('without a rate plan the holds still read, with no price and no rules', () => {
  const days = buildAvailability({ bookings, plan: null, rateDays: new Map(), rentalPeriods: [], start: '2026-10-15', end: '2026-10-16', now: NOW });
  assert.equal(days[0].available, false);
  assert.equal(days[0].reserved, true);
  assert.equal(days[0].price, undefined);
  assert.equal(days[0].minNights, undefined);
});

describe('checkRange', () => {
  const days = buildAvailability({
    bookings,
    plan,
    rateDays: rateDayMap([day('2026-10-23', { closed: true })]),
    rentalPeriods: [],
    start: '2026-10-14',
    end: '2026-10-25',
    now: NOW,
  });

  test('a clear range is available and the checkout day is not a night', () => {
    // Checks out the morning the block begins.
    assert.deepEqual(checkRange(days, '2026-10-22', '2026-10-23'), { available: true, unavailableDates: [], reservedDates: [] });
    // Checks in the morning the block ends... but the 23rd is closed.
    assert.deepEqual(checkRange(days, '2026-10-22', '2026-10-24'), { available: false, unavailableDates: ['2026-10-23'], reservedDates: [] });
    // Two clear nights at the end of the window; the checkout morning (the
    // 26th) is outside the day list and that is fine, it is not a night.
    assert.deepEqual(checkRange(days, '2026-10-24', '2026-10-26'), { available: true, unavailableDates: [], reservedDates: [] });
  });

  test('reserved nights are named separately from merely unavailable ones', () => {
    const r = checkRange(days, '2026-10-17', '2026-10-21');
    assert.equal(r.available, false);
    assert.deepEqual(r.unavailableDates, ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
    assert.deepEqual(r.reservedDates, ['2026-10-17', '2026-10-18', '2026-10-19']);
  });

  test('a night the day list never evaluated is unavailable, never sold', () => {
    const r = checkRange(days, '2026-10-24', '2026-10-27');
    assert.equal(r.available, false);
    assert.deepEqual(r.unavailableDates, ['2026-10-26']);
  });

  test('an empty or reversed range is not available', () => {
    assert.equal(checkRange(days, '2026-10-22', '2026-10-22').available, false);
    assert.equal(checkRange(days, '2026-10-23', '2026-10-22').available, false);
  });
});
