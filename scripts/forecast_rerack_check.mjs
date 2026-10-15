/**
 * Forecast rerack check — pure arithmetic, no database.
 *
 * Two invariants, both of which broke silently in the past:
 *
 *   1. The itemized expense rows the /forecast table renders must sum to
 *      `exp_total`. The six Chase-card rows read `cc_detail`, which must
 *      itself sum to `exp_cc_ops` in every projected month, and the
 *      proportional fallback split (for a month with no card detail) must
 *      too. Vehicle insurance is $519 in every projected month: April
 *      2026's $3,707 was GEICO plus a one-time Arbella premium, and the
 *      premium belongs on the Insurance line, never in the run rate.
 *
 *   2. The 1099 contractor line must reproduce the observed bench cost in
 *      the window it was calibrated on: $8,288/mo across 2026-07-01 to
 *      2026-08-25 ($15,248 over 56 days) out of the operating account, plus
 *      the two Lightshed listing shoots the card paid inside that window
 *      ($830, $451/mo), and hand the field work to the dated salary line
 *      from 2026-11-01 (one hire, on a date, never on a headcount).
 *
 *   2d. Outfitting is a one-time charge in a slider home's start month
 *      (ONBOARDING_COST, 2026-10-15), never on a rolled-forward home, and a
 *      card-only ACT month (operating export not yet uploaded) projects its
 *      operating lines instead of reading them as $0.
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
  decodeHtmlEntities,
} from '../src/lib/overhead-categories.ts';
import {
  calcYear,
  payrollCost,
  photoCost,
  contractorCost,
  CONTRACTOR_CREATIVE_MONTHLY,
  CONTRACTOR_PHOTO_MONTHLY,
  CONTRACTOR_FIELD_PROP_COUNT,
  CONTRACTOR_MISC_MONTHLY,
  ccOperatingDetail,
  CC_OPERATING_BREAKDOWN,
  CC_SUPPLY_SEASON,
  CC_VEHICLE_INSURANCE_MONTHLY,
  CC_TELECOM_MONTHLY,
  CC_MARKETING_POST_CUT_MONTHLY,
  CC_LISTING_ANNUAL,
  CC_LISTING_MONTHS,
  ONBOARDING_COST,
  OFFICE_RENT_MONTHLY,
  BANK_FEES_MONTHLY,
  SEASON,
} from '../src/lib/forecast-model.ts';
import { CC_DETAIL_KEYS, routeCardRow, sumCardDetail } from '../src/lib/forecast-card-detail.ts';
import { opensIn } from '../src/lib/forecast-operating-windows.ts';
import { rosterFromRegistry, knownFromRoster } from '../src/lib/forecast-roster.ts';
import { CURRENT_2026, NEW_PROPERTY_FEE } from '../src/lib/forecast-model.ts';

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
// Exactly what ForecastClient does: read the bucket from cc_detail, fall
// back to the proportional split only when a month has none.
const denom = CC_OPERATING_BREAKDOWN.reduce((a, c) => a + c.monthly, 0);
const rowValue = (m, cat) => (m.cc_detail ? m.cc_detail[cat.key] : (m.exp_cc_ops * cat.monthly) / denom);
const renderedTotal = (m) =>
  CC_OPERATING_BREAKDOWN.reduce((a, c) => a + rowValue(m, c), 0) +
  m.exp_office + m.exp_software + m.exp_bank + m.exp_contractors + m.exp_payroll +
  m.exp_debt + m.exp_insurance + m.exp_accounting +
  m.exp_onboard_presigned + m.exp_onboard_new;

if (CC_OPERATING_BREAKDOWN.length !== CC_DETAIL_KEYS.length ||
    CC_OPERATING_BREAKDOWN.some((c) => !CC_DETAIL_KEYS.includes(c.key))) {
  fail('CC_OPERATING_BREAKDOWN keys must be exactly the six card-detail buckets');
}

for (const [year, rolled] of [[2026, 0], [2027, 3], [2028, 6]]) {
  const r = calcYear(3, year, undefined, undefined, undefined, undefined, rolled);
  for (const m of r.monthly) {
    const tag = `${year}-${String(m.month).padStart(2, '0')}`;
    const rendered = renderedTotal(m);
    if (Math.abs(rendered - m.exp_total) > 0.01) {
      fail(`${tag} rows sum to ${rendered.toFixed(2)}, exp_total is ${m.exp_total.toFixed(2)}`);
    }
    // A projected month always carries its own itemisation, and it foots.
    if (!m.cc_detail) { fail(`${tag} projected month has no cc_detail`); continue; }
    const detailSum = sumCardDetail(m.cc_detail);
    if (Math.abs(detailSum - m.exp_cc_ops) > 0.01) {
      fail(`${tag} cc_detail sums to ${detailSum.toFixed(2)}, exp_cc_ops is ${m.exp_cc_ops.toFixed(2)}`);
    }
    if (m.cc_detail.vehicle_insurance !== CC_VEHICLE_INSURANCE_MONTHLY) {
      fail(`${tag} vehicle insurance is ${m.cc_detail.vehicle_insurance}, the run rate is ${CC_VEHICLE_INSURANCE_MONTHLY}`);
    }
    if (m.cc_detail.telecom !== CC_TELECOM_MONTHLY) fail(`${tag} telecom is ${m.cc_detail.telecom}`);
    if (year >= 2027 || m.month >= 6) {
      const wantMkt = CC_MARKETING_POST_CUT_MONTHLY + (CC_LISTING_MONTHS.includes(m.month) ? CC_LISTING_ANNUAL : 0);
      if (Math.abs(m.cc_detail.marketing - wantMkt) > 0.01) {
        fail(`${tag} marketing is ${m.cc_detail.marketing}, expected ${wantMkt} (post-cut, Furnished Finder in August and September)`);
      }
    }
    // Measured at 9.1% of the variable spend on 2026 through September
    // (repairs over supplies: about 10%). Was 5% against the
    // outfitting-inflated supplies figure.
    if (m.cc_detail.repairs <= 0 || m.cc_detail.repairs > m.cc_detail.supplies * 0.12) {
      fail(`${tag} repairs ${m.cc_detail.repairs.toFixed(0)} against supplies ${m.cc_detail.supplies.toFixed(0)}: measured share is about 9%`);
    }
  }
}

/* -- invariant 1c: an ACT month reads its measured detail, or falls back - */
{
  const measured = {
    month: '2026-04', revenue: 50000,
    exp_office: 1500, exp_software: 2740, exp_debt: 937.5, exp_insurance: 3188.57,
    exp_accounting: 4442.96, exp_bank: 30, exp_cc_ops: 7093, exp_contractors: 250,
    exp_onboard_presigned: 0, exp_onboard_new: 0,
    // What April 2026 really carried once Arbella moved to exp_insurance:
    // GEICO alone on the vehicle row.
    cc_detail: { supplies: 5086, repairs: 394, vehicle_insurance: 518.81, travel_other: 337.19, marketing: 757, telecom: 0 },
  };
  const proxied = { ...measured, month: '2026-05', cc_detail: null };
  // actuals is indexed by month - 1 and may be sparse.
  const acts = [];
  acts[3] = measured;
  acts[4] = proxied;
  const r = calcYear(0, 2026, acts, 5);
  const apr = r.monthly[3];
  const may = r.monthly[4];
  if (!apr.is_actual || !may.is_actual) fail('ACT rows were not marked actual');
  if (Math.abs(rowValue(apr, CC_OPERATING_BREAKDOWN.find((c) => c.key === 'vehicle_insurance')) - 518.81) > 0.001) {
    fail('April 2026 vehicle-insurance row should read the measured GEICO charge');
  }
  if (Math.abs(renderedTotal(apr) - apr.exp_total) > 0.01) fail('measured ACT month rows do not foot to exp_total');
  if (may.cc_detail !== null) fail('a proxy-sourced ACT month must carry null cc_detail');
  if (Math.abs(renderedTotal(may) - may.exp_total) > 0.01) fail('proxy-split ACT month rows do not foot to exp_total');
  if (Math.abs(rowValue(may, CC_OPERATING_BREAKDOWN[0]) - (7093 * CC_OPERATING_BREAKDOWN[0].monthly) / denom) > 0.01) {
    fail('proxy-sourced ACT month should fall back to the proportional split');
  }
}

