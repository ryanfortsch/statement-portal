/**
 * Calibration data extracted from RT's Chase ...5130 operating account
 * activity (Aug 2024 → Aug 2026, 580 transactions).
 *
 * Trailing-12 figures use Aug 2025 → Jul 2026, the last twelve COMPLETE
 * months. The export runs to 2026-08-25, so August 2026 is deliberately
 * held out of every average, it is 25 days, and it carries a $43,665
 * one-off card paydown that would distort any run rate it touched.
 *
 * The /forecast page uses these numbers two ways:
 *   1. As defaults/calibration for the model's expense assumptions
 *      (forecast-model.ts).
 *   2. As a "Run rate · last 12 months" reality-check panel rendered
 *      alongside the projection.
 *
 * Source: parsed `Chase5130_Activity_20260506.CSV` with the categorizer in
 * tools/parse-chase-activity (see PR adding /forecast actuals). Refresh by
 * re-running the parser when a new statement is exported. Numbers below
 * are exact dollars-and-cents (positive = inflow, negative = outflow) for
 * the trailing 12-month window: Jun 2025 → May 2026 inclusive.
 */

export type ExpenseLine = {
  id: string;
  label: string;
  /** 12-month total, dollars (precise to the cent). Negative = outflow. */
  total12mo: number;
  /** 12-month average per month (precise to the cent). Negative = outflow. */
  avgMonthly: number;
  /** Brief note on cadence and source. */
  note: string;
  /** Whether this is in scope for the management-business forecast. */
  inScope: boolean;
};

/**
 * Known recurring outflows in trailing-12-month period (Jun 2025 - May 2026).
 * Sorted by absolute size — biggest first. All values precise to the cent.
 */
