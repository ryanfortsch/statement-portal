/**
 * Calibration data extracted from RT's Chase ...5130 operating account
 * activity (Aug 2024 → May 2026, 433 transactions).
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
    label: 'Chase CC ...3878 payments',
    total12mo: -81804.68,
    avgMonthly: -6817.06,
    note: 'Operating expenses charged to the business CC. Range $3,054.42-$16,340.49/mo. Likely includes software, supplies, marketing, and some property pass-through. Needs CC statement decomposition to assign properly.',
    inScope: true,
  },
  {
    id: 'payroll',
    label: 'Payroll (Gusto NET + TAX)',
    total12mo: -18298.40,
    avgMonthly: -1524.87,
    note: 'NET $12,403.25 + TAX $5,895.15. Bi-weekly Gusto runs Apr-Oct 2025 (~$3,500/mo when active). Stopped after Oct 2025 — staff appear to be paid off-Gusto since.',
    inScope: true,
  },
  {
    id: 'mh_partners',
    label: 'MH Partners debt service',
    total12mo: -12603.92,
    avgMonthly: -1050.33,
    note: 'Monthly ACH labeled "CASH CON". Was $1,155/mo through Sep 2025, dropped to $937.50/mo in 2026. Loan retired June 2026.',
    inScope: true,
  },
  {
    id: 'insurance',
    label: 'Phillips Insurance',
    total12mo: -5263.92,
    avgMonthly: -438.66,
    note: 'One $5,263.92 ACH on 03/02/2026. Likely annual policy.',
    inScope: true,
  },
  {
    id: 'subcontractors',
    label: 'Misc Zelle subcontractors',
    total12mo: -4976.94,
    avgMonthly: -414.75,
    note: 'One-off Zelle to Mark Bell, Onyx, Owen Brill, Mateo, Cleu, Morgan Denhart. Project-based, not steady.',
    inScope: true,
  },
  {
    id: 'accounting',
    label: 'MS Consultants (accounting)',
    total12mo: -4442.96,
    avgMonthly: -370.25,
    note: 'One $4,442.96 ACH on 04/15/2026. Older $4,156.62 in Jan 2025 was outside the trailing window. ~$8,600/yr extrapolated.',
    inScope: true,
  },
  {
    id: 'staff_zelle',
    label: 'Maggie Butler (weekly Zelle)',
    total12mo: -3679.00,
    avgMonthly: -306.58,
    note: '$600-$679/wk Oct-Dec 2025 only. Last payment 12/03/2025.',
    inScope: true,
  },
  {
    id: 'state_tax',
    label: 'MA DOR (state tax remittance)',
    total12mo: -3141.04,
    avgMonthly: -261.75,
    note: 'Summer occupancy-tax payments to Mass DOR. Jul 2025: $894.48 + $1,348.42. Jun 2025: $686.10 + $212.04.',
    inScope: true,
  },
  {
    id: 'pool_service',
    label: 'Neptune Pool (Lighthouse Pt)',
    total12mo: -3064.16,
    avgMonthly: -255.35,
    note: 'One $3,064.16 ACH on 10/28/2025 — pool closing for the FL property. Belongs to RT-owned, out of mgmt scope.',
    inScope: false,
  },
  {
    id: 'office_rent',
    label: 'Office rent (85 Eastern)',
    total12mo: -3000.00,
    avgMonthly: -250.00,
    note: 'Three $750 + one $1,500 ACHs in 2026 only — lease started Mar 2026. The $1,500 is two-month catch-up. Going forward $750/mo recurring.',
    inScope: true,
  },
  {
    id: 'healthcare',
    label: 'Commonwealth Health Conn.',
    total12mo: -2752.95,
    avgMonthly: -229.41,
    note: 'One $2,752.95 batch ($2,654.14 + $98.81) on 04/06/2026. Ryan Fortsch IND name — personal benefit paid from biz account, out of scope per Dotti.',
    inScope: false,
  },
  {
    id: 'maintenance',
    label: 'Maintenance / handymen (Zelle)',
    total12mo: -2140.51,
    avgMonthly: -178.38,
    note: 'Ian Drometer (Gloucester maint), Tomer, Nicole Whitten, Jason (Lighthouse landscaper), Morris Home Services.',
    inScope: true,
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
    total12mo: -911.53,
    avgMonthly: -75.96,
    note: 'Steady $68-$87/mo platform fee.',
    inScope: true,
  },
  {
    id: 'personal_grocery',
    label: 'Groceries (debit card)',
    total12mo: -696.88,
    avgMonthly: -58.07,
    note: 'Market Basket, Stop & Shop, CVS, Richdale, Walmart. Personal — out of scope.',
    inScope: false,
  },
  {
    id: 'photography',
    label: 'Luke Wallace Studios',
    total12mo: -600.00,
    avgMonthly: -50.00,
    note: 'Listing photos. $600 on 06/03/2025; older $850 in Jan 2025 outside the window.',
    inScope: true,
  },
  {
    id: 'personal_meal',
    label: 'Meals/coffee (debit card)',
    total12mo: -550.60,
    avgMonthly: -45.88,
    note: 'Starbucks, restaurants. Personal — out of scope.',
    inScope: false,
  },
  {
    id: 'atm',
    label: 'ATM withdrawals',
    total12mo: -460.00,
    avgMonthly: -38.33,
    note: 'Cash withdrawals at 221 Main. Personal — out of scope.',
    inScope: false,
  },
  {
    id: 'personal_hardware',
    label: 'Hardware/marine (debit card)',
    total12mo: -458.43,
    avgMonthly: -38.20,
    note: "Home Depot, Rocky's Ace, Three Lantern Marine, Seaside Glass. Mostly per-property work — out of mgmt scope.",
    inScope: false,
  },
  {
    id: 'cc_allie',
    label: "Chase CC autopay (Allie's)",
    total12mo: -80.00,
    avgMonthly: -6.67,
    note: "$40/mo on the months it autopays. Allie's separate card.",
    inScope: true,
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
  mgmt_fee_in: 131871.94,
  /** Direct deposits from booking platforms (mostly pass-through to owners). */
  platform_revenue: 68597.90,
  /** Capital infusions from Ryan's Fidelity (when ops needed cushion). */
  capital_infusion: 16000.00,
  /**
   * Internal transfers from sub-accounts (net). Negative because more went
   * out to ...8203 / ...6966 than came in over the window.
   */
  internal_xfer: -2795.01,
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
  { month: '2025-06', mgmtFeeIn: 7889.91, platformRevenue: 0, isPartial: false },
  { month: '2025-07', mgmtFeeIn: 8117.57, platformRevenue: 3569.60, isPartial: false },
  { month: '2025-08', mgmtFeeIn: 29835.69, platformRevenue: 0, isPartial: false },
  { month: '2025-09', mgmtFeeIn: 27537.47, platformRevenue: 2575.16, isPartial: false },
  { month: '2025-10', mgmtFeeIn: 12076.24, platformRevenue: 25229.86, isPartial: false },
  { month: '2025-11', mgmtFeeIn: 20076.86, platformRevenue: 3202.40, isPartial: false },
  { month: '2025-12', mgmtFeeIn: 7488.22, platformRevenue: 4907.76, isPartial: false },
  { month: '2026-01', mgmtFeeIn: 4591.44, platformRevenue: 8447.13, isPartial: false },
  { month: '2026-02', mgmtFeeIn: 2165.90, platformRevenue: 6502.95, isPartial: false },
  { month: '2026-03', mgmtFeeIn: 1828.16, platformRevenue: 2191.93, isPartial: false },
  { month: '2026-04', mgmtFeeIn: 2395.25, platformRevenue: 11971.11, isPartial: false },
  { month: '2026-05', mgmtFeeIn: 7869.23, platformRevenue: 0, isPartial: true },
];

/**
 * Statement window (the dataset this calibration came from).
 * Update when the parser is re-run on a fresh export.
 */
export const ACTUALS_WINDOW = {
  account: 'Chase ...5130 (RT operating)',
  rangeStart: '2024-08-30',
  rangeEnd: '2026-05-04',
  trailing12moStart: '2025-06-01',
  trailing12moEnd: '2026-05-31',
  txCount: 433,
  exportFile: 'Chase5130_Activity_20260506.CSV',
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
    exp_cc_ops: 4464.42, // CC $3,054.42 + Mark Bell $1,410.00
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
    exp_cc_ops: 3561.32, // CC $3,411.32 + Mateo $150
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
    exp_cc_ops: 8290.00, // CC $8,000 + Allie $40 + Ian Drometer $250
    exp_hire: 0,
    exp_onboard_presigned: 0,
    exp_onboard_new: 0,
  },
];

/** Last activity month for which we have complete actuals (1-12). */
export const ACTUALS_2026_THROUGH_MONTH = 4;
