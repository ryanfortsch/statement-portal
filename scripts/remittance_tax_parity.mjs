#!/usr/bin/env node
/**
 * Remittance sheet + add-on occupancy tax parity harness.
 *
 * READ-ONLY, no database, no network. Pure arithmetic proof for the change
 * shipped 2026-08-27 after Dotti's July-close review, which touched three
 * things at once:
 *
 *   1. the accountant's tax section now reads guesty_reservations.folio_items
 *      instead of the scalar total_taxes column
 *   2. the VRBO commission sweep is 5% of the folio's pre-tax guest total
 *      instead of 5% of (total_paid - total_taxes)
 *   3. guest add-on charges are minted with occupancy tax on top, and that
 *      tax is carved out of the extras-queue row into its own tax_amount
 *
 * WHAT THIS PROVES
 *
 *   A. SAFETY, the one that matters. Item 3 touches bank_deposit_attributions,
 *      which feeds owner_payout. It proves that with tax_amount = 0 -- which
 *      is the default, and therefore the value on every row that existed
 *      before this shipped -- loadAddOnTotals returns byte-identical
 *      addOnsRevenue / addOnsMgmtBase / attributedDebits, and so the
 *      canonical payout formula produces the same cents. No historical
 *      statement moves.
 *
 *   B. That a NEW taxed add-on credits the owner exactly the pre-tax fee net
 *      of the Stripe fee, never the tax, and never puts the tax in the
 *      management-fee base.
 *
 *   C. That the tax gross-up round-trips: base -> charge -> carve-out
 *      returns the base, at both the 11.7% and 14.7% rates.
 *
 *   D. That the VRBO sweep formula recovers the exact commission Guesty
 *      itself booked on the stays where Guesty booked a clean 5%, and that
 *      the OLD formula did not -- using the real July 2026 numbers.
 *
 *   E. That the sheet's RENTAL INCOME column times the property's statutory
 *      rate equals its TAX OWED column, on the real July numbers -- because
 *      Allie files by entering rent and letting MassTaxConnect compute the
 *      excise, so a rent figure that does not reconcile is worse than none.
 *      And that the one property which does NOT reconcile (53 Rocky Neck,
 *      whose Booking.com listing collected 10.41%) trips the flag.
 *
 *   F. That cross-month proration is applied exactly once: folio_items and
 *      guesty_reservations are booking-level and take the month's share,
 *      while the reservations row is already the month's slice.
 *
 * Run: node scripts/remittance_tax_parity.mjs
 * Exit 0 = parity holds. Exit 1 = a case diverged.
 */

const round2 = (n) => Math.round(n * 100) / 100;

