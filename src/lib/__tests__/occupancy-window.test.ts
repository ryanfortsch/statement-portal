import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveStart } from '../occupancy-window.ts';

/**
 * Occupancy is booked nights over nights that COULD have been booked. These
 * pin what may be counted in that denominator.
 */

const HORIZON = '2026-03-02'; // Helm's earliest reservation, fleet-wide.

test('without a horizon the range start stands, exactly as before', () => {
  assert.equal(effectiveStart('2026-01-01', null), '2026-01-01');
  assert.equal(effectiveStart('2026-01-01', null, null), '2026-01-01');
});

test('nights before Helm has any record of anything are not measured', () => {
  // Full Year 2026: January and February put 1,121 nights in the denominator
  // with nothing possible on top, marking the fleet down for months it never
  // measured.
  assert.equal(effectiveStart('2026-01-01', null, HORIZON), HORIZON);
});

test('a range that starts after the horizon is untouched', () => {
  assert.equal(effectiveStart('2026-08-01', null, HORIZON), '2026-08-01');
  assert.equal(effectiveStart('2026-03-02', null, HORIZON), '2026-03-02');
});

test('an explicit activation date wins, because it is the business fact', () => {
  // 84 Thatcher came on 2026-06-15. Counting it from March would mark it down
  // for three months it was not on the program.
  assert.equal(effectiveStart('2026-01-01', '2026-06-15', HORIZON), '2026-06-15');
  assert.equal(effectiveStart('2026-08-01', '2026-06-15', HORIZON), '2026-08-01');
});

test('a timestamp activation date is reduced to its day', () => {
  assert.equal(effectiveStart('2026-01-01', '2026-06-15T04:00:00.000Z', HORIZON), '2026-06-15');
});

test('the latest of the three always wins, in every order', () => {
  assert.equal(effectiveStart('2026-05-01', '2026-02-01', HORIZON), '2026-05-01');
  assert.equal(effectiveStart('2026-01-01', '2026-02-01', HORIZON), HORIZON);
  assert.equal(effectiveStart('2026-01-01', '2026-09-01', HORIZON), '2026-09-01');
});

test('a home activated before the horizon is still not measured before it', () => {
  // The home was ours, but Helm holds nothing for that period, so there is
  // nothing to measure rather than nothing sold.
  assert.equal(effectiveStart('2026-01-01', '2026-01-15', HORIZON), HORIZON);
});