export const ACTUALS_TRAILING_12MO: ExpenseLine[] = [
  {
    id: 'cc_main',
    label: 'Chase CC payments (...3878 + ...6250)',
    total12mo: -102312.48,
    avgMonthly: -8526.04,
    note: 'The single largest outflow, 21 payments. Up 117% year over year on a Sep-Aug basis ($59,670 -> $129,718). A second card (...6250) opened July 2026 and is additive, not a replacement. WARNING: payments are not spend. They lag the charges by about a month, they lump (August 2026 alone paid $43,665 to clear a carried balance), and they settle personal charges the categorizer drops. Card-level detail in overhead_expenses is the honest expense ledger; it runs $7,843/mo on this window.',
    inScope: true,
  },
  {
    id: 'mh_partners',
    label: 'MH Partners (bookkeeper)',
    total12mo: -12168.92,
    avgMonthly: -1014.08,
    note: 'Outside bookkeeper retainer (not debt - descriptor "CASH CON" is misleading). $1,155/mo through Sep 2025, $937.50/mo Jan-Apr 2026, $1,800 final wrap-up in May 2026, then $0.',
    inScope: true,
  },
  {
    id: 'payroll',
    label: 'Payroll (Gusto NET + TAX)',
    total12mo: -11768.19,
    avgMonthly: -980.68,
    note: 'Bi-weekly Gusto runs. Wound down through 2026 - the field bench moved to direct Zelle and the Chase payroll rail instead, which is why the contractor lines below exist.',
    inScope: true,
  },
  {
    id: 'subcontractors',
    label: 'Misc Zelle subcontractors',
    total12mo: -7858.00,
    avgMonthly: -654.83,
    note: 'Maggie Butler ($3,679, weekly Oct-Dec 2025 only), Onyx Infrastructure, Mark Bell, Owen Brill, Sandy Maid, Mateo. Project-based, not steady.',
    inScope: true,
  },
  {
    id: 'contractor_field',
    label: 'Delaney Jordan (field labor)',
    total12mo: -4590.00,
    avgMonthly: -382.50,
    note: 'NEW as of 2026-07-07 - the window only catches July, so the 12-month average badly understates the run rate. 18 payments totalling $4,590 in July; 21 payments totalling $5,958 in the first 25 days of August. Paid per job, clustered Monday and Thursday (62.3% of dollars), tracking checkout volume. Current run rate is roughly $6,900/mo and still climbing.',
    inScope: true,
  },
  {
    id: 'insurance',
    label: 'Phillips Insurance',
    total12mo: -5263.92,
    avgMonthly: -438.66,
    note: 'One $5,263.92 ACH on 03/02/2026 - annual policy paid as a lump sum, not monthly. The model hits this once a year in March only. Separate from the GEICO auto and other policies riding the card.',
    inScope: true,
  },
  {
    id: 'office_rent',
    label: 'Office rent (85 Eastern)',
    total12mo: -5250.00,
    avgMonthly: -437.50,
    note: 'Lease started Mar 2026, so the window holds only six payments. $750/mo recurring going forward, plus one $1,500 two-month catch-up.',
    inScope: true,
  },
  {
    id: 'accounting',
    label: 'MS Consultants (one-time)',
    total12mo: -4442.96,
    avgMonthly: -370.25,
    note: 'One $4,442.96 ACH on 04/15/2026 - one-time engagement, not recurring. The model zeros this line going forward.',
    inScope: true,
  },
  {
    id: 'pool_service',
    label: 'Neptune Pool (Lighthouse Pt)',
    total12mo: -3064.16,
    avgMonthly: -255.35,
    note: 'One $3,064.16 ACH on 10/28/2025 - pool closing for the FL property. Belongs to RT-owned, out of mgmt scope.',
    inScope: false,
  },
  {
    id: 'healthcare',
    label: 'Commonwealth Health Conn.',
    total12mo: -2752.95,
    avgMonthly: -229.41,
    note: 'One $2,752.95 batch on 04/06/2026. Ryan Fortsch IND name - personal benefit paid from the business account, out of scope per Dotti.',
    inScope: false,
  },
  {
    id: 'maintenance',
    label: 'Maintenance / handymen (Zelle)',
    total12mo: -2055.00,
    avgMonthly: -171.25,
    note: 'Ian Drometer (Gloucester maint), Tomer, Nicole Whitten, Jason (Lighthouse landscaper), Morris Home Services. Nicole took another $2,400 on 08/11/2026, just past this window.',
    inScope: true,
  },
  {
    id: 'personal_hardware',
    label: 'Hardware/marine (debit card)',
    total12mo: -2044.12,
    avgMonthly: -170.34,
    note: "Home Depot, Rocky's Ace, Three Lantern Marine, Seaside Glass. Mostly per-property work - out of mgmt scope.",
    inScope: false,
  },
  {
    id: 'bank_fees',
    label: 'Bank fees + stop payments',
    total12mo: -1345.60,
    avgMonthly: -112.13,
    note: 'Stop payment fees, monthly service charges, returned-check fees ($1,208.78 returned check Jan 2026).',
    inScope: true,
  },
  {
    id: 'payroll_software',
    label: 'Gusto software fee',
    total12mo: -738.13,
    avgMonthly: -61.51,
    note: 'Steady $68-$87/mo platform fee.',
    inScope: true,
  },
  {
    id: 'personal_grocery',
    label: 'Groceries (debit card)',
    total12mo: -715.99,
    avgMonthly: -59.67,
    note: 'Market Basket, Stop & Shop, CVS, Richdale, Walmart. Personal - out of scope.',
    inScope: false,
  },
  {
    id: 'atm',
    label: 'ATM withdrawals',
    total12mo: -460.00,
    avgMonthly: -38.33,
    note: 'Cash withdrawals at 221 Main. Personal - out of scope.',
    inScope: false,
  },
  {
    id: 'contractor_creative',
    label: 'Cooper (creative)',
    total12mo: -300.00,
    avgMonthly: -25.00,
    note: 'NEW as of 2026-07-29, so the window catches one payment. Paid $300/wk on the Chase "Basic Online Payroll" rail; $2,300 through 08/25/2026. Forward run rate ~$1,300/mo.',
    inScope: true,
  },
  {
    id: 'cc_allie',
    label: "Chase CC autopay (Allie's)",
    total12mo: -80.00,
    avgMonthly: -6.67,
    note: "$40/mo on the months it autopays. Allie's separate card - it only ever debits this account twice in 24 months, so either it is near-dormant or it is paid from an account we cannot see.",
    inScope: true,
  },
  {
    id: 'personal_meal',
    label: 'Meals/coffee (debit card)',
    total12mo: -69.47,
    avgMonthly: -5.79,
    note: 'Starbucks, restaurants. Personal - out of scope.',
    inScope: false,
  },
];