/* -- invariant 1d: where a card row lands ------------------------------- */
const ROUTE_CASES = [
  ['Insurance', 'GEICO  *AUTO', 'vehicle_insurance'],
  ['Insurance', 'ARBELLA INSURANCE', 'insurance'],
  ['Software', 'GUESTY  INC.', 'software'],
  ['Software', 'Anthropic', 'software'],
  ['Guest supplies', 'SP FIX LINENS', 'supplies'],
  ['Repairs & upkeep', "ROCKY'S ACE HARDWARE GLOUCESTER MA", 'repairs'],
  ['Marketing', 'FACEBK *ADS', 'marketing'],
  ['Listing platforms', 'FURNISHED FINDER', 'marketing'],
  ['Other', 'AT&T MOBILITY EPAY', 'telecom'],
  ['Other', 'ATT*BILL PAYMENT', 'telecom'],
  // Chase escapes the ampersand in its export. Four 2026 bills were stored
  // this way and read as Travel & other while Telecom showed $0.
  ['Other', 'AT&amp;T MOBILITY EPAY', 'telecom'],
  ['Other', 'AT&amp;T BILL PAYMENT', 'telecom'],
  ['Other', 'PURCHASE INTEREST CHARGE', 'travel_other'],
  ['Travel', 'JETBLUE     2792111926428', 'travel_other'],
  // The dumpster is projected on the Office line, so a measured month
  // carries it there too, not in Travel & other.
  ['Rent & office', 'REPUBLIC SERVICES TRASH', 'office'],
  // The one contractor paid on the card rides the bench line it is
  // projected on; the landscapers are work on a home.
  ['Contractors', 'LIGHTSHED PHOTOGRAPHY', 'contractors'],
  ['Repairs & upkeep', 'WOLF HILL LANDSCAPING &', 'repairs'],
  ['Repairs & upkeep', 'IN *SP PROPERTIES', 'repairs'],
];
for (const [category, description, want] of ROUTE_CASES) {
  const got = routeCardRow(category, description.toUpperCase());
  if (got !== want) fail(`routeCardRow(${category}, "${description}") -> ${got}, expected ${want}`);
}
{
  const d = ccOperatingDetail(17, 2026, 4);
  if (d.vehicle_insurance !== 519) fail('projected April vehicle insurance must be the $519 run rate, not the one-time $3,707');
}
// The ingest route decodes Chase's escaped ampersand before it stores a row
// or builds its dedupe_key; a re-upload must land on the decoded key.
for (const [raw, want] of [
  ['AT&amp;T MOBILITY EPAY', 'AT&T MOBILITY EPAY'],
  ['CRATE&amp;BARREL CB2 NOD', 'CRATE&BARREL CB2 NOD'],
  ['AT&#38;T BILL PAYMENT', 'AT&T BILL PAYMENT'],
  ['GEICO  *AUTO', 'GEICO  *AUTO'],
]) {
  const got = decodeHtmlEntities(raw);
  if (got !== want) fail(`decodeHtmlEntities("${raw}") -> "${got}", expected "${want}"`);
}

