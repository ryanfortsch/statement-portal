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
 * are dollars (positive = inflow, negative = outflow), Apr-2025 →
 * Apr-2026 inclusive (12 trailing months).
 */

export type ExpenseLine = {
  id: string;
  label: string;
  /** 12-month total, dollars. Negative because it's an outflow. */
  total12mo: number;
  /** 12-month average per month. Negative. */
  avgMonthly: number;
  /** Brief note on cadence and source. */
  note: string;
  /** Whether this is in scope for the management-business forecast. */
  inScope: boolean;
};

/**
 * Known recurring outflows in trailing-12-month period (Apr 2025 - Apr 2026).
 * Sorted by absolute size — biggest first.
 */
export const ACTUALS_TRAILING_12MO: ExpenseLine[] = [
  {
    id: 'cc_main',
    label: 'Chase CC ...3878 payments',
    total12mo: -81805,
    avgMonthly: -6817,
    note: 'Operating expenses charged to the business CC. Range $3K-$16K/mo. Likely includes software, supplies, marketing, and some property pass-through. Needs CC statement decomposition to assign properly.',
    inScope: true,
  },
  {
    id: 'payroll',
    label: 'Payroll (Gusto NET + TAX)',
    total12mo: -18298,
    avgMonthly: -1525,
    note: 'Bi-weekly payroll runs Apr-Oct 2025 (~$3,500/mo when active). Stopped after Oct 2025 — staff appear to be paid off-Gusto since.',
    inScope: true,
  },
  {
    id: 'mh_partners',
    label: 'MH Partners debt service',
    total12mo: -12604,
    avgMonthly: -1050,
    note: 'Monthly ACH labeled "CASH CON". Was $1,155/mo through Sep 2025, dropped to $937/mo in 2026.',
    inScope: true,
  },
  {
    id: 'accounting',
    label: 'MS Consultants (accounting)',
    total12mo: -4443,
    avgMonthly: -370,
    note: 'Quarterly-ish — saw $4,443 in Apr 2026 and $4,156 in Jan 2025 in the wider window. Smoothes to ~$700/mo annualized.',
    inScope: true,
  },
  {
    id: 'subcontractors',
    label: 'Misc Zelle subcontractors',
    total12mo: -4977,
    avgMonthly: -415,
    note: 'One-off Zelle to Mark Bell, Onyx, Owen Brill, Mateo, Cleu, Morgan Denhart. Project-based, not steady.',
    inScope: true,
  },
  {
    id: 'staff_zelle',
    label: 'Maggie Butler (weekly Zelle)',
    total12mo: -3679,
    avgMonthly: -307,
    note: '$600-$679/wk Oct-Dec 2025 only. Stopped after Dec 2025.',
    inScope: true,
  },
  {
    id: 'state_tax',
    label: 'MA DOR (state tax remittance)',
    total12mo: -3141,
    avgMonthly: -262,
    note: 'Summer occupancy-tax payments to Mass DOR (Jun-Jul 2025: $200-$1,300/mo).',
    inScope: true,
  },
  {
    id: 'pool_service',
    label: 'Neptune Pool (Lighthouse Pt)',
    total12mo: -3064,
    avgMonthly: -255,
    note: 'One $3K Oct 2025 — pool closing for the FL property. Belongs to RT-owned, out of mgmt scope.',
    inScope: false,
  },
  {
    id: 'office_rent',
    label: 'Office rent (85 Eastern)',
    total12mo: -3000,
    avgMonthly: -250,
    note: 'Three $750 ACHs in 2026 only — lease started Mar 2026. Going forward $750/mo recurring.',
    inScope: true,
  },
  {
    id: 'healthcare',
    label: 'Commonwealth Health Conn.',
    total12mo: -2753,
    avgMonthly: -229,
    note: 'One $2,753 batch Apr 2026 (Ryan Fortsch IND name). Personal benefit paid from biz account — out of scope per Dotti.',
    inScope: false,
  },
  {
    id: 'maintenance',
    label: 'Maintenance / handymen (Zelle)',
    total12mo: -2141,
    avgMonthly: -178,
    note: 'Ian Drometer (Gloucester maint), Tomer, Nicole Whitten, Jason (Lighthouse landscaper), Morris.',
    inScope: true,
  },
  {
    id: 'insurance',
    label: 'Phillips Insurance',
    total12mo: -5264,
    avgMonthly: -439,
    note: 'One $5,264 ACH Mar 2026. Likely annual policy.',
    inScope: true,
  },
  {
    id: 'photography',
    label: 'Luke Wallace Studios',
    total12mo: -600,
    avgMonthly: -50,
    note: 'Listing photos. $600 in Jun 2025; $850 in Jan 2025 (out of window).',
    inScope: true,
  },
  {
    id: 'bank_fees',
    label: 'Bank fees + stop payments',
    total12mo: -1346,
    avgMonthly: -112,
    note: 'Stop payment fees, monthly service charges, returned-check fees.',
    inScope: true,
  },
  {
    id: 'payroll_software',
    label: 'Gusto software fee',
    total12mo: -912,
    avgMonthly: -76,
    note: 'Steady $68-$87/mo platform fee.',
    inScope: true,
  },
  {
    id: 'cc_allie',
    label: "Chase CC autopay (Allie's)",
    total12mo: -80,
    avgMonthly: -7,
    note: '$40/mo on the months it autopays. Allie\'s separate card.',
    inScope: true,
  },
  {
    id: 'personal_grocery',
    label: 'Groceries (debit card)',
    total12mo: -697,
    avgMonthly: -58,
    note: 'Market Basket, Stop & Shop, CVS, Richdale, Walmart. Personal — out of scope.',
    inScope: false,
  },
  {
    id: 'personal_meal',
    label: 'Meals/coffee (debit card)',
    total12mo: -551,
    avgMonthly: -46,
    note: 'Starbucks, restaurants. Personal — out of scope.',
    inScope: false,
  },
  {
    id: 'atm',
    label: 'ATM withdrawals',
    total12mo: -460,
    avgMonthly: -38,
    note: 'Cash withdrawals. Personal — out of scope.',
    inScope: false,
  },
  {
    id: 'personal_hardware',
    label: 'Hardware/marine (debit card)',
    total12mo: -458,
    avgMonthly: -38,
    note: 'Home Depot, Rocky\'s Ace, Three Lantern Marine, Seaside Glass. Mostly per-property work — out of mgmt scope.',
    inScope: false,
  },
];

