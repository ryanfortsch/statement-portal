/**
 * The Pricing section (RatesPanel.tsx) and its pure half (pricing-panel.ts).
 *
 * The load-bearing guard: saveRatePlanAction writes the whole plan from one
 * post and fills a default for any field it does not get, so each of the
 * three questions must post every field, its own visibly and the rest at
 * their saved values. A field no question carried would be silently reset
 * on every save. So the questions' field lists must cover exactly the
 * fields the action reads, once each.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLAN_FIELDS,
  feeLines,
  monthStart,
  monthWeeks,
  nightLines,
  overridesSummary,
  planFormValues,
  planNightCents,
  stayLines,
  taxLine,
} from '../pricing-panel.ts';
import type { RateDayRow, RatePlanRow } from '../rate-plan.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const plan = (over: Partial<RatePlanRow> = {}): RatePlanRow => ({
  property_id: 'synthetic',
  currency: 'USD',
  base_nightly_cents: 42500,
  weekend_nightly_cents: 49500,
  weekend_days: [5, 6],
  guests_included: 4,
  extra_guest_cents_per_night: 2500,
  cleaning_fee_cents: 25000,
  pet_fee_cents: null,
  security_deposit_cents: null,
  weekly_discount_pct: 10,
  monthly_discount_pct: 0,
  direct_markup_pct: 6,
  min_nights_default: 3,
  max_nights: null,
  advance_notice_hours: 24,
  booking_window_days: 365,
  turnover_buffer_days: 0,
  checkin_time: '16:00',
  checkout_time: '10:00',
  max_occupancy: 8,
  pets_allowed: false,
  quiet_hours: null,
  cancellation_policy_key: 'moderate',
  cancellation_terms: null,
  house_rules: null,
  ...over,
} as RatePlanRow);

describe('the three questions post the whole plan', () => {
  const action = read('src/app/properties/[id]/rates-actions.ts');
  const fn = action.slice(action.indexOf('export async function saveRatePlanAction'), action.indexOf('// ── Tax config'));
  const read_ = new Set([...fn.matchAll(/\(fd, '([a-z_]+)'/g), ...fn.matchAll(/getAll\('([a-z_]+)'\)/g)].map((m) => m[1]));

  test('the questions cover every field the save reads, once each', () => {
    assert.ok(read_.size >= 18, `found only ${read_.size} fields in saveRatePlanAction`);
    const all = Object.values(PLAN_FIELDS).flat();
    assert.equal(new Set(all).size, all.length, 'a field sits under two questions');
    assert.deepEqual([...new Set(all)].sort(), [...read_].sort(), 'the questions and saveRatePlanAction disagree on the fields');
  });

  test('every field has a value to carry, and nothing else does', () => {
    assert.deepEqual(Object.keys(planFormValues(null)).sort(), [...read_].sort());
    assert.deepEqual(Object.keys(planFormValues(plan())).sort(), [...read_].sort());
  });

  test('carried values are the saved ones, in the form the save reads', () => {
    const v = planFormValues(plan());
    assert.equal(v.base_nightly, '425');
    assert.equal(v.weekend_nightly, '495');
    assert.deepEqual(v.weekend_days, ['5', '6']);
    assert.equal(v.pet_fee, '');
    assert.equal(v.max_nights, '');
    assert.equal(v.checkin_time, '16:00');
    assert.equal(planFormValues(plan({ cleaning_fee_cents: 12550 })).cleaning_fee, '125.50');
  });

  test('each question renders its own fields and carries the rest', () => {
    const panel = read('src/app/properties/[id]/RatesPanel.tsx');
    for (const name of Object.values(PLAN_FIELDS).flat()) {
      assert.ok(panel.includes(`name="${name}"`), `no input for ${name}`);
    }
    assert.ok(panel.includes('.filter(([name]) => !PLAN_FIELDS[q].includes(name))'), 'the form stopped carrying the other questions');
  });
});

describe('the questions read as sentences', () => {
  test('a night', () => {
    assert.deepEqual(nightLines(plan()), ['$425 a night', '$495 on Fri and Sat nights', '10% off a week', 'direct bookings 6% more']);
    assert.deepEqual(nightLines(plan({ weekend_nightly_cents: null, weekly_discount_pct: 0, direct_markup_pct: 0 })), ['$425 a night']);
  });

  test('a stay', () => {
    assert.deepEqual(stayLines(plan()), ['3 nights minimum', 'book up to 365 days ahead', "24 hours' notice", 'guest check-in 4:00 PM']);
    assert.ok(stayLines(plan({ max_nights: 28, turnover_buffer_days: 1, advance_notice_hours: 0 })).includes('1 night kept free between stays'));
  });

  test('fees and taxes', () => {
    assert.deepEqual(feeLines(plan()), ['$250 cleaning', '$25 a night for each guest over 4', 'no pet fee']);
    assert.deepEqual(taxLine(null, 'cape_ann'), { text: 'Massachusetts occupancy tax for this home (no rate saved here)', refuses: false });
    assert.equal(taxLine(null, 'bridgeport_ct').refuses, true);
    const ct = taxLine({ property_id: 'x', jurisdiction: 'CT', state_rate: 0.15, local_rate: 0, cif_rate: 0, applies_to: ['accommodation'], long_stay_exempt_over_nights: 30, collected_by_channels: ['airbnb'] }, 'bridgeport_ct');
    assert.equal(ct.text, '15% tax on the nights · none over 30 nights · Airbnb collect their own');
  });
});

describe('the nights-that-differ calendar', () => {
  test('a month is Sunday-first weeks with blanks outside it', () => {
    const weeks = monthWeeks('2026-10-01');
    assert.ok(weeks.every((w) => w.length === 7));
    assert.deepEqual(weeks[0].slice(0, 5), [null, null, null, null, '2026-10-01']);
    assert.equal(weeks.flat().filter(Boolean).length, 31);
    assert.equal(monthStart('2026-10-19', 3), '2027-01-01');
  });

  test('a night with no override reads the plan', () => {
    assert.equal(planNightCents(plan(), '2026-10-23'), 49500); // a Friday
    assert.equal(planNightCents(plan(), '2026-10-21'), 42500);
    assert.equal(planNightCents(null, '2026-10-21'), null);
  });

  test('the summary counts what differs', () => {
    assert.equal(overridesSummary([]), 'Every night uses the plan');
    const day = (date: string, cents: number | null, closed = false): RateDayRow => ({ property_id: 'x', date, nightly_cents: cents, min_nights: null, cta: false, ctd: false, closed, note: null, source: 'operator' });
    assert.equal(overridesSummary([day('2026-11-01', 55000), day('2026-11-02', 39000), day('2026-11-03', null, true)]), '3 nights differ in the next year · $390 to $550 · 1 closed');
  });
});

describe('the Pricing section speaks plainly', () => {
  test('no table names, file paths or seed talk on screen', () => {
    const panel = read('src/app/properties/[id]/RatesPanel.tsx');
    const ui = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['property_tax_config', 'occupancy-tax', 'seed', 'Guesty hid', 'pricing feed', 'Distinct next', '(CTA)', '(CTD)', 'Quote tester']) {
      assert.ok(!ui.includes(word), `the Pricing section says "${word}"`);
    }
  });

  test("on a Guesty-run home the head says once that guests pay Guesty's prices", () => {
    const page = read('src/app/properties/[id]/page.tsx');
    const tab = page.slice(page.indexOf('<TabSection tab="guest">'), page.indexOf('</PropertyTabs>'));
    const section = tab.slice(tab.indexOf('id="rates"'), tab.indexOf('<RatesPanel'));
    assert.ok(section.includes('title="Pricing"'));
    assert.ok(section.includes("guests pay Guesty's prices today"), 'the Guesty sentence left the section head');
    const panel = read('src/app/properties/[id]/RatesPanel.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/Guesty/.test(panel), 'the panel repeats the Guesty sentence');
  });
});
