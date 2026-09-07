import test from 'node:test';
import assert from 'node:assert/strict';
import { monthGate } from '../statement-month-gate.ts';

const plain = { hasSliceThisMonth: false, hasSlicesAnywhere: false };

test('a stay checking out this month with no split is recognized', () => {
  assert.equal(monthGate({ checkOutMonth: '2026-08', month: '2026-08', ...plain }), 'recognize');
});

test('a stay checking out in another month with no split is held out as out-of-month', () => {
  assert.equal(monthGate({ checkOutMonth: '2026-09', month: '2026-08', ...plain }), 'out_of_month');
  assert.equal(monthGate({ checkOutMonth: '2026-07', month: '2026-08', ...plain }), 'out_of_month');
});

test('an unknown checkout is not held out', () => {
  assert.equal(monthGate({ checkOutMonth: '', month: '2026-08', ...plain }), 'recognize');
});

test('a split with a slice for this month is recognized (the fork books the in-month share)', () => {
  assert.equal(monthGate({ checkOutMonth: '2026-08', month: '2026-08', hasSliceThisMonth: true, hasSlicesAnywhere: true }), 'recognize');
  // Even when the checkout is elsewhere: the slice is what the month owns.
  assert.equal(monthGate({ checkOutMonth: '2026-09', month: '2026-08', hasSliceThisMonth: true, hasSlicesAnywhere: true }), 'recognize');
});

test('Kate Bacon: checks out on the 1st, slices in June and July, none in August: August recognizes nothing', () => {
  // 17 Beach, June 27 to August 1 2026, $62,464.40 split over June and
  // July. The August PDF lists the booking at full value and its checkout
  // month IS August, which is why the old checkout-month test passed it.
  assert.equal(
    monthGate({ checkOutMonth: '2026-08', month: '2026-08', hasSliceThisMonth: false, hasSlicesAnywhere: true }),
    'recognized_elsewhere',
  );
});

test('a split with no slice for this month is recognized elsewhere whatever its checkout month', () => {
  assert.equal(
    monthGate({ checkOutMonth: '2026-10', month: '2026-08', hasSliceThisMonth: false, hasSlicesAnywhere: true }),
    'recognized_elsewhere',
  );
});

test('a slice this month always implies slices anywhere; the gate still answers recognize on inconsistent input', () => {
  assert.equal(monthGate({ checkOutMonth: '2026-08', month: '2026-08', hasSliceThisMonth: true, hasSlicesAnywhere: false }), 'recognize');
});
