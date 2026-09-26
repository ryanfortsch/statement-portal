/**
 * The Helm-native pricing brain against the 65 Calderwood rate card Guesty
 * held on 2026-09-25 (base $350, weekend $350 on Fri/Sat, 4 guests included,
 * $35 per extra guest per night, $300 cleaning, min 3 / max 91 nights, 24h
 * notice, 365-day window; CT 15% on accommodation + cleaning, exempt past 30
 * nights, Airbnb collects its own).
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  quoteStay,
  rateDayMap,
  resolveMinNights,
  resolveNightlyCents,
  resolveTaxRate,
  taxRateFor,
  TaxJurisdictionUnknownError,
  zonedTimeToMs,
  type RateDayRow,
  type RatePlanRow,
  type TaxConfigRow,
} from '../rate-plan.ts';

const calderwood: RatePlanRow = {
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

const ctTax: TaxConfigRow = {
  property_id: '65_calderwood',
  jurisdiction: 'CT',
  state_rate: 0.15,
  local_rate: 0,
  cif_rate: 0,
  applies_to: ['accommodation', 'cleaning'],
  long_stay_exempt_over_nights: 30,
  collected_by_channels: ['airbnb'],
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

/** A quiet September afternoon, weeks before every stay quoted below. */
const NOW = new Date('2026-09-26T16:00:00Z');

describe('the Calderwood quote Guesty would have produced', () => {
  const q = quoteStay({
    plan: calderwood,
    days: new Map(),
    tax: ctTax,
    checkIn: '2026-10-15',
    checkOut: '2026-10-18',
    guests: 6,
    channel: 'direct',
    now: NOW,
  });

  test('Thu-Sun is three nights, Fri and Sat at the weekend rate', () => {
    assert.equal(q.nights, 3);
    assert.deepEqual(
      q.nightly.map((n) => [n.date, n.cents, n.source]),
      [
        ['2026-10-15', 35000, 'base'],
        ['2026-10-16', 35000, 'weekend'],
        ['2026-10-17', 35000, 'weekend'],
      ],
    );
    assert.equal(q.accommodation_cents, 105000);
  });

  test('two guests over the four included pay $35 a night each, three nights', () => {
    assert.equal(q.extra_guest_cents, 2 * 3500 * 3);
  });

  test('cleaning is $300 and CT charges 15% on accommodation, extras and cleaning', () => {
    assert.equal(q.cleaning_cents, 30000);
    assert.equal(q.taxable_base_cents, 105000 + 21000 + 30000);
    assert.equal(q.tax_rate, 0.15);
    assert.equal(q.tax_exempt, false);
    assert.equal(q.tax_cents, 23400);
    assert.equal(q.subtotal_cents, 156000);
    assert.equal(q.total_cents, 179400);
    assert.equal(q.currency, 'USD');
  });

  test('nothing on the card is violated', () => {
    assert.deepEqual(q.violations, []);
    assert.equal(q.discount_cents, 0);
    assert.equal(q.discount_label, null);
    assert.equal(q.markup_cents, 0);
  });
});