/**
 * Total in-scope recurring outflow per month based on 12-month averages.
 * Used to back-check the model's expense assumptions. Precise to the cent.
 */
export const ACTUAL_INSCOPE_AVG_MONTHLY: number = ACTUALS_TRAILING_12MO
  .filter((l) => l.inScope)
  .reduce((s, l) => s + l.avgMonthly, 0);

/**
 * Inflows seen in the 5130 operating account over the trailing 12 months.
 * For sanity-checking the revenue side of the model. Precise to the cent.
 */
export const ACTUALS_INFLOWS_TRAILING_12MO = {
  /** Management fees swept from property accounts into operating. */
  mgmt_fee_in: 156277.20,
  /** Direct deposits from booking platforms (mostly pass-through to owners). */
  platform_revenue: 82776.81,
  /** Capital infusions from Ryan's Fidelity (when ops needed cushion). */
  capital_infusion: 9000.00,
  /**
   * Internal transfers from sub-accounts (net). Negative because more went
   * out to ...8203 / ...6966 than came in over the window.
   */
  internal_xfer: -14488.13,
} as const;

export type MonthlyInflow = {
  /** Posting month, YYYY-MM. */
  month: string;
  /** Mgmt fee transfers from property accounts → 5130 (precise). */
  mgmtFeeIn: number;
  /** Direct deposits from Booking.com / Airbnb / Stripe (pass-through). */
  platformRevenue: number;
  /** True when the bank export ended mid-month (only May 2026). */
  isPartial: boolean;
};

/**
 * Monthly inflows by posting month from Chase ...5130. Posting lags
 * activity by ~1 month — e.g. the $4,591 posted Jan 2026 represents Dec
 * 2025 activity that closed on owner statements the first week of Jan.
 *
 * Use these for "actual revenue through April 2026" reality-checks. Note
 * the bank-visible mgmt fee is meaningfully smaller than the model's
 * gross fee because (a) statements net out reimbursements before the
 * sweep, (b) some payments route through other RT accounts (...8203,
 * ...6966) before reaching ...5130.
 */
export const ACTUALS_INFLOWS_BY_MONTH: MonthlyInflow[] = [
  { month: '2025-08', mgmtFeeIn: 29835.69, platformRevenue: 0, isPartial: false },
  { month: '2025-09', mgmtFeeIn: 27537.47, platformRevenue: 2575.16, isPartial: false },
  { month: '2025-10', mgmtFeeIn: 12076.24, platformRevenue: 25229.86, isPartial: false },
  { month: '2025-11', mgmtFeeIn: 20076.86, platformRevenue: 3202.40, isPartial: false },
  { month: '2025-12', mgmtFeeIn: 7488.22, platformRevenue: 4907.76, isPartial: false },
  { month: '2026-01', mgmtFeeIn: 4591.44, platformRevenue: 8447.13, isPartial: false },
  { month: '2026-02', mgmtFeeIn: 2165.90, platformRevenue: 6502.95, isPartial: false },
  { month: '2026-03', mgmtFeeIn: 1828.16, platformRevenue: 2191.93, isPartial: false },
  { month: '2026-04', mgmtFeeIn: 2395.25, platformRevenue: 11971.11, isPartial: false },
  { month: '2026-05', mgmtFeeIn: 7965.81, platformRevenue: 6534.44, isPartial: false },
  { month: '2026-06', mgmtFeeIn: 12440.85, platformRevenue: 1057.94, isPartial: false },
  { month: '2026-07', mgmtFeeIn: 27875.31, platformRevenue: 10156.13, isPartial: false },
  { month: '2026-08', mgmtFeeIn: 55168.03, platformRevenue: 0, isPartial: true },
];

/**
 * Statement window (the dataset this calibration came from).
 * Update when the parser is re-run on a fresh export.
 */