/* -- invariant 2: contractors reproduce the calibration window ---------- */
// numNew = 0: the bench was measured against the REAL fleet, so the slider's
// hypothetical additions must not be in the denominator.
const y26 = calcYear(0, 2026);
// $15,248 over 56 days out of the operating account, 2026-07-01 .. 2026-08-25,
// plus the two Lightshed shoots the card paid inside the window (07-31 and
// 08-10, $830): the photography line was added to the bench on 2026-10-15.
const OBSERVED = 8288 + Math.round((830 / 56) * (365 / 12));
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
// The field contractor joins payroll on 2026-11-01: the field line ends in
// October, and the salary line starts in November, dated, never count-driven.
for (const mo of [11, 12]) {
  const m = y26.monthly[mo - 1];
  const benchOnly =
    (CONTRACTOR_CREATIVE_MONTHLY + CONTRACTOR_PHOTO_MONTHLY) * (m.active_count / CONTRACTOR_FIELD_PROP_COUNT) +
    CONTRACTOR_MISC_MONTHLY;
  if (Math.abs(m.exp_contractors - benchOnly) > 1e-6) fail(`2026-${mo} bench ${m.exp_contractors.toFixed(0)} still carries field labor; expected creative + misc ${benchOnly.toFixed(0)}`);
  if (Math.abs(m.exp_payroll - payrollCost(2026, mo)) > 1e-9 || m.exp_payroll <= 0) fail(`2026-${mo} salary line ${m.exp_payroll.toFixed(2)} is not payrollCost()`);
}
for (let mo = 1; mo <= 10; mo++) {
  if (y26.monthly[mo - 1].exp_payroll !== 0) fail(`2026-${String(mo).padStart(2, '0')} carries salary before the 2026-11-01 hire`);
}
// No count-triggered hire in any year (decided 2026-09-06): the one salaried
// hire is dated above, and the bench still scales linearly with the fleet.
if (y26.monthly.some((m) => 'exp_hire' in m)) fail('exp_hire is back on MonthRow; the count-triggered hire was removed');

