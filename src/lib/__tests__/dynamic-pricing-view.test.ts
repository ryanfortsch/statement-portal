import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pricingCalendarMonth, pricingNightStatus, needsPricingAttention} from '../dynamic-pricing-view.ts';
import {createPricingDemo} from '../dynamic-pricing-demo.ts';
import {previewPricing} from '../dynamic-pricing.ts';

test('calendar shows the actual month and leaves dates outside the forecast unavailable', () => {
  const fixture = createPricingDemo(new Date('2026-11-10T12:00:00Z'));
  const preview = previewPricing(fixture.policy, fixture.snapshot, new Date(fixture.snapshot.observedAt));
  const cells = pricingCalendarMonth('2026-11', fixture.snapshot, preview);
  assert.equal(cells.length, 35);
  assert.equal(cells[0]?.date, '2026-11-01'); // Sunday
  assert.equal(cells[0]?.day, undefined);
  assert.equal(cells[0]?.status, null);
  assert.equal(cells[9]?.date, '2026-11-10');
  assert.equal(cells[9]?.status, 'booked');
  assert.equal(cells[30], null);
  const february = pricingCalendarMonth('2028-02', fixture.snapshot, preview);
  assert.equal(february.filter(d => d).length, 29);
  assert.equal(february[0], null);
  assert.equal(february[2]?.date, '2028-02-01');
  assert.throws(() => pricingCalendarMonth('2026-13', fixture.snapshot, preview));
});

test('attention separates actionable rate checks and missing data from protected or unavailable nights', () => {
  const f = createPricingDemo(new Date('2026-11-10T12:00:00Z'));
  const preview = previewPricing(f.policy, f.snapshot, new Date(f.snapshot.observedAt));
  assert.equal(pricingNightStatus(f.snapshot.days[0], preview.days[0]), 'booked');
  assert.equal(pricingNightStatus(f.snapshot.days[1], preview.days[1]), 'review');
  assert.equal(pricingNightStatus(f.snapshot.days[3], preview.days[3]), 'ready');
  assert.equal(pricingNightStatus(f.snapshot.days[4], preview.days[4]), 'manual');
  assert.equal(pricingNightStatus(f.snapshot.days[13], preview.days[13]), 'blocked');
  assert.equal(pricingNightStatus({...f.snapshot.days[1], state:'unknown'}, preview.days[1]), 'unknown');
  for (const status of ['booked','blocked','manual','ready'] as const) assert.equal(needsPricingAttention(status), false);
  for (const status of ['review','unknown'] as const) assert.equal(needsPricingAttention(status), true);
  assert.equal(pricingNightStatus(f.snapshot.days[3]), 'review'); // No valid preview is never ready.
});
