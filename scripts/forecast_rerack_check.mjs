/**
 * Forecast rerack check — pure arithmetic, no database.
 *
 * Two invariants, both of which broke silently in the past:
 *
 *   1. The itemized expense rows the /forecast table renders must sum to
 *      `exp_total`. The Chase-card rows are a PROPORTIONAL SPLIT of
 *      `exp_cc_ops` against CC_BASELINE_MONTHLY, so adding a category to
 *      CC_OPERATING_BREAKDOWN without moving CC_BASELINE_MONTHLY (or
 *      changing CC_MARKETING_MONTHLY without changing the matching
 *      breakdown entry) makes the visible rows stop adding up.
 *
 *   2. The 1099 contractor line must reproduce the observed bench cost in
 *      the window it was calibrated on: $8,288/mo across 2026-07-01 to
 *      2026-08-25 ($15,248 over 56 days).
 *
 *   3. The operating-account categorizer must route the bench to
 *      Contractors and must NOT book a bounced deposit as a bank fee. The
 *      reversal reads "DEPOSITED ITEM RETURNED ... Stop Payment", which
 *      matched the 'STOP PAYMENT' fee rule and posted $1,315.60 of expense
 *      that never happened, because the credit leg is always dropped.
 *
 * Run: node --experimental-strip-types scripts/forecast_rerack_check.mjs
 */
import { categorizeOverhead } from '../src/lib/overhead-categories.ts';
import {
  calcYear,
  CC_OPERATING_BREAKDOWN,
  CC_BASELINE_MONTHLY,
  CC_MARKETING_MONTHLY,
  isMarketingActive,
} from '../src/lib/forecast-model.ts';

let failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };

/* -- invariant 1: the breakdown must sum to the baseline it splits ------ */
const bdSum = CC_OPERATING_BREAKDOWN.reduce((a, c) => a + c.monthly, 0);
if (bdSum !== CC_BASELINE_MONTHLY) {
  fail(`CC_OPERATING_BREAKDOWN sums to ${bdSum}, CC_BASELINE_MONTHLY is ${CC_BASELINE_MONTHLY}`);
}
const mktgEntry = CC_OPERATING_BREAKDOWN.find((c) => c.label === 'Marketing & advertising');
if (!mktgEntry || mktgEntry.monthly !== CC_MARKETING_MONTHLY) {
  fail(`CC_MARKETING_MONTHLY (${CC_MARKETING_MONTHLY}) != breakdown marketing entry (${mktgEntry?.monthly})`);
}

/* -- invariant 1b: rendered rows sum to exp_total, every month ---------- */
for (const [year, rolled] of [[2026, 0], [2027, 3], [2028, 6]]) {
  const r = calcYear(3, year, undefined, undefined, undefined, undefined, rolled);
  for (const m of r.monthly) {
    const mktg = isMarketingActive(year, m.month);
    const denom = mktg ? CC_BASELINE_MONTHLY : CC_BASELINE_MONTHLY - CC_MARKETING_MONTHLY;
    const split = CC_OPERATING_BREAKDOWN.reduce(
      (a, c) => a + (c.label === 'Marketing & advertising' && !mktg ? 0 : (m.exp_cc_ops * c.monthly) / denom),
      0,
    );
    const rendered =
      split + m.exp_office + m.exp_software + m.exp_bank + m.exp_contractors +
      m.exp_hire + m.exp_debt + m.exp_insurance + m.exp_accounting +
      m.exp_onboard_presigned + m.exp_onboard_new;
    if (Math.abs(rendered - m.exp_total) > 0.01) {
      fail(`${year}-${String(m.month).padStart(2, '0')} rows sum to ${rendered.toFixed(2)}, exp_total is ${m.exp_total.toFixed(2)}`);
    }
  }
}

/* -- invariant 2: contractors reproduce the calibration window ---------- */
const y26 = calcYear(3, 2026);
const OBSERVED = 8288; // $15,248 over 56 days, 2026-07-01 .. 2026-08-25
for (const mo of [7, 8]) {
  const got = y26.monthly[mo - 1].exp_contractors;
  if (Math.abs(got - OBSERVED) > 60) {
    fail(`2026-${String(mo).padStart(2, '0')} contractors ${got.toFixed(0)} is off the observed ${OBSERVED}/mo bench run rate`);
  }
}
// Nothing before the bench existed.
for (const mo of [1, 2, 3, 4, 5, 6]) {
  const got = y26.monthly[mo - 1].exp_contractors;
  if (got > 260) fail(`2026-${String(mo).padStart(2, '0')} contractors ${got.toFixed(0)} — field labor started 2026-07-07, only the misc baseline belongs here`);
}
// The salaried hire did not happen in 2026; the bench absorbed it.
const hire26 = y26.monthly.reduce((a, m) => a + m.exp_hire, 0);
if (hire26 !== 0) fail(`2026 hire total is ${hire26}, expected 0 — the $5K/mo Aug-2026 hire became the 1099 bench`);

/* -- invariant 3: operating-account categorization ---------------------- */
const CASES = [
  ['DEPOSITED ITEM RETURNED       Stop Payment   099001139', -1208.78, 'DEPOSIT_RETURN', null],
  ['STOP PAYMENT FEE', -30, 'FEE_TRANSACTION', 'Bank fees'],
  ['MONTHLY SERVICE FEE', -15, 'FEE_TRANSACTION', 'Bank fees'],
  ['Zelle payment to Delaney Jordan JPM99cu66cw3', -335, 'CHASE_TO_PARTNERFI', 'Contractors'],
  ['Online ACH payment to Cooper', -300, 'BASIC_PAYROLL', 'Contractors'],
  ['Basic Online Payroll Payment 11233513351 to #######4113', -300, 'BASIC_PAYROLL', 'Contractors'],
  ['Online Payment 30369420022 To Nicole Whitten 08/11', -2400, 'BILLPAY', 'Contractors'],
  ['ORIG CO NAME:GUSTO ORIG ID:9138864007 CO ENTRY DESCR:FEE', -68, 'MISC_DEBIT', 'Payroll'],
  ['Online ACH Payment 11231667481 To Landlordfor85EasternAve', -750, 'ACH_PAYMENT', 'Rent & office'],
  ['ORIG CO NAME:PHILLIPS INSURAN', -5263.92, 'ACH_DEBIT', 'Insurance'],
  ['Payment to Chase card ending in 3878', -8000, 'LOAN_PMT', null],
];
for (const [description, amount, type, want] of CASES) {
  const got = categorizeOverhead({ account: 'operating', description, amount, type });
  if (got !== want) fail(`categorizeOverhead -> ${String(got)}, expected ${String(want)}: "${description.slice(0, 50)}"`);
}

console.log(failures === 0
  ? 'PASS — expense rows sum to exp_total across 2026/2027/2028, the contractor line reproduces the observed $8,288/mo bench, and the operating categorizer routes all 11 reference rows correctly.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