/**
 * Total in-scope recurring outflow per month based on 12-month averages.
 * Used to back-check the model's expense assumptions.
 */
export const ACTUAL_INSCOPE_AVG_MONTHLY: number = ACTUALS_TRAILING_12MO
  .filter((l) => l.inScope)
  .reduce((s, l) => s + l.avgMonthly, 0);

/**
 * Inflows seen in the 5130 operating account over the 12-month window.
 * For sanity-checking the revenue side of the model.
 */
export const ACTUALS_INFLOWS_TRAILING_12MO = {
  /** Management fees swept from property accounts into operating. */
  mgmt_fee_in: 150508,
  /** Direct deposits from booking platforms (mostly pass-through to owners). */
  platform_revenue: 71894,
  /** Capital infusions from Ryan's Fidelity (when ops needed cushion). */
  capital_infusion: 46000,
  /** Internal transfers from sub-accounts. */
  internal_xfer: 39205,
} as const;

/**
 * Statement window (the dataset this calibration came from).
 * Update when the parser is re-run on a fresh export.
 */
export const ACTUALS_WINDOW = {
  account: 'Chase ...5130 (RT operating)',
  rangeStart: '2024-08-30',
  rangeEnd: '2026-05-04',
  trailing12moStart: '2025-05-01',
  trailing12moEnd: '2026-04-30',
  txCount: 433,
  exportFile: 'Chase5130_Activity_20260506.CSV',
} as const;