/* -- invariant 2b: people scale linearly, so an added home never loses --- */
// The old count-triggered second hire made whichever home landed on 20 read
// as a loss (six new in 2027 netted $8,625 LESS than five). With people on
// the bench alone, each added home must add more revenue than cost over
// its first two seasons. Two, not one: since 2026-10-15 a new home pays its
// $2,150 outfitting up front, so a home started in November earns one
// shoulder month against a full linen order and is a small, real loss in
// that year. The step artifact this guards against would show up as a fall
// across the pair; a late start paying for itself the next year does not.
{
  const run = (n) => calcYear(n, 2027, undefined, undefined, undefined, undefined, 0, undefined, undefined, opensIn);
  const next = (n) => calcYear(0, 2028, undefined, undefined, undefined, undefined, n, undefined, undefined, opensIn);
  let prev = run(0).totals.net_business + next(0).totals.net_business;
  for (let n = 1; n <= 8; n++) {
    const cur = run(n).totals.net_business + next(n).totals.net_business;
    if (cur <= prev) {
      fail(`2027+2028 net falls from ${Math.round(prev)} to ${Math.round(cur)} going from ${n - 1} to ${n} new homes`);
    }
    // Within the year the in-year loss on a late start is bounded by the
    // outfitting charge: the home never costs more than its own linens.
    const inYear = run(n).totals.net_business - run(n - 1).totals.net_business;
    if (inYear < -ONBOARDING_COST) fail(`2027 in-year net falls by ${Math.round(-inYear)} on new home ${n}, more than the ${ONBOARDING_COST} outfitting charge`);
    prev = cur;
  }
  // From 2027 the people line is the flat salary plus the creative and misc
  // bench: every month carries payrollCost(), and the bench carries no field
  // labor (that work is the salary now). The bench part still scales with
  // the fleet, which is what keeps the slider monotonic above.
  const full = run(0);
  for (const m of full.monthly) {
    if (Math.abs(m.exp_payroll - payrollCost(2027, m.month)) > 1e-9) fail(`2027-${m.month} salary line ${m.exp_payroll.toFixed(2)} is not payrollCost()`);
    const benchCeiling =
      (CONTRACTOR_CREATIVE_MONTHLY + CONTRACTOR_PHOTO_MONTHLY) * (m.active_count / CONTRACTOR_FIELD_PROP_COUNT) +
      CONTRACTOR_MISC_MONTHLY;
    if (m.exp_contractors > benchCeiling + 1e-6 || m.exp_contractors < CONTRACTOR_MISC_MONTHLY) fail(`2027-${m.month} bench ${m.exp_contractors.toFixed(0)} should be creative + photography + misc only (field labor is on payroll); ceiling ${benchCeiling.toFixed(0)}`);
  }
}

