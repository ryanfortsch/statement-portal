/**
 * Parity harness for the billed-vs-owed split in src/lib/occupancy-tax.ts
 * (17 Beach billed a CIF it never owed; Dotti 2026-09-02).
 *
 * The billed side must move in exactly one place and nowhere else: 17 Beach
 * on and after 2026-09-03, the day after Guesty's listing tax config was
 * switched off. `occupancyTaxMultiplier` is
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

// The ONE intended billed-side change: Guesty's 17 Beach listing stopped
// charging the CIF on 2026-09-02, so charges created from 2026-09-03 invert
// at 11.7%. Anything else that moves is a bug.
const CLOSED = { property: '17_beach_rd', from: '2026-09-03', delta: -0.03 };

let checked = 0;
const drift = [];
let intended = 0;
for (const p of PROPERTIES) {
  for (const d of DATES) {
    const before = priorMultiplier(p, d);
    const after = occupancyTaxMultiplier(p, d);
    checked++;
    const diff = after - before;
    if (Math.abs(diff) < 1e-12) continue;
    if (p === CLOSED.property && d >= CLOSED.from && Math.abs(diff - CLOSED.delta) < 1e-12) {
      intended++;
      continue;
    }
    drift.push({ p, d, before, after });
  }
}

console.log(`BILLED side: ${checked} (property, date) pairs replayed against the pre-split implementation.`);
if (drift.length) {
  console.log(`  FAIL: ${drift.length} diverged outside the closed window. applyCollectedNet would rewrite rent.`);
  for (const x of drift.slice(0, 20)) {
    console.log(`    ${x.p} @ ${x.d}: ${x.before} -> ${x.after}`);
  }
  process.exit(1);
}
console.log(`  PASS: identical everywhere except ${intended} pairs, all ${CLOSED.property} on/after ${CLOSED.from}, all exactly ${CLOSED.delta}.`);

// The boundary itself, spelled out. It is exclusive: the switch was thrown
// partway through 09-02, so that whole day still inverts at 14.7%.
const BOUNDARY = [
  ['17_beach_rd', '2026-05-27', 1.147, 'billed the CIF: hawley smith, the earliest affected folio'],
  ['17_beach_rd', '2026-09-01', 1.147, 'still billing'],
  ['17_beach_rd', '2026-09-02', 1.147, 'switch thrown mid-day; the whole day stays at 14.7%'],
  ['17_beach_rd', '2026-09-03', 1.117, 'first day the listing is clean'],
  ['17_beach_rd', '2027-07-08', 1.117, 'stays clean'],
  ['3_south_st', '2026-09-03', 1.147, 'genuinely owes it, untouched'],
  ['3_windward', '2026-09-03', 1.147, 'genuinely owes it, untouched'],
  ['79_main', '2026-09-03', 1.147, 'genuinely owes it, untouched'],
  ['20_enon', '2026-09-03', 1.117, 'never owed it'],
];
let bFail = 0;
console.log('\nBILLED boundary:');
for (const [p, d, want, why] of BOUNDARY) {
  const got = occupancyTaxMultiplier(p, d);
  const ok = Math.abs(got - want) < 1e-12;
  if (!ok) bFail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${p.padEnd(13)} ${d}  ${got.toFixed(3)}  ${why}`);
}
if (bFail) process.exit(1);
console.log('');

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

// The whole point of closing the window: from 09-03 nothing over-collects.
const stillOver = PROPERTIES.filter(p => overCollectedTaxRate(p, '2026-09-03') !== 0);
console.log('\nOver-collection after the window closes (2026-09-03):');
if (stillOver.length) {
  for (const p of stillOver) {
    console.log(`  FAIL ${p} still bills ${(overCollectedTaxRate(p, '2026-09-03') * 100).toFixed(1)}% above what it owes`);
  }
  process.exit(1);
}
console.log('  PASS: no property bills above what it owes. 17 Beach closed on 2026-09-03.');
console.log('');
console.log('NOT covered by this harness, and still live:');
console.log('  The 6 already-confirmed 17 Beach bookings whose folios were written');
console.log('  BEFORE the switch still carry a locked CIF line. A balance payment');
console.log('  collected on one of them after 2026-09-03 arrives tax-inclusive at');
console.log('  14.7% and would invert at 11.7%, handing the owner the guest\'s 3%.');
console.log('  Correct those folios in Guesty before any further money is taken.');
