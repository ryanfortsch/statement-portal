/**
 * Parity harness for the billed-vs-owed split in src/lib/occupancy-tax.ts
 * (17 Beach bills a CIF it does not owe; Dotti 2026-09-02).
 *
 * The split must be inert on the BILLED side. `occupancyTaxMultiplier` is
 * what applyCollectedNet divides a tax-inclusive Stripe charge by, so any
 * drift there rewrites recognized rent and moves an owner payout. This
 * replays the pre-split implementation against the shipped one over every
 * fleet property across a decade of charge dates and demands an exact match.
 *
 * It then asserts the OWED side says what Dotti ruled: 79 Main, 3 South and
 * 3 Windward owe 14.7%; everyone else, 17 Beach included, owes 11.7%.
 *
 *   node scripts/cif_owed_split_parity.mjs
 *
 * Pure arithmetic. No database, no network, no keys.
 */
import {
  occupancyTaxMultiplier,
  owedOccupancyTaxRate,
  overCollectedTaxRate,
} from '../src/lib/occupancy-tax.ts';

// The implementation exactly as it shipped in #1437, before the split.
const CIF_EFFECTIVE_FROM = {
  '79_main': '1970-01-01',
  '17_beach_rd': '1970-01-01',
  '3_south_st': '1970-01-01',
  '3_windward': '1970-01-01',
};
function priorMultiplier(propertyId, chargeCreatedIso) {
  const from = CIF_EFFECTIVE_FROM[propertyId];
  const cif = from && chargeCreatedIso >= from ? 0.03 : 0;
  return 1 + 0.117 + cif;
}

const PROPERTIES = [
  '3_south_st', '21_horton', '53_rocky_neck', '53_rocky_neck_2', '4_brier_neck',
  '30_woodward', '20_hammond', '20_enon', '73_rocky_neck', '17_beach_rd',
  '3_locust', '19_rackliffe', '84_thatcher', '225_washington', '3_windward',
  '79_main', '36_granite', 'not_a_property',
];

const DATES = [];
for (let y = 2019; y <= 2028; y++) {
  for (const md of ['01-01', '03-15', '06-30', '08-02', '09-01', '09-02', '12-31']) {
    DATES.push(`${y}-${md}`);
  }
}

let checked = 0;
const drift = [];
for (const p of PROPERTIES) {
  for (const d of DATES) {
    const before = priorMultiplier(p, d);
    const after = occupancyTaxMultiplier(p, d);
    checked++;
    if (Math.abs(before - after) > 1e-12) drift.push({ p, d, before, after });
  }
}

console.log(`BILLED side: ${checked} (property, date) pairs replayed against the pre-split implementation.`);
if (drift.length) {
  console.log(`  FAIL: ${drift.length} diverged. applyCollectedNet would rewrite rent.`);
  for (const x of drift.slice(0, 20)) {
    console.log(`    ${x.p} @ ${x.d}: ${x.before} -> ${x.after}`);
  }
  process.exit(1);
}
console.log('  PASS: identical everywhere. No charge inverts differently, so no payout moves.\n');

const OWED_147 = new Set(['79_main', '3_south_st', '3_windward']);
let owedFail = 0;
console.log('OWED side (Dotti 2026-09-02):');
for (const p of PROPERTIES) {
  const owed = owedOccupancyTaxRate(p, '2026-09-02');
  const want = OWED_147.has(p) ? 0.147 : 0.117;
  const over = overCollectedTaxRate(p, '2026-09-02');
  const ok = Math.abs(owed - want) < 1e-12;
  if (!ok) owedFail++;
  if (!ok || over !== 0) {
    console.log(
      `  ${ok ? ' ' : 'X'} ${p.padEnd(17)} owes ${(owed * 100).toFixed(1)}%` +
      (over !== 0 ? `  OVER-COLLECTING ${(over * 100).toFixed(1)}%` : ''),
    );
  }
}
if (owedFail) {
  console.log(`  FAIL: ${owedFail} properties disagree with the ruling.`);
  process.exit(1);
}
console.log('  PASS: 79 Main / 3 South / 3 Windward at 14.7%, everyone else at 11.7%.');
console.log('  17 Beach is the only property whose billed rate exceeds what it owes.');