describe('tax', () => {
  test('a 31-night stay is exempt under the 30-night override, a 30-night one is not', () => {
    const long = quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2026-11-01', checkOut: '2026-12-02', guests: 2, channel: 'direct', now: NOW });
    assert.equal(long.nights, 31);
    assert.equal(long.tax_exempt, true);
    assert.equal(long.tax_cents, 0);
    assert.equal(long.total_cents, long.subtotal_cents);
    const month = quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2026-11-01', checkOut: '2026-12-01', guests: 2, channel: 'direct', now: NOW });
    assert.equal(month.nights, 30);
    assert.equal(month.tax_exempt, false);
    assert.ok(month.tax_cents > 0);
  });

  test('Airbnb collects and remits CT tax itself, so an airbnb quote carries none', () => {
    const q = quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 6, channel: 'airbnb', now: NOW });
    assert.equal(q.tax_cents, 0);
    assert.equal(q.tax_exempt, true);
    assert.equal(q.tax_rate, 0.15, 'the jurisdiction rate is still reported');
  });

  test('taxRateFor sums state, local and cif and names why a stay is exempt', () => {
    const ma: TaxConfigRow = { ...ctTax, jurisdiction: 'MA', state_rate: 0.057, local_rate: 0.06, cif_rate: 0.03, long_stay_exempt_over_nights: 31, collected_by_channels: [] };
    assert.equal(taxRateFor(ma, 3, 'direct').rate, 0.147);
    assert.deepEqual(taxRateFor(ctTax, 3, 'direct'), { rate: 0.15, exempt: false, reason: null, taxes_cleaning: true });
    assert.equal(taxRateFor(ctTax, 31, 'direct').reason, 'long_stay');
    assert.equal(taxRateFor(ctTax, 3, 'Airbnb').reason, 'collected_by_channel');
    assert.equal(taxRateFor({ ...ctTax, applies_to: ['accommodation'] }, 3, 'direct').taxes_cleaning, false);
  });

  test('a jurisdiction that does not tax cleaning leaves the fee out of the taxed base', () => {
    const q = quoteStay({ plan: calderwood, days: new Map(), tax: { ...ctTax, applies_to: ['accommodation'] }, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 4, channel: 'direct', now: NOW });
    assert.equal(q.taxable_base_cents, 105000);
    assert.equal(q.tax_cents, 15750);
    assert.equal(q.subtotal_cents, 135000, 'cleaning still rides the subtotal');
    assert.equal(q.total_cents, 150750);
  });

  test('a null tax row on a cape_ann property falls back to the MA table', () => {
    const horton = { ...calderwood, property_id: '21_horton' };
    const q = quoteStay({ plan: horton, days: new Map(), tax: null, region: 'cape_ann', checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 2, channel: 'direct', now: NOW });
    assert.equal(q.tax_rate, 0.117);
    const cif = quoteStay({ plan: { ...calderwood, property_id: '79_main' }, days: new Map(), tax: null, region: null, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 2, channel: 'direct', now: NOW });
    assert.equal(cif.tax_rate, 0.147, 'a null region reads as Cape Ann and 79 Main owes the CIF');
    const legacy = resolveTaxRate({ config: null, propertyId: '21_horton', region: 'cape_ann', nights: 32, channel: 'direct' });
    assert.equal(legacy.source, 'ma_legacy');
    assert.equal(legacy.exempt, true, 'the SCA 31-night exemption applies on the MA path');
  });

  test('a null tax row on any other region throws instead of quoting 11.7%', () => {
    assert.throws(
      () => quoteStay({ plan: calderwood, days: new Map(), tax: null, region: 'bridgeport_ct', checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 2, channel: 'direct', now: NOW }),
      TaxJurisdictionUnknownError,
    );
    assert.throws(
      () => resolveTaxRate({ config: null, propertyId: '3246_ne_27th', region: 'lighthouse_point_fl', nights: 3, channel: 'direct' }),
      (err: unknown) => err instanceof TaxJurisdictionUnknownError && err.region === 'lighthouse_point_fl',
    );
  });

  test('an already-resolved tax decision wins over the row', () => {
    const q = quoteStay({ plan: calderwood, days: new Map(), tax: null, region: 'bridgeport_ct', taxOverride: { rate: 0.15, exempt: false }, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 4, channel: 'direct', now: NOW });
    assert.equal(q.tax_cents, Math.round((105000 + 30000) * 0.15));
  });
});

describe('nightly rates and minimum stay', () => {
  test('a day override beats the base and the weekend rate', () => {
    const days = rateDayMap([day('2026-10-16', { nightly_cents: 52000 })]);
    assert.equal(resolveNightlyCents(calderwood, days.get('2026-10-16'), '2026-10-16'), 52000);
    assert.equal(resolveNightlyCents(calderwood, days.get('2026-10-17'), '2026-10-17'), 35000);
    const q = quoteStay({ plan: calderwood, days, tax: ctTax, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 4, channel: 'direct', now: NOW });
    assert.equal(q.accommodation_cents, 35000 + 52000 + 35000);
    assert.equal(q.nightly[1].source, 'override');
  });

  test('the weekend rate is read by the UTC weekday of the ISO date', () => {
    const plan = { ...calderwood, weekend_nightly_cents: 45000 };
    assert.equal(resolveNightlyCents(plan, null, '2026-10-15'), 35000, 'Thursday');
    assert.equal(resolveNightlyCents(plan, null, '2026-10-16'), 45000, 'Friday');
    assert.equal(resolveNightlyCents(plan, null, '2026-10-17'), 45000, 'Saturday');
    assert.equal(resolveNightlyCents(plan, null, '2026-10-18'), 35000, 'Sunday');
    assert.equal(resolveNightlyCents({ ...plan, weekend_nightly_cents: null }, null, '2026-10-16'), 35000, 'no weekend rate = base');
  });

  test('the check-in day may carry its own minimum', () => {
    assert.equal(resolveMinNights(calderwood, null), 3);
    assert.equal(resolveMinNights(calderwood, day('2026-10-15', { min_nights: 2 })), 2);
    const days = rateDayMap([day('2026-10-15', { min_nights: 2 })]);
    const q = quoteStay({ plan: calderwood, days, tax: ctTax, checkIn: '2026-10-15', checkOut: '2026-10-17', guests: 2, channel: 'direct', now: NOW });
    assert.deepEqual(q.violations, [], 'two nights is fine when the day says two');
  });
});