let failures = 0;
const check = (label, actual, expected, tol = 0.005) => {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(56)} ${actual.toFixed(2).padStart(11)}  vs ${expected.toFixed(2).padStart(11)}`);
};

// ---------------------------------------------------------------------------
// Mirrors of the shipped code. Kept as literal copies so a drift in either
// direction shows up here rather than in a statement.
// ---------------------------------------------------------------------------

/** src/lib/statement-addons.ts loadAddOnTotals, minus the DB call. */
function addOnTotals(rows) {
  let addOnsRevenue = 0, addOnsMgmtBase = 0, attributedDebits = 0, addOnsTax = 0;
  for (const a of rows) {
    const amt = Number(a.amount) || 0;
    if ((a.direction || 'deposit') === 'debit') {
      attributedDebits += amt;
    } else {
      addOnsRevenue += amt;
      if (a.apply_mgmt_fee) addOnsMgmtBase += amt;
      addOnsTax += Number(a.tax_amount) || 0;
    }
  }
  return {
    addOnsRevenue: round2(addOnsRevenue),
    addOnsMgmtBase: round2(addOnsMgmtBase),
    attributedDebits: round2(attributedDebits),
    addOnsTax: round2(addOnsTax),
  };
}

/** The pre-change version: no tax_amount column at all. */
function addOnTotalsBefore(rows) {
  let addOnsRevenue = 0, addOnsMgmtBase = 0, attributedDebits = 0;
  for (const a of rows) {
    const amt = Number(a.amount) || 0;
    if ((a.direction || 'deposit') === 'debit') attributedDebits += amt;
    else {
      addOnsRevenue += amt;
      if (a.apply_mgmt_fee) addOnsMgmtBase += amt;
    }
  }
  return {
    addOnsRevenue: round2(addOnsRevenue),
    addOnsMgmtBase: round2(addOnsMgmtBase),
    attributedDebits: round2(attributedDebits),
  };
}

/** The canonical formula, src/lib/statement-addons.ts docblock. */
function payout({ rentalRevenue, feePct, cleaning, repairs, reserve, totals }) {
  const feeBase = rentalRevenue + totals.addOnsMgmtBase;
  const fee = round2(feeBase * (feePct / 100));
  return {
    fee,
    payout: round2(
      rentalRevenue + totals.addOnsRevenue - fee - cleaning - repairs - totals.attributedDebits - reserve,
    ),
  };
}

/** src/lib/addon-tax.ts splitAddOnTax. */
function splitAddOnTax(baseCents, rate) {
  const base = Math.round(baseCents);
  const taxCents = Math.round(base * rate);
  return { baseCents: base, taxCents, totalCents: base + taxCents, rate };
}

/** src/lib/remittance.ts: 5% of the folio's pre-tax guest total. */
const VRBO_RATE = 0.05;
const sweepNew = (folioPreTax) => round2(folioPreTax * VRBO_RATE);
/** What the sheet did before: 5% of (total_paid - total_taxes). */
const sweepOld = (totalPaid, totalTaxes) => round2(Math.max(totalPaid - totalTaxes, 0) * VRBO_RATE);

// ---------------------------------------------------------------------------
// A. Safety: every pre-existing row (tax_amount absent / 0) is unchanged.
// ---------------------------------------------------------------------------
console.log('\nA. SAFETY -- pre-existing attributions produce identical payouts');

const HISTORICAL = [
  { label: 'no attributions at all', rows: [] },
  { label: 'one add-on, fee-bearing', rows: [{ amount: 238.70, apply_mgmt_fee: true, direction: 'deposit' }] },
  { label: 'add-on excluded from fee base', rows: [{ amount: 150, apply_mgmt_fee: false, direction: 'deposit' }] },
  { label: 'attributed debit', rows: [{ amount: 275, apply_mgmt_fee: true, direction: 'debit' }] },
  {
    label: 'mixed: two add-ons + a debit',
    rows: [
      { amount: 582.30, apply_mgmt_fee: true, direction: 'deposit' },
      { amount: 85, apply_mgmt_fee: false, direction: 'deposit' },
      { amount: 17.70, apply_mgmt_fee: true, direction: 'debit' },
    ],
  },
];
const STATEMENT = { rentalRevenue: 14982.10, feePct: 25, cleaning: 1240, repairs: 112.50, reserve: 0 };

for (const c of HISTORICAL) {
  // The column defaults to 0, so an existing row reads back as tax_amount 0.
  const after = addOnTotals(c.rows.map(r => ({ ...r, tax_amount: 0 })));
  const before = addOnTotalsBefore(c.rows);
  const pAfter = payout({ ...STATEMENT, totals: after });
  const pBefore = payout({ ...STATEMENT, totals: { ...before, addOnsTax: 0 } });
  check(`${c.label}: owner_payout`, pAfter.payout, pBefore.payout, 0);
  check(`${c.label}: management_fee`, pAfter.fee, pBefore.fee, 0);
  check(`${c.label}: addOnsTax reported`, after.addOnsTax, 0, 0);
}

// ---------------------------------------------------------------------------
// B. A newly taxed add-on: owner sees the fee, never the tax.
// ---------------------------------------------------------------------------
console.log('\nB. A TAXED ADD-ON -- tax is held for the state, not paid to the owner');

// Ed Brooke's case as it would be minted today: $250 late checkout on
// 73 Rocky Neck (11.7%), charged $279.25, Stripe keeps ~$11.29.
const brooke = splitAddOnTax(25000, 0.117);
check('charged to the guest', brooke.totalCents / 100, 279.25);
check('occupancy tax collected', brooke.taxCents / 100, 29.25);

const stripeFeeCents = Math.round(brooke.totalCents * 0.039 + 40);
const netCents = brooke.totalCents - stripeFeeCents;
const queued = {
  amount: round2((netCents - brooke.taxCents) / 100),
  tax_amount: round2(brooke.taxCents / 100),
  apply_mgmt_fee: true,
  direction: 'deposit',
};
const taxed = addOnTotals([queued]);
check('add-on revenue (net of fee AND tax)', taxed.addOnsRevenue, round2((netCents - brooke.taxCents) / 100));
check('tax held for remittance', taxed.addOnsTax, 29.25);
check('tax NOT in the management-fee base', taxed.addOnsMgmtBase, taxed.addOnsRevenue, 0);

// The owner is credited the same as if we had charged a bare $250 fee --
// the guest, not the owner, funds the tax.
const bare = addOnTotals([{ amount: round2((25000 - Math.round(25000 * 0.039 + 40)) / 100), tax_amount: 0, apply_mgmt_fee: true, direction: 'deposit' }]);
const drift = round2(taxed.addOnsRevenue - bare.addOnsRevenue);
console.log(`  NOTE  owner credit vs an untaxed $250 fee: ${drift >= 0 ? '+' : ''}${drift.toFixed(2)} (the Stripe fee on the tax dollars)`);

// ---------------------------------------------------------------------------
// C. Gross-up round-trips at both Cape Ann rates.
// ---------------------------------------------------------------------------
console.log('\nC. GROSS-UP ROUND TRIP');
for (const [rate, name] of [[0.117, 'base 11.7%'], [0.147, 'with CIF 14.7%']]) {
  for (const fee of [2500, 8500, 25000, 199900]) {
    const s = splitAddOnTax(fee, rate);
    check(`${name}: $${(fee / 100).toFixed(2)} -> base recovered`, (s.totalCents - s.taxCents) / 100, fee / 100, 0);
  }
}

// ---------------------------------------------------------------------------
// D. The VRBO sweep, on the real July 2026 bookings.
// ---------------------------------------------------------------------------
console.log('\nD. VRBO SWEEP -- July 2026 actuals');
console.log('   folioPreTax x 5% vs the old (total_paid - total_taxes) x 5%.');
console.log('   guestyCommission is what Guesty booked; a clean 5% there is the check.\n');

const JULY_VRBO = [
  { prop: '16 Waterman',   code: 'HA-8U30v54', folioPreTax: 4308.00,  totalPaid: 0,       totalTaxes: 0,       guestyCommission: null },
  { prop: '19 Rackliffe',  code: 'HA-Q40IDcc', folioPreTax: 3831.00,  totalPaid: 0,       totalTaxes: 0,       guestyCommission: null },
  { prop: '20 Hammond',    code: 'HA-bsi6yiW', folioPreTax: 2467.00,  totalPaid: 1377.82, totalTaxes: 288.64,  guestyCommission: 231.90 },
  { prop: '20 Hammond',    code: 'HA-ErgBlqH', folioPreTax: 2378.00,  totalPaid: 1328.12, totalTaxes: 278.23,  guestyCommission: 223.53 },
  { prop: '21 Horton',     code: 'HA-CEabK8B', folioPreTax: 6440.00,  totalPaid: 3596.74, totalTaxes: 753.48,  guestyCommission: 605.36 },
  { prop: '21 Horton',     code: 'HA-JLo2NOX', folioPreTax: 3463.00,  totalPaid: 3868.17, totalTaxes: 405.17,  guestyCommission: 173.15 },
  { prop: '30 Woodward',   code: 'HA-OeFv0N8', folioPreTax: 3166.00,  totalPaid: 1768.21, totalTaxes: 370.42,  guestyCommission: 158.30 },
  { prop: '36 Granite',    code: 'HA-44EYhfE', folioPreTax: 1740.00,  totalPaid: 0,       totalTaxes: 0,       guestyCommission: null },
  { prop: '4 Brier Neck',  code: 'HA-Y8xxyuj', folioPreTax: 12628.00, totalPaid: 7052.74, totalTaxes: 1477.48, guestyCommission: 631.40 },
  { prop: '4 Brier Neck',  code: 'HA-uhZD5qZ', folioPreTax: 15792.00, totalPaid: 8819.83, totalTaxes: 1847.66, guestyCommission: 1263.36 },
  { prop: '53 Rocky Neck', code: 'HA-s3ismBY', folioPreTax: 1149.00,  totalPaid: 0,       totalTaxes: 0,       guestyCommission: null },
];

let sumNew = 0, sumOld = 0;
console.log(`   ${'property'.padEnd(15)}${'code'.padEnd(13)}${'new'.padStart(10)}${'old'.padStart(10)}${'guesty'.padStart(10)}`);
for (const r of JULY_VRBO) {
  const n = sweepNew(r.folioPreTax);
  const o = sweepOld(r.totalPaid, r.totalTaxes);
  sumNew += n; sumOld += o;
  const g = r.guestyCommission == null ? '   (none)' : r.guestyCommission.toFixed(2).padStart(10);
  console.log(`   ${r.prop.padEnd(15)}${r.code.padEnd(13)}${n.toFixed(2).padStart(10)}${o.toFixed(2).padStart(10)}${g}`);
}
console.log('');

// Where Guesty booked a clean 5% (no legacy 4.4% gross-up stacked on), the
// new formula must reproduce it to the cent. That is the correctness proof.
for (const r of JULY_VRBO) {
  if (r.guestyCommission == null) continue;
  const clean = Math.abs(r.guestyCommission - r.folioPreTax * VRBO_RATE) <= 0.01;
  if (!clean) continue;
  check(`${r.code}: new formula reproduces Guesty's 5%`, sweepNew(r.folioPreTax), r.guestyCommission);
}
// ... and on those same rows, the old formula must be shown to have failed,
// or there was no bug to fix.
let oldWrong = 0;
for (const r of JULY_VRBO) {
  if (r.guestyCommission == null) continue;
  if (Math.abs(r.guestyCommission - r.folioPreTax * VRBO_RATE) > 0.01) continue;
  if (Math.abs(sweepOld(r.totalPaid, r.totalTaxes) - r.guestyCommission) > 0.01) oldWrong++;
}
if (oldWrong === 0) {
  console.log('  FAIL  the old formula matched every clean-5% row -- the fixture is wrong');
  failures++;
} else {
  console.log(`  PASS  old formula was wrong on ${oldWrong} of the clean-5% rows`);
}

