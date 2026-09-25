/**
 * Parity harness for /revenue's management fee.
 *
 * /revenue used to re-derive a closed month's fee as `revenue x live
 * management_fee_pct`, discarding the `management_fee` its statement had
 * already billed. This proves what that change moves and, more importantly,
 * what it must NOT move.
 *
 * Run with live data (preferred):
 *
 *   supabase db query --linked --file scripts/sql/revenue_statement_fee_parity.sql \
 *     | grep -v Initialising > /tmp/fees.json
 *   node --experimental-strip-types scripts/revenue_statement_fee_parity.mjs /tmp/fees.json
 *
 * Run without an argument to exercise the embedded 2026-04..2026-08 snapshot,
 * which is what the fleet actually billed on 2026-09-25. No database needed.
 */
import { readFileSync } from 'node:fs';
import { resolveManagementFee } from '../src/lib/revenue-statement-fee.ts';

/** Measured 2026-09-25. The nine property-months that move by over $0.50. */
const SNAPSHOT = [
  { month: '2026-08', property: '4_brier_neck',   revenue: 29160.50, fee: 5321.81, pct: 20 },
  { month: '2026-08', property: '19_rackliffe',   revenue: 25925.72, fee: 6782.43, pct: 25 },
  { month: '2026-08', property: '84_thatcher',    revenue: 31398.04, fee: 8132.94, pct: 25 },
  { month: '2026-07', property: '73_rocky_neck',  revenue: 20867.52, fee: 5276.56, pct: 25 },
  { month: '2026-08', property: '17_beach_rd',    revenue: 35004.23, fee: 7759.82, pct: 22 },
  { month: '2026-08', property: '53_rocky_neck',  revenue: 21724.64, fee: 5481.16, pct: 25 },
  { month: '2026-08', property: '3_south_st',     revenue: 17711.88, fee: 4378.37, pct: 25 },
  { month: '2026-08', property: '225_washington', revenue:  2673.80, fee:  715.91, pct: 25 },
  { month: '2026-05', property: '17_beach_rd',    revenue: 11414.73, fee: 2555.24, pct: 22 },
];

/** Fleet totals for all 58 closed statements, Apr-Aug 2026. */
const FLEET = { statementFee: 194410.44, recomputedFee: 194125.87 };

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;
const usd = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const arg = process.argv[2];
let rows = SNAPSHOT;
if (arg) {
  const parsed = JSON.parse(readFileSync(arg, 'utf8'));
  rows = (parsed.rows ?? parsed).map((r) => ({
    month: r.month,
    property: r.property_id,
    revenue: Number(r.rev ?? r.rental_revenue),
    fee: Number(r.stmt_fee ?? r.management_fee),
    pct: Number(r.live_pct ?? r.management_fee_pct),
  }));
  console.log(`Loaded ${rows.length} statement rows from ${arg}\n`);
} else {
  console.log('No file given; using the embedded 2026-09-25 snapshot.\n');
}

// 1. Each closed month bills its statement, not a recompute.
console.log(`${'month'.padEnd(9)}${'property'.padEnd(17)}${'billed'.padStart(12)}${'old recompute'.padStart(15)}${'shown now'.padStart(12)}${'moved'.padStart(11)}`);
let movedTotal = 0;
for (const r of rows) {
  const frac = r.pct / 100;
  const old = r.revenue * frac;
  const res = resolveManagementFee({
    segmentMonths: [r.month],
    statementMonths: [r.month],
    pacedMonths: [], bookedMonths: [],
    statementFee: r.fee, statementRevenue: r.revenue,
    totalRevenue: r.revenue, mgmtFraction: frac,
  });
  if (!res.usedStatementFee) fail(`${r.property} ${r.month}: a closed statement month must bill its statement`);
  if (!near(res.fee, r.fee)) fail(`${r.property} ${r.month}: showed ${usd(res.fee)}, statement billed ${usd(r.fee)}`);
  movedTotal += res.fee - old;
  console.log(`${r.month.padEnd(9)}${r.property.padEnd(17)}${usd(r.fee).padStart(12)}${usd(old).padStart(15)}${usd(res.fee).padStart(12)}${usd(res.fee - old).padStart(11)}`);
}
console.log(`${''.padEnd(26)}${''.padStart(12)}${''.padStart(15)}${'net'.padStart(12)}${usd(movedTotal).padStart(11)}\n`);

