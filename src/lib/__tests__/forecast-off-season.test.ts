/**
 * A home's off-season is read from its shoulder month and applied outside
 * June to September (2026-10-16, 17 Beach's October at 61% of the curve).
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  OFF_SEASON_FACTOR_MIN,
  isOffSeasonMonth,
  offSeasonFactor,
  previousMonth,
  realizedForShoulder,
  shoulderMonthFor,
} from '../forecast-off-season.ts';

describe('which months the factor touches', () => {
  test('June to September are summer, the rest are off-season', () => {
    for (const m of ['2027-06', '2027-07', '2027-08', '2027-09']) assert.equal(isOffSeasonMonth(m), false, m);
    for (const m of ['2026-10', '2026-11', '2026-12', '2027-01', '2027-04', '2027-05']) assert.equal(isOffSeasonMonth(m), true, m);
  });
  test('previousMonth crosses the year', () => {
    assert.equal(previousMonth('2027-01'), '2026-12');
    assert.equal(previousMonth('2026-10'), '2026-09');
  });
});

describe('the shoulder month', () => {
  test('is the current month from the 15th, the month before until then', () => {
    assert.deepEqual(shoulderMonthFor(new Date(2026, 9, 16)), { month: '2026-10', current: true });
    assert.deepEqual(shoulderMonthFor(new Date(2026, 10, 3)), { month: '2026-10', current: false });
    assert.deepEqual(shoulderMonthFor(new Date(2026, 10, 15)), { month: '2026-11', current: true });
  });
  test('a summer month teaches nothing', () => {
    assert.equal(shoulderMonthFor(new Date(2027, 6, 20)), null, 'July');
    assert.equal(shoulderMonthFor(new Date(2027, 6, 3)), null, 'early July reads June');
    assert.equal(shoulderMonthFor(new Date(2027, 9, 2)), null, 'early October reads September, which is summer');
  });
});

describe('what the shoulder month is on course to do', () => {
  test('a finished month is its bookings', () => {
    assert.equal(realizedForShoulder({ booked: 19580, paceA: 25000, remaining: 0 }), 19580);
  });
  test('the current month adds the pace-up on the days still ahead', () => {
    // 7 Sumac on 2026-10-16: $8,332 booked, pace-up to $15,058, 16 of 31 days ahead.
    const r = realizedForShoulder({ booked: 8332, paceA: 15058, remaining: 16 / 31 });
    assert.ok(Math.abs(r - 11803) < 1, `${r}`);
    assert.equal(realizedForShoulder({ booked: 19580, paceA: 19580, remaining: 0.5 }), 19580, 'no pace-up, no pickup');
    assert.equal(realizedForShoulder({ booked: 5000, paceA: null, remaining: 0.5 }), 5000, 'no Part A at all');
    assert.equal(realizedForShoulder({ booked: 5000, paceA: 4000, remaining: 0.5 }), 5000, 'Part A never sits under the book');
  });
});

describe('the factor', () => {
  test('17 Beach: $19,580 on the books against $32,061 expected is 61%', () => {
    assert.ok(Math.abs(offSeasonFactor(19580, 32061) - 0.6107) < 0.001);
  });
  test('only lowers, never below the minimum, and learns nothing from nothing', () => {
    assert.equal(offSeasonFactor(13391, 9417), 1, '16 Waterman is above the curve');
    assert.equal(offSeasonFactor(1000, 10000), OFF_SEASON_FACTOR_MIN);
    assert.equal(offSeasonFactor(0, 14015), 1, 'nothing booked is a gap, not a fact');
    assert.equal(offSeasonFactor(5000, 0), 1);
  });
});