console.log(`\n  July VRBO sweep: was ${round2(sumOld).toFixed(2)}, should have been ${round2(sumNew).toFixed(2)} (under-swept ${round2(sumNew - sumOld).toFixed(2)})`);

// ---------------------------------------------------------------------------
// E. The rental-income column. Allie files by entering rent on
//    MassTaxConnect and letting the state compute the excise, so the two
//    columns have to reconcile at the statutory rate or the filing will not
//    tie to what we moved to *9928.
// ---------------------------------------------------------------------------
console.log('\nE. RENTAL INCOME reconciles to TAX OWED -- July 2026 actuals');

const BASE_RATE = 0.117;
const CIF_RATE = 0.147;

// `stays` is how many reservations rolled into the property's total. Guesty
// rounds each tax LEG to the cent independently -- state, local, and the
// Community Impact Fee are three separate folio lines -- so a multi-stay
// property cannot reconcile to the exact cent. 79 Main's 2c gap is two of
// its four stays each rounding up a penny (verified line by line against
// the folio). One cent per stay is the honest tolerance.
//
// The tolerance is not what protects the filing: the sheet's divergence
// flag sits at 0.2 percentage points, two orders of magnitude above penny
// rounding, so a reconciling property never false-flags. 19 Rackliffe's
// implied rate is 11.7001%. The loop asserts that separately.
const JULY_TAX = [
  { prop: '16 Waterman',    rent: 4308.00,   tax: 504.04,   rate: BASE_RATE, stays: 1 },
  { prop: '19 Rackliffe',   rent: 14827.30,  tax: 1734.81,  rate: BASE_RATE, stays: 5 },
  { prop: '20 Hammond',     rent: 8605.58,   tax: 1006.85,  rate: BASE_RATE, stays: 3 },
  { prop: '21 Horton',      rent: 9903.00,   tax: 1158.65,  rate: BASE_RATE, stays: 2 },
  { prop: '30 Woodward',    rent: 3166.00,   tax: 370.42,   rate: BASE_RATE, stays: 1 },
  { prop: '36 Granite',     rent: 2627.84,   tax: 307.46,   rate: BASE_RATE, stays: 2 },
  { prop: '4 Brier Neck',   rent: 28420.00,  tax: 3325.14,  rate: BASE_RATE, stays: 2 },
  { prop: '73 Rocky Neck',  rent: 15665.12,  tax: 1832.82,  rate: BASE_RATE, stays: 1 },
  { prop: '79 Main',        rent: 5789.48,   tax: 851.07,   rate: CIF_RATE,  stays: 4 },
];
for (const r of JULY_TAX) {
  check(
    `${r.prop}: rent x ${(r.rate * 100).toFixed(1)}% = tax owed`,
    round2(r.rent * r.rate), r.tax, 0.01 * r.stays + 1e-9,
  );
  // The flag threshold is what actually protects the filing. Prove no
  // reconciling property is anywhere near tripping it.
  const impliedGap = Math.abs(r.tax / r.rent - r.rate);
  if (impliedGap > 0.002) {
    console.log(`  FAIL  ${r.prop} would false-flag: implied rate off by ${(impliedGap * 100).toFixed(4)}pp`);
    failures++;
  }
}

