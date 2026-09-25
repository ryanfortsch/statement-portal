import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMonths, monthLabel, summarizeYtd } from '../forecast-fy-total.ts';

const fees = (rows: Record<string, Record<string, number>>) =>
  new Map(Object.entries(rows).map(([p, m]) => [p, new Map(Object.entries(m))]));

const closed2026 = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08'];
const forward2026 = ['2026-09', '2026-10', '2026-11', '2026-12'];

// ── The roll-up ─────────────────────────────────────────────────────────

test('year-to-date sums a property closed statements for the year', () => {
  const s = summarizeYtd(
    fees({ '4_brier_neck': { '2026-07': 7368.72, '2026-08': 5321.81 } }),
    closed2026, forward2026, 2026,
  );
  assert.ok(Math.abs(s.byProperty['4_brier_neck'] - 12690.53) < 1e-9);
  assert.ok(Math.abs(s.total - 12690.53) < 1e-9);
});

test('the real case: Brier Neck earned its whole year before the table starts', () => {
  // Every forward month is zero because it went offline in September, so the
  // forward-only total was a dash. The year-to-date column is the whole story.
  const s = summarizeYtd(
    fees({ '4_brier_neck': { '2026-07': 7368.72, '2026-08': 5321.81 } }),
    closed2026, forward2026, 2026,
  );
  const forwardOnly = 0;
  assert.equal(forwardOnly, 0);
  assert.ok(s.byProperty['4_brier_neck'] > 12000, 'the year is no longer a dash');
});

test('months outside the year are ignored on both sides', () => {
  const s = summarizeYtd(
    fees({ p: { '2025-12': 9999, '2026-04': 100 } }),
    [...closed2026, '2025-12'], [...forward2026, '2027-01'], 2026,
  );
  assert.equal(s.total, 100);
  assert.deepEqual(s.closedMonths, closed2026);
});

test('a property with no closed statements is absent rather than zero', () => {
  const s = summarizeYtd(fees({ p: { '2026-04': 0 } }), closed2026, forward2026, 2026);
  assert.equal(s.byProperty.p, undefined);
  assert.equal(s.total, 0);
});

// ── What the money actually covers ──────────────────────────────────────

test('months with actuals are reported separately from months that are closed', () => {
  // Helm's statements begin in April 2026: Jan to Mar are closed but empty.
  const s = summarizeYtd(
    fees({ a: { '2026-04': 100, '2026-08': 200 }, b: { '2026-05': 50 } }),
    closed2026, forward2026, 2026,
  );
  assert.equal(s.closedMonths.length, 8);
  assert.deepEqual(s.monthsWithActuals, ['2026-04', '2026-05', '2026-08']);
  assert.equal(describeMonths(s.monthsWithActuals), 'Apr to Aug');
});

test('describeMonths handles one month and none', () => {
  assert.equal(describeMonths(['2026-08']), 'Aug');
  assert.equal(describeMonths([]), '');
  assert.equal(monthLabel('2026-12'), 'Dec');
  assert.equal(monthLabel('nonsense'), '');
});

// ── The invariant that entitles the column to say "FY total" ────────────

test('closed plus forward tile the year, so the total is a fiscal year', () => {
  const s = summarizeYtd(fees({}), closed2026, forward2026, 2026);
  assert.equal(s.coversYear, true);
});

test('a future year is covered by its forward months alone', () => {
  const all2027 = Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`);
  const s = summarizeYtd(fees({}), [], all2027, 2027);
  assert.equal(s.coversYear, true);
});

test('a gap between the halves is not a fiscal year', () => {
  // August closed but October onward projected: September belongs to neither.
  const s = summarizeYtd(fees({}), closed2026, ['2026-10', '2026-11', '2026-12'], 2026);
  assert.equal(s.coversYear, false);
});

test('an OVERLAP is not a fiscal year either, since it would double count', () => {
  const s = summarizeYtd(fees({}), closed2026, ['2026-08', ...forward2026], 2026);
  assert.equal(s.coversYear, false, 'August would be counted twice');
});

test('forward months alone, mid-year, do not make a year', () => {
  const s = summarizeYtd(fees({}), [], forward2026, 2026);
  assert.equal(s.coversYear, false);
});
