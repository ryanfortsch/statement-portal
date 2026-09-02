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
import {
  categorizeOverhead,
  dropSupersededCardProxy,
  cardCompleteMonths,
  resolveCardSpendSource,
  CARD_PROXY_CATEGORY,
} from '../src/lib/overhead-categories.ts';
import { calcYear, CC_OPERATING_BREAKDOWN, CC_SUPPLY_SEASON } from '../src/lib/forecast-model.ts';

let failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };

/* -- invariant 1: the seasonal curve is a curve ---------------------------- */
{
  const sum = CC_SUPPLY_SEASON.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) fail(`CC_SUPPLY_SEASON sums to ${sum}, must be 1`);
  if (CC_SUPPLY_SEASON.length !== 12) fail('CC_SUPPLY_SEASON must have twelve entries');
  if (CC_SUPPLY_SEASON.some((v) => v <= 0)) fail('every month must carry some supply spend');
  // Peak leads the revenue peak: supplies are bought before the guests arrive.
  const peak = CC_SUPPLY_SEASON.indexOf(Math.max(...CC_SUPPLY_SEASON));
  if (peak !== 5 && peak !== 6) fail(`supply peak lands in month ${peak + 1}, expected June or July`);
}

/* -- invariant 1b: rendered rows sum to exp_total, every month ---------- */
for (const [year, rolled] of [[2026, 0], [2027, 3], [2028, 6]]) {
  const r = calcYear(3, year, undefined, undefined, undefined, undefined, rolled);
  for (const m of r.monthly) {
    const denom = CC_OPERATING_BREAKDOWN.reduce((a, c) => a + c.monthly, 0);
    const split = CC_OPERATING_BREAKDOWN.reduce((a, c) => a + (m.exp_cc_ops * c.monthly) / denom, 0);
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
// numNew = 0: the bench was measured against the REAL fleet, so the slider's
// hypothetical additions must not be in the denominator.
const y26 = calcYear(0, 2026);
const OBSERVED = 8288; // $15,248 over 56 days, 2026-07-01 .. 2026-08-25
// Asserted as the pair's mean, not per month: the calibration window spans a
// fleet that went 15 properties in July to 17 in August, so the two months
// legitimately differ while their average is what was measured.
{
  const pair = (y26.monthly[6].exp_contractors + y26.monthly[7].exp_contractors) / 2;
  if (Math.abs(pair - OBSERVED) > 120) {
    fail(`Jul/Aug contractor mean ${pair.toFixed(0)} is off the observed ${OBSERVED}/mo bench run rate`);
  }
  if (y26.monthly[7].exp_contractors <= y26.monthly[6].exp_contractors) {
    fail('August should carry more contractor cost than July: two more properties');
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
  ['Payment to Chase card ending in 3878', -8000, 'LOAN_PMT', 'Card payment'],
  ['ORIG CO NAME:CHASE CREDIT CRD ... CO ENTRY DESCR:AUTOPAYBUS', -40, 'ACH_DEBIT', 'Card payment'],
  ['Online Transfer to CHK ...1323 transaction#: 30250485778', -5000, 'ACCT_XFER', null],
];

/* -- a netted channel commission is never overhead ------------------------ */
// VRBO bills the card and the same fee is already deducted from rental
// revenue before a statement sees it. Counting it as an expense charges the
// same fee twice. Furnished Finder is the opposite: a flat subscription
// nothing nets back, so it stays a real listing-platform cost.
const CARD_CASES = [
  ['Vrbo', -3554.30, 'Pass-through'],
  ['VRBO *HOMEAWAY', -710.15, 'Pass-through'],
  ['EXPEDIA GROUP', -120.00, 'Pass-through'],
  ['FURNISHED FINDER', -199.00, 'Listing platforms'],
  ['SP FIX LINENS', -4031.30, 'Guest supplies'],
  ['GUESTY', -1200.00, 'Software'],
];
for (const [description, amount, want] of CARD_CASES) {
  const got = categorizeOverhead({ account: 'card', description, amount, chaseCategory: 'Professional Services' });
  if (got !== want) fail(`card "${description}" -> ${String(got)}, expected ${want}`);
}

for (const [description, amount, type, want] of CASES) {
  const got = categorizeOverhead({ account: 'operating', description, amount, type });
  if (got !== want) fail(`categorizeOverhead -> ${String(got)}, expected ${String(want)}: "${description.slice(0, 50)}"`);
}

/* -- invariant 4: the card proxy never double-counts --------------------- */
const PROXY_ROWS = [
  // 2026-05 has real card detail, so its payoff proxy must be dropped.
  { month: '2026-05', account: 'card', category: 'Software', amount: 2314 },
  { month: '2026-05', account: 'operating', category: CARD_PROXY_CATEGORY, amount: 8000 },
  // 2026-07 has no card export, so its payoff proxy must survive.
  { month: '2026-07', account: 'operating', category: CARD_PROXY_CATEGORY, amount: 13997 },
  { month: '2026-07', account: 'operating', category: 'Contractors', amount: 4890 },
];
const kept = dropSupersededCardProxy(PROXY_ROWS);
if (kept.length !== 3) fail(`dropSupersededCardProxy kept ${kept.length} rows, expected 3`);
if (kept.some((r) => r.month === '2026-05' && r.category === CARD_PROXY_CATEGORY)) {
  fail('card-payment proxy survived a month that has real card detail (double count)');
}
if (!kept.some((r) => r.month === '2026-07' && r.category === CARD_PROXY_CATEGORY)) {
  fail('card-payment proxy was dropped from a month with no card detail (gap)');
}

/* -- invariant 5: partial card months fall back to the proxy ------------- */
// Card export stopped 2026-06-06. May is covered (ends 05-31), June is not
// (ends 06-30), July has no card rows at all.
const MIXED = [
  { month: '2026-05', account: 'card', category: 'Software', amount: 2314 },
  { month: '2026-05', account: 'operating', category: CARD_PROXY_CATEGORY, amount: 8000 },
  { month: '2026-06', account: 'card', category: 'Guest supplies', amount: 5362 },
  { month: '2026-06', account: 'operating', category: CARD_PROXY_CATEGORY, amount: 8000 },
  { month: '2026-07', account: 'operating', category: CARD_PROXY_CATEGORY, amount: 13997 },
  { month: '2026-07', account: 'operating', category: 'Contractors', amount: 4890 },
];
const complete = cardCompleteMonths(MIXED, '2026-06-06');
if (!complete.has('2026-05')) fail('2026-05 should be card-complete (export runs to 06-06, month ends 05-31)');
if (complete.has('2026-06')) fail('2026-06 must NOT be card-complete: six days of data, month ends 06-30');

const resolved = resolveCardSpendSource(MIXED, complete);
const has = (month, pred) => resolved.some((r) => r.month === month && pred(r));
if (!has('2026-05', (r) => r.account === 'card')) fail('2026-05 lost its complete card detail');
if (has('2026-05', (r) => r.category === CARD_PROXY_CATEGORY)) fail('2026-05 kept a proxy on top of complete card detail');
if (has('2026-06', (r) => r.account === 'card')) fail('2026-06 kept six days of card charges as if they were a whole month');
if (!has('2026-06', (r) => r.category === CARD_PROXY_CATEGORY)) fail('2026-06 lost the proxy that should cover its partial card month');
if (!has('2026-07', (r) => r.category === CARD_PROXY_CATEGORY)) fail('2026-07 lost the proxy for a month with no card data');
if (!has('2026-07', (r) => r.category === 'Contractors')) fail('resolveCardSpendSource dropped a non-card row');

console.log(failures === 0
  ? 'PASS - expense rows foot to exp_total across 2026/2027/2028, the contractor line reproduces the observed $8,288/mo bench, the operating categorizer routes all 13 reference rows correctly, VRBO is a pass-through while Furnished Finder stays a real cost, and the card-payment proxy fills gap and partial-card months without ever double-counting complete card detail.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