/* -- invariant 2d: outfitting is charged once, and a card-only month projects its operating lines -- */
{
  // One slider home in 2027 starts in March (NEW_ORDER_2027[0]): the charge
  // lands there and nowhere else, and a home rolled forward from 2026 (the
  // 2028 synthetics) carries none.
  const one = calcYear(1, 2027, undefined, undefined, undefined, undefined, 0, undefined, undefined, opensIn);
  for (const m of one.monthly) {
    const want = m.month === 3 ? ONBOARDING_COST : 0;
    if (m.exp_onboard_new !== want) fail(`2027-${m.month} onboarding ${m.exp_onboard_new}, expected ${want}`);
  }
  const rolled = calcYear(0, 2028, undefined, undefined, undefined, undefined, 3, undefined, undefined, opensIn);
  if (rolled.monthly.some((m) => m.exp_onboard_new !== 0 || m.exp_onboard_presigned !== 0)) fail('a rolled-forward home must not be outfitted again');
  if (ONBOARDING_COST <= 0) fail('ONBOARDING_COST must be a real charge since 2026-10-15');

  // September 2026 as it first arrived: card detail to October 7, operating
  // export to August 25. Rent, the operating bench, payroll and bank fees
  // are the model's terms; the card's dumpster and Lightshed charges are
  // added to them, not replaced by them.
  const cardOnly = {
    month: '2026-09', revenue: 40000,
    exp_office: 471, exp_software: 2952, exp_debt: 0, exp_insurance: 0, exp_accounting: 0, exp_bank: 0,
    exp_cc_ops: 5503, exp_contractors: 757, exp_payroll: 0, exp_onboard_presigned: 0, exp_onboard_new: 0,
    cc_detail: { supplies: 2892, repairs: 1037, vehicle_insurance: 518.56, travel_other: 365.47, marketing: 577, telecom: 112.97 },
    operating_covered: false,
  };
  const covered = { ...cardOnly, month: '2026-08', exp_office: 1221, exp_contractors: 11188, operating_covered: true };
  const acts = [];
  acts[7] = covered;
  acts[8] = cardOnly;
  const r = calcYear(0, 2026, acts, 9, undefined, undefined, 0, undefined, undefined, opensIn);
  const aug = r.monthly[7];
  const sep = r.monthly[8];
  if (!aug.is_actual || aug.actual_card_only) fail('a covered ACT month must not be flagged card-only');
  if (aug.exp_office !== 1221 || aug.exp_contractors !== 11188) fail('a covered ACT month must read its operating lines as given');
  if (!sep.is_actual || !sep.actual_card_only) fail('a card-only ACT month must be flagged');
  if (Math.abs(sep.exp_office - (471 + OFFICE_RENT_MONTHLY)) > 1e-6) fail(`card-only month office ${sep.exp_office}: expected the card's dumpster plus projected rent`);
  const opCount = sep.active_count - 1; // 4 Brier Neck is offline from September
  const wantBench = 757 + contractorCost(2026, 9, opCount, SEASON.CA[8]) - photoCost(2026, 9, opCount);
  if (Math.abs(sep.exp_contractors - wantBench) > 1e-6) fail(`card-only month bench ${sep.exp_contractors.toFixed(2)}: expected Lightshed plus the projected operating bench ${wantBench.toFixed(2)}`);
  if (sep.exp_payroll !== payrollCost(2026, 9) || sep.exp_bank !== BANK_FEES_MONTHLY || sep.exp_debt !== 0 || sep.exp_accounting !== 0) fail('card-only month must project payroll, bank fees, bookkeeper and accounting');
  if (sep.exp_software !== 2952 || sep.exp_cc_ops !== 5503) fail('card-only month must keep the card lines as measured');
  if (Math.abs(renderedTotal(sep) - sep.exp_total) > 0.01) fail('card-only ACT month rows do not foot to exp_total');
}