export const ACTUALS_WINDOW = {
  account: 'Chase ...5130 (RT operating)',
  rangeStart: '2024-08-30',
  rangeEnd: '2026-08-25',
  trailing12moStart: '2025-08-01',
  trailing12moEnd: '2026-07-31',
  txCount: 580,
  exportFile: 'Chase5130_Activity_20260825.csv',
} as const;

/* ===================================================================== */
/* 2026 monthly actuals — by activity month                              */
/* ===================================================================== */

/**
 * Precise actuals for each completed month of 2026, keyed to the model's
 * expense buckets in forecast-model.ts. Used by `calcYear` to replace the
 * modeled assumption for past months — so the Monthly Detail table shows
 * what actually happened through April, then the model's projection from
 * May onward.
 *
 * Convention:
 *   - revenue = mgmt fee earned this activity month (swept first weekday
 *     of the following month).
 *   - exp_*   = cash that left the bank this calendar month, mapped into
 *     the model's expense bucket. Lumpy items (Phillips annual, MS
 *     Consultants quarterly) sit in the month they actually paid, NOT
 *     smoothed across the year — matches reality.
 *   - exp_cc_ops folds in the Chase CC payment + Allie's autopay +
 *     subcontractor Zelle + maintenance Zelle, since the model's
 *     "operating CC" line is the catch-all for variable ops spend.
 *   - exp_bank excludes the Jan 2026 deposit-return wash ($1,208.78
 *     deposited then reversed — net zero, not a real fee).
 */
export type MonthlyActual = {
  month: string; // YYYY-MM (activity month for revenue, calendar month for expenses)
  revenue: number;
  exp_office: number;
  exp_software: number;
  exp_debt: number;
  exp_insurance: number;
  exp_accounting: number;
  exp_bank: number;
  exp_cc_ops: number;
  exp_contractors: number;
  exp_hire: number;
  exp_onboard_presigned: number;
  exp_onboard_new: number;
};

export const ACTUALS_2026: MonthlyActual[] = [
  {
    month: '2026-01',
    revenue: 2165.90, // swept Feb 2
    exp_office: 0,
    exp_software: 68.00, // Gusto fee
    exp_debt: 937.50, // MH Partners
    exp_insurance: 0,
    exp_accounting: 0,
    exp_bank: 0, // $1,208.78 deposit return is a wash, not a fee
    exp_cc_ops: 3054.42, // CC payment only
    exp_contractors: 1410.00, // Mark Bell
    exp_hire: 0,
    exp_onboard_presigned: 0,
    exp_onboard_new: 0,
  },
  {
    month: '2026-02',
    revenue: 1828.16, // swept Mar 2
    exp_office: 1500.00, // catch-up + Feb
    exp_software: 73.00,
    exp_debt: 937.50,
    exp_insurance: 0,
    exp_accounting: 0,
    exp_bank: 0,
    exp_cc_ops: 3411.32, // CC payment only
    exp_contractors: 150.00, // Mateo
    exp_hire: 0,
    exp_onboard_presigned: 0,
    exp_onboard_new: 0,
  },
  {
    month: '2026-03',
    revenue: 2395.25, // swept Apr 3
    exp_office: 0,
    exp_software: 68.00,
    exp_debt: 986.42, // MH $937.50 + cleanup $48.92
    exp_insurance: 5263.92, // Phillips annual
    exp_accounting: 0,
    exp_bank: 0,
    exp_cc_ops: 6637.24, // CC $6,597.24 + Allie $40.00
    exp_contractors: 0,
    exp_hire: 0,
    exp_onboard_presigned: 0,
    exp_onboard_new: 0,
  },
  {
    month: '2026-04',
    revenue: 7869.23, // swept May 4
    exp_office: 1500.00, // $750 × 2
    exp_software: 0, // No Gusto fee posted in April
    exp_debt: 937.50,
    exp_insurance: 0,
    exp_accounting: 4442.96, // MS Consultants
    exp_bank: 30.00, // Stop payment fee
    exp_cc_ops: 8040.00, // CC $8,000 + Allie $40
    exp_contractors: 250.00, // Ian Drometer
    exp_hire: 0,
    exp_onboard_presigned: 0,
    exp_onboard_new: 0,
  },
];

/** Last activity month for which we have complete actuals (1-12). */
export const ACTUALS_2026_THROUGH_MONTH = 4;