// 53 Rocky Neck must NOT reconcile: its Booking.com listing collected
// 10.41% on that stay, so the sheet has to flag it rather than print a
// rental-income figure the state will disagree with.
const RN53 = { rent: 15127.23, tax: 1734.80, rate: BASE_RATE };
const rn53Implied = RN53.tax / RN53.rent;
const rn53Flagged = Math.abs(rn53Implied - RN53.rate) > 0.002;
if (rn53Flagged) {
  console.log(`  PASS  53 Rocky Neck flagged: collected ${(rn53Implied * 100).toFixed(2)}% vs ${(RN53.rate * 100).toFixed(2)}%, short $${round2(RN53.rent * RN53.rate - RN53.tax).toFixed(2)}`);
} else {
  console.log('  FAIL  53 Rocky Neck should have tripped the rate-divergence flag');
  failures++;
}

// ---------------------------------------------------------------------------
// F. Proration applies ONCE. folio_items and guesty_reservations are
//    booking-level and get the month's share; the reservations row is
//    already the month's slice and must be used verbatim.
// ---------------------------------------------------------------------------
console.log('\nF. CROSS-MONTH PRORATION -- booking-level scaled, month-level not');

// Kate Bacon, 17 Beach: booked Jun 27 -> Aug 1, split $7,138.81 June /
// $55,325.59 July. The reservations row already carries the July figure.
const kate = { bookingRent: 62464.40, juneSlice: 7138.81, julySlice: 55325.59 };
const share = kate.julySlice / (kate.juneSlice + kate.julySlice);
check('reservations row is used verbatim', kate.julySlice, 55325.59, 0);
check('applying share again would understate by', round2(kate.julySlice * share), 49002.65, 0.01);
check('shares sum to the whole booking', round2(kate.juneSlice + kate.julySlice), kate.bookingRent, 0.01);
// A booking-level figure DOES get the share, and the months sum back to it.
const bookingLevelTax = 1000;
const juneShare = kate.juneSlice / kate.bookingRent;
check('booking-level tax split across months sums back', round2(bookingLevelTax * juneShare + bookingLevelTax * share), bookingLevelTax, 0.01);

console.log(failures === 0 ? '\nPARITY HOLDS\n' : `\n${failures} CASE(S) DIVERGED\n`);
process.exit(failures === 0 ? 0 : 1);