/* -- invariant 2c: the cost roster comes from the registry --------------- */
// The cost lines used to scale on the hardcoded statement roster, so a home
// earned from the day it was activated and cost nothing until its first
// statement closed. The registry roster must: drop RT-owned, drop homes
// activated after the year, start a home the month it was activated, keep
// the statement-derived 2026 start for homes with no activated_at, and put
// a brand-new home on the cost lines.
{
  const known = knownFromRoster(CURRENT_2026);
  const homes = [
    { id: '3_locust', name: '3 Locust', isRtOwned: true, activatedAt: null, projectedMgmtFee: 0 },
    { id: '53_rocky_neck', name: '53 Rocky Neck', isRtOwned: false, activatedAt: null, projectedMgmtFee: 0 },
    { id: '84_thatcher', name: '84 Thatcher', isRtOwned: false, activatedAt: '2026-06-15T00:00:00Z', projectedMgmtFee: 0 },
    { id: '4_middle', name: '4 Middle Road', isRtOwned: false, activatedAt: null, projectedMgmtFee: 0 },
    { id: 'next_year', name: 'Signed for 2027', isRtOwned: false, activatedAt: '2027-03-01', projectedMgmtFee: 0 },
  ];
  const r26 = rosterFromRegistry(homes, 2026, known, NEW_PROPERTY_FEE);
  const by = Object.fromEntries(r26.map((p) => [p.id, p]));
  if (by['3_locust']) fail('roster: RT-owned 3 Locust must stay off the cost lines');
  if (by['next_year']) fail('roster: a home activated in 2027 must not be on the 2026 roster');
  if (!by['53_rocky_neck'] || by['53_rocky_neck'].start !== 5) fail('roster: 53 Rocky Neck keeps its statement-derived May start when activated_at is null');
  if (!by['53_rocky_neck'] || by['53_rocky_neck'].fee !== known['53_rocky_neck'].fee) fail('roster: 53 Rocky Neck keeps its known 2026 fee');
  if (!by['84_thatcher'] || by['84_thatcher'].start !== 6) fail('roster: 84 Thatcher starts the month it was activated (June)');
  if (!by['4_middle'] || by['4_middle'].start !== 1 || by['4_middle'].fee !== NEW_PROPERTY_FEE) fail('roster: 4 Middle Road is on the cost lines at the first-season fee');
  const r27 = rosterFromRegistry(homes.map((h) => ({ ...h, projectedMgmtFee: 31000 })), 2027, {}, NEW_PROPERTY_FEE);
  const by27 = Object.fromEntries(r27.map((p) => [p.id, p]));
  if (!by27['next_year'] || by27['next_year'].start !== 3) fail('roster: the 2027 signing starts in March 2027');
  if (!by27['84_thatcher'] || by27['84_thatcher'].start !== 1 || by27['84_thatcher'].fee !== 31000) fail('roster: a 2026 home is full-year in 2027 at the projected fee');
  if (r27.some((p) => p.id === '3_locust')) fail('roster: RT-owned stays off in 2027 too');

  // Injected into calcYear, the roster is what the cost lines scale on.
  const yA = calcYear(0, 2026);
  const yB = calcYear(0, 2026, undefined, undefined, undefined, undefined, 0, undefined, undefined, undefined, undefined,
    [...CURRENT_2026, { id: '4_middle', name: '4 Middle Road', fee: NEW_PROPERTY_FEE, type: 'CA', start: 9 }]);
  const dec = (y) => y.monthly[11];
  if (dec(yB).active_count !== dec(yA).active_count + 1) fail('calcYear: an injected roster home must raise December active_count by one');
  if (dec(yB).exp_cc_ops <= dec(yA).exp_cc_ops || dec(yB).exp_contractors <= dec(yA).exp_contractors) fail('calcYear: an injected roster home must add card and bench cost');
  if (yB.monthly[7].exp_cc_ops !== yA.monthly[7].exp_cc_ops) fail('calcYear: a home starting in September must not change August');
}

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
  ['SEAM IOT API', -179.00, 'Software'],
  ['MIDJOURNEY INC.', -63.75, 'Software'],
  // September 2026's new vendors: the photographer is a contractor, the
  // landscapers are repairs, and neither is Other any more.
  ['LIGHTSHED PHOTOGRAPHY', -415.00, 'Contractors'],
  ['WOLF HILL LANDSCAPING &amp;', -302.76, 'Repairs & upkeep'],
  ['IN *SP PROPERTIES', -367.00, 'Repairs & upkeep'],
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
  ? 'PASS - expense rows foot to exp_total across 2026/2027/2028, every projected month itemises the card to the cent with vehicle insurance at the $519 run rate, a measured ACT month reads its own card categories and a proxied one falls back to the split, GEICO stays on the vehicle row while Arbella goes to Insurance, the contractor line reproduces the observed bench (operating account plus the card-paid photographer) then hands the field work to the dated salary line in November 2026 (2027+2028 net still rises with every added home, which now pays its outfitting up front), a card-only ACT month projects its operating lines instead of reading $0, the cost roster comes from the registry (RT-owned off, activation month honored, a new home costs from day one), the operating categorizer routes all 13 reference rows correctly, VRBO is a pass-through while Furnished Finder stays a real cost, and the card-payment proxy fills gap and partial-card months without ever double-counting complete card detail.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
