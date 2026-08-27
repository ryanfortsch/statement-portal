#!/usr/bin/env node
/**
 * Installment stay-span guard parity harness.
 *
 * READ-ONLY, no database, no network. Pure arithmetic proof for the guard
 * added to the synthetic-injection loop in src/app/api/ingest/route.ts.
 *
 * Background
 *   /api/ingest synthesizes a reservation row for any reservation_installments
 *   slice whose confirmation_code is absent from the month's Guesty PDF. That
 *   is correct for a genuine cross-month split (the booking checks out later,
 *   so Guesty would not list it). It is WRONG when the slice's month falls
 *   outside the booking's own stay span: such a row is not a split at all but
 *   money carried into a month the stay never touched, which the operator has
 *   already recognized through the extras/add-on queue. Injecting it adds
 *   rental revenue on top of that attribution and overpays the owner.
 *
 *   The live instance: BC-KRGADJgnl (Ed Brooke, 73 Rocky Neck), a Booking.com
 *   stay 2026-06-24 -> 2026-06-28 carrying a single 2026-07 slice of $238.70.
 *   The same $238.70 is already on the July statement as an attributed add-on
 *   (bank_deposit_attributions 72740438..., dedupe_key
 *   stripe:pi_3Tmw7dLdORfwZEL00EPFkuHJ).
 *
 * The guard
 *   Inject only when [month_start, month_end) overlaps [check_in, check_out).
 *   Otherwise skip and raise an `installment_outside_stay_span` data gap.
 *   Note the guard is deliberately NOT keyed on the attribution rows: an
 *   add-on is attributed to whichever stay anchors it in the month
 *   (HMD8RN3ZZS here), a different code than the installment's, so a code
 *   match would miss this exact case.
 *
 * What this proves
 *   1. SAFETY (the one that matters): the guard is a no-op on every genuine
 *      split on file. All 5 slices across GY-qqVPackv and GY-fCdhbUYC still
 *      inject, so no statement and no owner payout moves by a cent.
 *   2. CORRECTNESS: the guard catches the malformed BC-KRGADJgnl slice.
 *   3. The July 2026 / 73 Rocky Neck statement is reproduced to the cent as
 *      sent, and the size of the averted double-count is shown as a signed
 *      delta.
 *   4. Deleting the installment row and relying on the guard produce the
 *      identical statement, so the data fix and the code fix agree.
 *
 * Run: node scripts/installment_span_parity.mjs
 * Exit 0 = parity holds. Exit 1 = a case diverged.
 */

const round2 = (n) => Math.round(n * 100) / 100;

let failures = 0;
let checked = 0;
const fail = (msg) => { console.error(`  FAIL: ${msg}`); failures++; };

// ---- the guard, mirrored from /api/ingest --------------------------------