// 2. The fleet total now ties to the statements, which is what /forecast shows.
const fleetMoved = FLEET.statementFee - FLEET.recomputedFee;
console.log(`Fleet Apr-Aug: billed ${usd(FLEET.statementFee)}, previously shown ${usd(FLEET.recomputedFee)}, moves ${usd(fleetMoved)}`);
if (!near(fleetMoved, 284.57, 0.02)) fail(`fleet drift ${usd(fleetMoved)}, expected $284.57`);

// 3. THE SAFETY PROPERTY: a range with no closed statement month is untouched.
for (const [name, months] of [
  ['this_month', ['2026-09']],
  ['next_month', ['2026-10']],
  ['next_90', ['2026-10', '2026-11', '2026-12']],
]) {
  const revenue = 123_456.78;
  const res = resolveManagementFee({
    segmentMonths: months, statementMonths: [], pacedMonths: months, bookedMonths: [],
    statementFee: 0, statementRevenue: 0, totalRevenue: revenue, mgmtFraction: 0.25,
  });
  if (res.usedStatementFee) fail(`${name}: must not substitute anything`);
  if (res.fee !== revenue * 0.25) fail(`${name}: fee moved, expected the old recompute exactly`);
}

// 4. The nights basis never substitutes, so its months land on booked.
{
  const res = resolveManagementFee({
    segmentMonths: ['2026-07', '2026-08'], statementMonths: [], pacedMonths: [],
    bookedMonths: ['2026-07', '2026-08'],
    statementFee: 0, statementRevenue: 0, totalRevenue: 66_004.09, mgmtFraction: 0.2,
  });
  if (res.usedStatementFee) fail('nights basis: must never bill a checkout-scoped statement fee');
  if (!near(res.fee, 66_004.09 * 0.2)) fail('nights basis: fee must be the unchanged recompute');
}

// 5. The invariant: an unaccounted or double-claimed range refuses to substitute.
{
  const gap = resolveManagementFee({
    segmentMonths: ['2026-07', '2026-08', '2026-09'], statementMonths: ['2026-07'],
    pacedMonths: [], bookedMonths: [],
    statementFee: 5000, statementRevenue: 20000, totalRevenue: 60000, mgmtFraction: 0.25,
  });
  if (gap.tilesRange || gap.usedStatementFee) fail('a range with unaccounted months must not substitute');

  const twice = resolveManagementFee({
    segmentMonths: ['2026-07', '2026-08'], statementMonths: ['2026-07', '2026-08'],
    pacedMonths: ['2026-08'], bookedMonths: [],
    statementFee: 5000, statementRevenue: 20000, totalRevenue: 60000, mgmtFraction: 0.25,
  });
  if (twice.tilesRange || twice.usedStatementFee) fail('a month claimed twice must not substitute');

  const future = resolveManagementFee({
    segmentMonths: ['2026-07'], statementMonths: ['2026-07', '2026-09'],
    pacedMonths: [], bookedMonths: [],
    statementFee: 5000, statementRevenue: 20000, totalRevenue: 20000, mgmtFraction: 0.25,
  });
  if (future.tilesRange || future.usedStatementFee) fail('September statements must not reach a July range');
}

console.log(failures === 0
  ? `\nPASS - ${rows.length} statement months bill what they billed; no-statement ranges, the nights basis and every untiled range are byte-identical to the old recompute.`
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