describe('discounts and the direct markup', () => {
  test('weekly at seven nights, monthly at twenty-eight, monthly wins', () => {
    const plan = { ...calderwood, weekly_discount_pct: 10, monthly_discount_pct: 20, max_nights: null };
    const six = quoteStay({ plan, days: new Map(), tax: ctTax, checkIn: '2026-10-05', checkOut: '2026-10-11', guests: 2, channel: 'direct', now: NOW });
    assert.equal(six.discount_cents, 0);
    const week = quoteStay({ plan, days: new Map(), tax: ctTax, checkIn: '2026-10-05', checkOut: '2026-10-12', guests: 2, channel: 'direct', now: NOW });
    assert.equal(week.discount_cents, Math.round(week.accommodation_cents * 0.1));
    assert.equal(week.discount_label, 'Weekly discount');
    assert.equal(week.taxable_base_cents, week.accommodation_cents - week.discount_cents + 30000);
    const month = quoteStay({ plan, days: new Map(), tax: ctTax, checkIn: '2026-10-05', checkOut: '2026-11-02', guests: 2, channel: 'direct', now: NOW });
    assert.equal(month.nights, 28);
    assert.equal(month.discount_cents, Math.round(month.accommodation_cents * 0.2));
    assert.equal(month.discount_label, 'Monthly discount');
  });

  test('direct_markup_pct rides direct and sca quotes as its own taxed line, never an OTA quote', () => {
    const plan = { ...calderwood, direct_markup_pct: 6 };
    const direct = quoteStay({ plan, days: new Map(), tax: ctTax, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 4, channel: 'direct', now: NOW });
    assert.equal(direct.markup_cents, 6300);
    assert.equal(direct.accommodation_cents, 105000, 'the nightly sum is reported unmarked');
    assert.equal(direct.taxable_base_cents, 105000 + 6300 + 30000);
    assert.equal(direct.total_cents, 141300 + Math.round(141300 * 0.15));
    const sca = quoteStay({ plan, days: new Map(), tax: ctTax, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 4, channel: 'sca', now: NOW });
    assert.equal(sca.markup_cents, 6300);
    const vrbo = quoteStay({ plan, days: new Map(), tax: ctTax, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 4, channel: 'vrbo', now: NOW });
    assert.equal(vrbo.markup_cents, 0);
    // Calderwood's own plan records 0 explicitly: Guesty's +6% Markup line
    // on Airbnb folios is a channel markup, not a direct price.
    assert.equal(quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 4, channel: 'direct', now: NOW }).markup_cents, 0);
  });
});

describe('violations', () => {
  test('a 2-night ask against min 3', () => {
    const q = quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2026-10-15', checkOut: '2026-10-17', guests: 2, channel: 'direct', now: NOW });
    assert.deepEqual(q.violations, ['min_nights']);
    assert.ok(q.total_cents > 0, 'the price is still computed so the guest can see what three nights would cost');
  });

  test('max nights, occupancy and a closed night', () => {
    const long = quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2026-10-01', checkOut: '2027-01-01', guests: 2, channel: 'direct', now: NOW });
    assert.ok(long.violations.includes('max_nights'));
    const crowd = quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 7, channel: 'direct', now: NOW });
    assert.deepEqual(crowd.violations, ['over_occupancy']);
    const closed = quoteStay({ plan: calderwood, days: rateDayMap([day('2026-10-16', { closed: true })]), tax: ctTax, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 2, channel: 'direct', now: NOW });
    assert.deepEqual(closed.violations, ['closed_night']);
  });

  test('advance notice is measured to the check-in hour in Eastern time', () => {
    // 8 PM Eastern on Oct 15 = 00:00Z Oct 16 (EDT).
    const tonight = new Date('2026-10-16T00:00:00Z');
    const same = quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2026-10-15', checkOut: '2026-10-18', guests: 2, channel: 'direct', now: tonight });
    assert.deepEqual(same.violations, ['advance_notice'], 'tonight is gone');
    const tomorrow = quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2026-10-16', checkOut: '2026-10-19', guests: 2, channel: 'direct', now: tonight });
    assert.deepEqual(tomorrow.violations, ['advance_notice'], '4 PM tomorrow is 20 hours away, under the 24h rule');
    const dayAfter = quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2026-10-17', checkOut: '2026-10-20', guests: 2, channel: 'direct', now: tonight });
    assert.deepEqual(dayAfter.violations, []);
  });

  test('the booking window closes 365 days out', () => {
    const far = quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2027-11-20', checkOut: '2027-11-23', guests: 2, channel: 'direct', now: NOW });
    assert.deepEqual(far.violations, ['booking_window']);
    const edge = quoteStay({ plan: calderwood, days: new Map(), tax: ctTax, checkIn: '2027-09-26', checkOut: '2027-09-29', guests: 2, channel: 'direct', now: NOW });
    assert.deepEqual(edge.violations, [], 'exactly 365 days out is still inside');
  });
});

test('zonedTimeToMs places a wall-clock hour in Eastern time across DST', () => {
  assert.equal(zonedTimeToMs('2026-10-15', '16:00'), Date.UTC(2026, 9, 15, 20, 0), 'EDT is UTC-4');
  assert.equal(zonedTimeToMs('2026-12-15', '16:00'), Date.UTC(2026, 11, 15, 21, 0), 'EST is UTC-5');
  assert.equal(zonedTimeToMs('2026-10-15', '11:00'), Date.UTC(2026, 9, 15, 15, 0));
});
