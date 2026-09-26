import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveManagementFee, type StatementFeeInput } from '../revenue-statement-fee.ts';

const base: StatementFeeInput = {
  segmentMonths: ['2026-07', '2026-08', '2026-09'],
  statementMonths: ['2026-07', '2026-08'],
  pacedMonths: ['2026-09'],
  bookedMonths: [],
  statementFee: 10_000,
  statementRevenue: 40_000,
  totalRevenue: 50_000,
  mgmtFraction: 0.25,
};

const near = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, msg ?? `${a} vs ${b}`);

// ── The substitution ────────────────────────────────────────────────────

test('closed months bill their statement fee, and only the rest is derived', () => {
  const r = resolveManagementFee(base);
  assert.equal(r.usedStatementFee, true);
  // $10,000 billed, plus the $10,000 of September revenue at 25%.
  near(r.fee, 10_000 + 2_500);
});

test('the statement fee is used even when it disagrees with rate x revenue', () => {
  // 4 Brier Neck, August 2026: $5,321.81 billed on a refund basis, while
  // 20% of its $29,160.50 revenue recomputes to $5,832.10. The ruling wins.
  const r = resolveManagementFee({
    segmentMonths: ['2026-08'],
    statementMonths: ['2026-08'],
    pacedMonths: [],
    bookedMonths: [],
    statementFee: 5_321.81,
    statementRevenue: 29_160.50,
    totalRevenue: 29_160.50,
    mgmtFraction: 0.20,
  });
  near(r.fee, 5_321.81);
  assert.notEqual(Math.round(r.fee * 100), Math.round(29_160.50 * 0.2 * 100));
});

test('an add-on fee base survives too, in the other direction', () => {
  // 19 Rackliffe, August: billed $6,782.43 on a base above rental revenue.
  const r = resolveManagementFee({
    segmentMonths: ['2026-08'], statementMonths: ['2026-08'], pacedMonths: [], bookedMonths: [],
    statementFee: 6_782.43, statementRevenue: 25_925.72, totalRevenue: 25_925.72, mgmtFraction: 0.25,
  });
  near(r.fee, 6_782.43);
});

// ── Falling back rather than guessing ───────────────────────────────────

test('no closed statement month leaves the old recompute untouched', () => {
  const r = resolveManagementFee({
    ...base, statementMonths: [], pacedMonths: ['2026-07', '2026-08', '2026-09'],
    statementFee: 0, statementRevenue: 0,
  });
  assert.equal(r.usedStatementFee, false);
  near(r.fee, 50_000 * 0.25);
});

test('a month claimed by nobody is not a tiled range, so nothing is substituted', () => {
  // August fell through every branch: its dollars are in totalRevenue but no
  // branch accounted for them.
  const r = resolveManagementFee({ ...base, pacedMonths: [] });
  assert.equal(r.tilesRange, false);
  assert.equal(r.usedStatementFee, false);
  near(r.fee, 50_000 * 0.25);
});

test('a month claimed TWICE is rejected, because that is the double count', () => {
  const r = resolveManagementFee({ ...base, pacedMonths: ['2026-08', '2026-09'] });
  assert.equal(r.tilesRange, false);
  assert.equal(r.usedStatementFee, false);
});

test('a month outside the range cannot be claimed', () => {
  // September's statements exist but September is the CURRENT month, so the
  // swap never fired. A fee keyed off statement existence would land here.
  const r = resolveManagementFee({
    ...base,
    segmentMonths: ['2026-07', '2026-08'],
    statementMonths: ['2026-07', '2026-08', '2026-09'],
    pacedMonths: [],
  });
  assert.equal(r.tilesRange, false);
  assert.equal(r.usedStatementFee, false);
});

test('a partial edge month is simply not in statementMonths, and that is enough', () => {
  // Last 90 Days clips June. Its statement exists; the swap skipped it; the
  // month is still claimed, by the booked branch.
  const r = resolveManagementFee({
    segmentMonths: ['2026-06', '2026-07', '2026-08', '2026-09'],
    statementMonths: ['2026-07', '2026-08'],
    pacedMonths: ['2026-09'],
    bookedMonths: ['2026-06'],
    statementFee: 10_000, statementRevenue: 40_000, totalRevenue: 55_000, mgmtFraction: 0.25,
  });
  assert.equal(r.tilesRange, true);
  near(r.fee, 10_000 + 15_000 * 0.25);
});

test('revenue meaningfully below the statements own months falls back rather than inventing a fee', () => {
  const r = resolveManagementFee({ ...base, totalRevenue: 30_000 });
  assert.equal(r.usedStatementFee, false);
  near(r.fee, 30_000 * 0.25);
});

test('a rounding hair below zero still bills the statements', () => {
  // The card's revenue is rounded to cents before the statement's own revenue
  // is subtracted, so an all-statement range lands either side of zero. 4
  // Brier Neck's August reverted to $5,832.10 over exactly this, against the
  // $5,321.81 it had billed.
  const r = resolveManagementFee({
    segmentMonths: ['2026-08'], statementMonths: ['2026-08'], pacedMonths: [], bookedMonths: [],
    statementFee: 5_321.81,
    statementRevenue: 29_160.51,
    totalRevenue: 29_160.50, // one cent short
    mgmtFraction: 0.20,
  });
  assert.equal(r.usedStatementFee, true);
  near(r.fee, 5_321.81);
});

test('the clamp never bills a NEGATIVE remainder back against the statement', () => {
  const r = resolveManagementFee({
    segmentMonths: ['2026-08'], statementMonths: ['2026-08'], pacedMonths: [], bookedMonths: [],
    statementFee: 1_000, statementRevenue: 10_000, totalRevenue: 9_999.5, mgmtFraction: 0.25,
  });
  near(r.fee, 1_000, 'the shortfall is clamped, not subtracted');
});

test('the tolerance is a dollar, not a licence', () => {
  const justInside = resolveManagementFee({ ...base, totalRevenue: 40_000 - 0.99 });
  assert.equal(justInside.usedStatementFee, true);
  const justOutside = resolveManagementFee({ ...base, totalRevenue: 40_000 - 1.01 });
  assert.equal(justOutside.usedStatementFee, false);
});

// ── Invariants that must survive ────────────────────────────────────────

test('a Rising Tide owned home is charged nothing either way', () => {
  const r = resolveManagementFee({ ...base, mgmtFraction: 0, statementFee: 0 });
  near(r.fee, 0);
});

test('an all-statement range bills exactly the statements, with nothing derived', () => {
  const r = resolveManagementFee({
    segmentMonths: ['2026-07', '2026-08'],
    statementMonths: ['2026-07', '2026-08'],
    pacedMonths: [], bookedMonths: [],
    statementFee: 12_690.53, statementRevenue: 66_004.09,
    totalRevenue: 66_004.09, mgmtFraction: 0.20,
  });
  near(r.fee, 12_690.53);
  assert.equal(r.usedStatementFee, true);
});

test('the fleet case: Apr-Aug bills 194,410.44 rather than the recomputed 194,125.87', () => {
  const r = resolveManagementFee({
    segmentMonths: ['2026-04','2026-05','2026-06','2026-07','2026-08'],
    statementMonths: ['2026-04','2026-05','2026-06','2026-07','2026-08'],
    pacedMonths: [], bookedMonths: [],
    statementFee: 194_410.44, statementRevenue: 800_000, totalRevenue: 800_000, mgmtFraction: 0.25,
  });
  near(r.fee, 194_410.44);
});
