/**
 * The Helm-written calendar mirror must produce rows in EXACTLY the shape
 * calendar-days.ts writes for a Guesty home, or the twelve readers of
 * property_calendar_days (operations holds, checkout-schedule, extension
 * holds, field packets, maintenance runs, launch context, revenue's
 * occupancy denominator) see a different table after the cutover.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHelmCalendarDays, mirrorWindow, type MirrorBooking } from '../helm-calendar-mirror.ts';
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

const bookings: MirrorBooking[] = [
  { id: 'stay-1', status: 'confirmed', check_in: '2026-10-15', check_out: '2026-10-18', first_seen_at: '2026-09-01T00:00:00Z' },
  {
    id: 'hold-owner',
    status: 'block',
    check_in: '2026-10-20',
    check_out: '2026-10-22',
    hold_kind: 'owner',
    notes: 'Ryan at the house',
    created_by: 'ryan@risingtidestr.com',
    booked_at: '2026-09-10T14:00:00Z',
    first_seen_at: '2026-09-10T14:00:00Z',
  },
  { id: 'hold-maint', status: 'block', check_in: '2026-10-24', check_out: '2026-10-25', hold_kind: 'maintenance', notes: 'Boiler service', created_by: 'allie@risingtidestr.com' },
  // Never a hold: a duplicate row and a cancelled one.
  { id: 'dupe', status: 'confirmed', check_in: '2026-10-13', check_out: '2026-10-15', duplicate_of: 'stay-0' },
  { id: 'gone', status: 'cancelled', check_in: '2026-10-22', check_out: '2026-10-24' },
];

const rateDays = rateDayMap([
  day('2026-10-16', { nightly_cents: 52000, min_nights: 2 }),
  day('2026-10-23', { closed: true, note: 'Deep clean', updated_by: 'allie@risingtidestr.com', updated_at: '2026-09-20T12:00:00Z' }),
  day('2026-10-14', { cta: true, ctd: true }),
]);

const rows = buildHelmCalendarDays({
  propertyId: '65_calderwood',
  start: '2026-10-13',
  end: '2026-10-25',
  bookings,
  plan,
  rateDays,
  rentalPeriods: [],
});
const m = new Map(rows.map((r) => [r.date, r]));

describe('shape', () => {
  test('one row per day, inclusive at both ends', () => {
    assert.equal(rows.length, 13);
    assert.equal(rows[0].date, '2026-10-13');
    assert.equal(rows[12].date, '2026-10-25');
  });

  test('every row carries exactly the columns calendar-days.ts reads and writes', () => {
    // The guard: pull the select list loadCalendarDayMap uses straight out
    // of the source, so a column added to one writer and not the other
    // fails here before it ships.
    const src = readFileSync(join(import.meta.dirname, '..', 'calendar-days.ts'), 'utf8');
    const select = /\.select\(\s*'(property_id, date, status[^']+)'/.exec(src);
    assert.ok(select, 'loadCalendarDayMap select list not found in calendar-days.ts');
    const expected = select![1].split(',').map((s) => s.trim()).sort();
    for (const r of rows) {
      assert.deepEqual(Object.keys(r).sort(), expected, `${r.date} has a different column set`);
    }
  });
});

describe('stays', () => {
  test('stay nights are booked with no block fields', () => {
    for (const iso of ['2026-10-15', '2026-10-16', '2026-10-17']) {
      const r = m.get(iso)!;
      assert.equal(r.status, 'booked', iso);
      assert.equal(r.block_type, null);
      assert.equal(r.block_ref_id, null);
      assert.equal(r.block_start, null);
    }
    assert.equal(m.get('2026-10-18')!.status, 'available', 'the checkout morning is not a night');
  });

  test('a duplicate row and a cancelled row hold nothing', () => {
    assert.equal(m.get('2026-10-13')!.status, 'available');
    assert.equal(m.get('2026-10-14')!.status, 'available');
    assert.equal(m.get('2026-10-22')!.status, 'available');
  });
});

describe('blocks', () => {
  test("an owner hold is 'o' with its note, author, ref id and an inclusive block_end", () => {
    for (const iso of ['2026-10-20', '2026-10-21']) {
      const r = m.get(iso)!;
      assert.equal(r.status, 'unavailable', iso);
      assert.equal(r.block_type, 'o');
      assert.equal(r.block_note, 'Ryan at the house');
      assert.equal(r.block_reason, 'Owner stay');
      assert.equal(r.block_created_by, 'ryan@risingtidestr.com');
      assert.equal(r.block_created_at, '2026-09-10T14:00:00Z');
      assert.equal(r.block_ref_id, 'hold-owner');
      assert.equal(r.block_start, '2026-10-20');
      assert.equal(r.block_end, '2026-10-21', "Guesty's endDate is the last HELD day");
    }
    assert.equal(m.get('2026-10-22')!.status, 'available', 'the hold releases on its checkout date');
  });

  test("a maintenance hold (or any non-owner hold) is 'm'", () => {
    const r = m.get('2026-10-24')!;
    assert.equal(r.status, 'unavailable');
    assert.equal(r.block_type, 'm');
    assert.equal(r.block_note, 'Boiler service');
    assert.equal(r.block_reason, 'Maintenance');
    assert.equal(r.block_ref_id, 'hold-maint');
    assert.equal(r.block_start, '2026-10-24');
    assert.equal(r.block_end, '2026-10-24');
    const untyped = buildHelmCalendarDays({
      propertyId: 'x',
      start: '2026-10-01',
      end: '2026-10-01',
      bookings: [{ id: 'h', status: 'block', check_in: '2026-10-01', check_out: '2026-10-02' }],
      plan: null,
      rateDays: new Map(),
      rentalPeriods: [],
    })[0];
    assert.equal(untyped.block_type, 'm');
    assert.equal(untyped.block_reason, null);
  });

  test("a closed rate day is 'm' 'Closed' for that one day", () => {
    const r = m.get('2026-10-23')!;
    assert.equal(r.status, 'unavailable');
    assert.equal(r.block_type, 'm');
    assert.equal(r.block_note, 'Deep clean', "the day's own note when it has one");
    assert.equal(r.block_reason, 'Closed');
    assert.equal(r.block_created_by, 'allie@risingtidestr.com');
    assert.equal(r.block_start, '2026-10-23');
    assert.equal(r.block_end, '2026-10-23');
    assert.equal(r.block_ref_id, null);
    const bare = buildHelmCalendarDays({
      propertyId: 'x',
      start: '2026-10-01',
      end: '2026-10-01',
      bookings: [],
      plan,
      rateDays: rateDayMap([day('2026-10-01', { closed: true })]),
      rentalPeriods: [],
    })[0];
    assert.equal(bare.block_note, 'Closed');
  });

  test("an off-season night is 'sr' 'Off season'", () => {
    const summer: RentalPeriod[] = [{ startMonth: 5, startDay: 1, endMonth: 10, endDay: 31 }];
    const nov = buildHelmCalendarDays({
      propertyId: '65_calderwood',
      start: '2026-10-31',
      end: '2026-11-01',
      bookings: [],
      plan,
      rateDays: new Map(),
      rentalPeriods: summer,
    });
    assert.equal(nov[0].status, 'available', 'Oct 31 is the last open day');
    assert.equal(nov[1].status, 'unavailable');
    assert.equal(nov[1].block_type, 'sr');
    assert.equal(nov[1].block_note, 'Off season');
    assert.equal(nov[1].block_reason, 'Off season');
    assert.equal(nov[1].block_start, '2026-11-01');
    assert.equal(nov[1].block_end, '2026-11-01');
  });

  test('a stay beats a block on the same night, a block beats a closed day', () => {
    const contested = buildHelmCalendarDays({
      propertyId: 'x',
      start: '2026-10-01',
      end: '2026-10-01',
      bookings: [
        { id: 'h', status: 'block', check_in: '2026-10-01', check_out: '2026-10-02' },
        { id: 's', status: 'confirmed', check_in: '2026-10-01', check_out: '2026-10-02' },
      ],
      plan,
      rateDays: rateDayMap([day('2026-10-01', { closed: true })]),
      rentalPeriods: [],
    })[0];
    assert.equal(contested.status, 'booked');
    assert.equal(contested.block_type, null);
  });
});

describe('price, currency and stay rules', () => {
  test('price falls to the base rate on a night with no override', () => {
    assert.equal(m.get('2026-10-15')!.price, 350);
    assert.equal(m.get('2026-10-17')!.price, 350, 'Saturday at the same weekend rate');
    assert.equal(m.get('2026-10-16')!.price, 520, 'the PriceLabs override');
    assert.equal(m.get('2026-10-20')!.price, 350, 'a held night still shows its rate, as Guesty does');
  });

  test('currency, min_nights, cta and ctd come from the plan and its day overrides', () => {
    assert.equal(m.get('2026-10-15')!.currency, 'USD');
    assert.equal(m.get('2026-10-15')!.min_nights, 3);
    assert.equal(m.get('2026-10-16')!.min_nights, 2);
    assert.equal(m.get('2026-10-14')!.cta, true);
    assert.equal(m.get('2026-10-14')!.ctd, true);
    assert.equal(m.get('2026-10-15')!.cta, false);
  });

  test('without a rate plan the statuses still write, with null pricing', () => {
    const r = buildHelmCalendarDays({
      propertyId: 'x',
      start: '2026-10-15',
      end: '2026-10-15',
      bookings,
      plan: null,
      rateDays: new Map(),
      rentalPeriods: [],
    })[0];
    assert.equal(r.status, 'booked');
    assert.equal(r.price, null);
    assert.equal(r.currency, null);
    assert.equal(r.min_nights, null);
  });

  test('a reversed window yields nothing', () => {
    assert.deepEqual(
      buildHelmCalendarDays({ propertyId: 'x', start: '2026-10-20', end: '2026-10-10', bookings: [], plan, rateDays: new Map(), rentalPeriods: [] }),
      [],
    );
  });
});

test('mirrorWindow is today-N .. today+M in Eastern time', () => {
  // 11 PM Eastern on Sep 26 is already Sep 27 in UTC; the window must not slip.
  const lateEvening = new Date('2026-09-27T03:00:00Z');
  assert.deepEqual(mirrorWindow(7, 45, lateEvening), { start: '2026-09-19', end: '2026-11-10' });
  assert.deepEqual(mirrorWindow(90, 540, new Date('2026-09-26T16:00:00Z')), { start: '2026-06-28', end: '2028-03-19' });
});