/** Exclusive end date of a YYYY-MM month, as YYYY-MM-DD. */
function monthEndExclusive(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/** True when the slice month overlaps the booking's [check_in, check_out). */
function overlapsStay(month, checkIn, checkOut) {
  return `${month}-01` < checkOut && monthEndExclusive(month) > checkIn;
}

// ---- fixtures: every reservation_installments row on file ----------------
// Captured from prod 2026-08-27. 6 rows across 3 bookings.

const INSTALLMENTS = [
  // Genuine split: 17 Beach, Jun 27 -> Aug 1. Slices tie to $62,464.40.
  { code: 'GY-qqVPackv', prop: '17_beach_rd',   month: '2026-06', rev: 7138.81,  checkIn: '2026-06-27', checkOut: '2026-08-01', genuine: true },
  { code: 'GY-qqVPackv', prop: '17_beach_rd',   month: '2026-07', rev: 55325.59, checkIn: '2026-06-27', checkOut: '2026-08-01', genuine: true },
  // Genuine split: 3 South, Jun 22 -> Aug 6. Slices tie to $30,271.40.
  { code: 'GY-fCdhbUYC', prop: '3_south_st',    month: '2026-06', rev: 6054.28,  checkIn: '2026-06-22', checkOut: '2026-08-06', genuine: true },
  { code: 'GY-fCdhbUYC', prop: '3_south_st',    month: '2026-07', rev: 20853.63, checkIn: '2026-06-22', checkOut: '2026-08-06', genuine: true },
  // Not yet ingested (August is open) -- a CORRECT pending injection the
  // guard must not disturb.
  { code: 'GY-fCdhbUYC', prop: '3_south_st',    month: '2026-08', rev: 3363.49,  checkIn: '2026-06-22', checkOut: '2026-08-06', genuine: true },
  // Malformed: a July slice on a stay that ended June 28.
  { code: 'BC-KRGADJgnl', prop: '73_rocky_neck', month: '2026-07', rev: 238.70,  checkIn: '2026-06-24', checkOut: '2026-06-28', genuine: false },
];

console.log('1. SAFETY: the guard is a no-op on every genuine split on file');
console.log('='.repeat(70));
for (const i of INSTALLMENTS.filter((x) => x.genuine)) {
  checked++;
  const injects = overlapsStay(i.month, i.checkIn, i.checkOut);
  if (!injects) fail(`genuine slice ${i.code}|${i.month} would be SKIPPED -- the guard drops real owner revenue`);
  console.log(`  ${(i.code + '|' + i.month).padEnd(24)} $${String(i.rev).padStart(9)}  stay ${i.checkIn}..${i.checkOut}  -> ${injects ? 'injects (unchanged)' : 'SKIPPED'}`);
}

console.log('\n2. CORRECTNESS: the guard catches the malformed slice');
console.log('='.repeat(70));
for (const i of INSTALLMENTS.filter((x) => !x.genuine)) {
  checked++;
  const injects = overlapsStay(i.month, i.checkIn, i.checkOut);
  if (injects) fail(`malformed slice ${i.code}|${i.month} still injects -- double-count not averted`);
  console.log(`  ${(i.code + '|' + i.month).padEnd(24)} $${String(i.rev).padStart(9)}  stay ${i.checkIn}..${i.checkOut}  -> ${injects ? 'INJECTS' : 'skipped + gap raised'}`);
}

// ---- 3. The July 2026 / 73 Rocky Neck statement --------------------------
// Canonical formula, src/lib/statement-addons.ts.

function statement({ rentalRevenue, addOnsRevenue, addOnsMgmtBase, feePct, cleaning, repairs, attributedDebits, reserve }) {
  const feeBase = round2(rentalRevenue + addOnsMgmtBase);
  const fee = round2(feeBase * (feePct / 100));
  const payout = round2(rentalRevenue + addOnsRevenue - fee - cleaning - repairs - attributedDebits - reserve);
  return { feeBase, fee, payout };
}

// The three real July reservations for 73_rocky_neck.
const JULY_RESERVATIONS = 3074.11 + 14982.10 + 2811.32; // 20,867.53
const JULY_BASE = {
  addOnsRevenue: 238.70,     // Ed Brooke extension, attributed add-on
  addOnsMgmtBase: 238.70,    // apply_mgmt_fee = true
  feePct: 25,
  cleaning: 924.80,
  repairs: 0,
  attributedDebits: 112.50,  // maintenance
  reserve: 0,
};

// What the owner was actually sent on 2026-08-02.
const AS_SENT = { rentalRevenue: 20867.53, mgmtFee: 5276.56, payout: 14792.37, nights: 30, stays: 3 };

console.log('\n3. The July 2026 / 73 Rocky Neck statement, as sent');
console.log('='.repeat(70));
{
  checked++;
  const guarded = statement({ rentalRevenue: round2(JULY_RESERVATIONS), ...JULY_BASE });
  if (round2(JULY_RESERVATIONS) !== AS_SENT.rentalRevenue) fail(`rental_revenue ${JULY_RESERVATIONS} != stored ${AS_SENT.rentalRevenue}`);
  if (guarded.fee !== AS_SENT.mgmtFee) fail(`management_fee ${guarded.fee} != stored ${AS_SENT.mgmtFee}`);
  if (guarded.payout !== AS_SENT.payout) fail(`owner_payout ${guarded.payout} != stored ${AS_SENT.payout}`);
  console.log(`  rental_revenue   ${round2(JULY_RESERVATIONS)}  (3 reservations, no synthetic row)`);
  console.log(`  fee_base         ${guarded.feeBase}  = rental + add-on mgmt base`);
  console.log(`  management_fee   ${guarded.fee}  <- matches stored ${AS_SENT.mgmtFee}`);
  console.log(`  owner_payout     ${guarded.payout}  <- matches stored ${AS_SENT.payout}`);
}

console.log('\n4. What an UNGUARDED re-ingest would have paid');
console.log('='.repeat(70));
{
  checked++;
  // Booking.com is not a Stripe channel, so the synthetic row carries a $0 fee.
  const injected = round2(JULY_RESERVATIONS + 238.70);
  const unguarded = statement({ rentalRevenue: injected, ...JULY_BASE });
  const dRev = round2(unguarded.feeBase - statement({ rentalRevenue: round2(JULY_RESERVATIONS), ...JULY_BASE }).feeBase);
  const dFee = round2(unguarded.fee - AS_SENT.mgmtFee);
  const dPay = round2(unguarded.payout - AS_SENT.payout);
  if (dPay <= 0) fail('expected the unguarded path to overpay the owner');
  if (dPay !== 179.03) fail(`expected the overpay to be 179.03, got ${dPay}`);
  console.log(`  rental_revenue   ${AS_SENT.rentalRevenue} -> ${injected}  (+${round2(injected - AS_SENT.rentalRevenue)}, synthetic BC-KRGADJgnl)`);
  console.log(`  fee_base         +${dRev}`);
  console.log(`  management_fee   ${AS_SENT.mgmtFee} -> ${unguarded.fee}  (+${dFee})`);
  console.log(`  owner_payout     ${AS_SENT.payout} -> ${unguarded.payout}  (+${dPay}, owner OVERPAID)`);
  console.log(`  nights_booked    ${AS_SENT.nights} -> ${AS_SENT.nights + 1}  (June already counted that night)`);
  console.log(`  num_stays        ${AS_SENT.stays} -> ${AS_SENT.stays}  (unchanged: checkout month filter holds)`);
}

console.log('\n5. Data fix and code fix agree');
console.log('='.repeat(70));
{
  checked++;
  // (a) row deleted: nothing to inject at all.
  const deleted = statement({ rentalRevenue: round2(JULY_RESERVATIONS), ...JULY_BASE });
  // (b) row present, guard active: injection skipped.
  const remaining = INSTALLMENTS.filter((i) => i.prop === '73_rocky_neck' && i.month === '2026-07')
    .filter((i) => overlapsStay(i.month, i.checkIn, i.checkOut))
    .reduce((s, i) => s + i.rev, 0);
  const guarded = statement({ rentalRevenue: round2(JULY_RESERVATIONS + remaining), ...JULY_BASE });
  if (deleted.payout !== guarded.payout || deleted.fee !== guarded.fee) {
    fail(`delete (${deleted.payout}) and guard (${guarded.payout}) disagree`);
  }
  if (guarded.payout !== AS_SENT.payout) fail(`guarded payout ${guarded.payout} != as-sent ${AS_SENT.payout}`);
  console.log(`  row deleted      payout ${deleted.payout}`);
  console.log(`  guard active     payout ${guarded.payout}  (injected $${round2(remaining)} of slices)`);
  console.log(`  as sent          payout ${AS_SENT.payout}  -> all three agree`);
}

console.log(`\n${'='.repeat(70)}`);
if (failures === 0) {
  console.log(`PARITY HOLDS. ${checked} cases checked, 0 divergences.`);
  console.log('No statement on file moves by a cent; the averted overpay is $179.03.');
  process.exit(0);
} else {
  console.log(`PARITY BROKEN: ${failures} divergence(s) across ${checked} cases.`);
  process.exit(1);
}
