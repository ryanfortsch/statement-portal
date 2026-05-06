/**
 * 2026 management-business financial model for Rising Tide.
 *
 * Pure functions + constants — no React, no DOM. The /forecast page imports
 * `calcYear` and the typed constants and renders the result.
 *
 * Scope of the model: only the property-management business. Three things
 * are deliberately OUT of scope:
 *   - RT-owned units (3 Locust, Lighthouse Point, 65 Calderwood) — those
 *     have their own P&L, not relevant to "what does another mgmt
 *     contract do for us?"
 *   - Personal owner draw — modeled separately by Ryan/Dotti.
 *   - Federal/state taxes, capex, distributions.
 *
 * Three revenue streams layer over a 12-month seasonality curve:
 *   1. CURRENT     — 9 properties already under management
 *   2. PRESIGNED   — 3 contracts signed but not yet onboarded
 *   3. NEW         — N hypothetical adds (the slider — 0 to 10)
 *
 * Each property carries a `type` that selects one of three seasonality
 * curves (CA = Cape Ann, FL = Florida, LS = less-seasonal / inland), and a
 * `start` month so partial-year onboardings are pro-rated correctly.
 */

export type SeasonType = 'CA' | 'FL' | 'LS';

export type ManagedProperty = {
  name: string;
  /** Annual management fee in dollars (what RT collects, not gross rent). */
  fee: number;
  type: SeasonType;
  /** First month (1-12) the property contributes revenue. */
  start: number;
};

/** 9 properties currently under management as of Jan 2026. */
export const CURRENT: ManagedProperty[] = [
  { name: 'Brier Neck', fee: 21359, type: 'CA', start: 1 },
  { name: 'Beverly', fee: 20500, type: 'LS', start: 1 },
  { name: 'The Neck', fee: 23000, type: 'CA', start: 1 },
  { name: 'Woodward', fee: 22405, type: 'CA', start: 1 },
  { name: 'Rocky Neck', fee: 27500, type: 'CA', start: 1 },
  { name: 'Hammond', fee: 18750, type: 'CA', start: 1 },
  { name: 'Smith Cove', fee: 24375, type: 'CA', start: 1 },
  { name: 'Beach Road', fee: 44000, type: 'CA', start: 2 },
  { name: 'Rockport AVH', fee: 32500, type: 'CA', start: 1 },
];

/** 3 contracts signed but not yet onboarded — start in Apr / Jun / Jul. */
export const PRESIGNED: ManagedProperty[] = [
  { name: 'Pre-signed #1', fee: 25000, type: 'CA', start: 4 },
  { name: 'Pre-signed #2', fee: 25000, type: 'CA', start: 6 },
  { name: 'Pre-signed #3', fee: 25000, type: 'CA', start: 7 },
];

/**
 * Order in which hypothetical new properties come online. Months are spread
 * across the year, weighted toward the spring/early-summer onboarding window
 * (Mar/May/Jun/Aug) since that's when owners typically engage.
 */
export const NEW_PROPERTY_ORDER = [3, 5, 6, 8, 10, 2, 4, 7, 9, 11, 1, 12] as const;

/** Each new property is assumed to be a Cape Ann management contract at $25K/yr. */
export const NEW_PROPERTY_FEE = 25000;
export const NEW_PROPERTY_TYPE: SeasonType = 'CA';

/** Seasonality curves — raw weights, normalized at module load. */
const CA_RAW = [30 / 7, 30 / 7, 30 / 7, 30 / 7, 30 / 7, 10, 20, 20, 10, 10, 30 / 7, 30 / 7];
const FL_RAW = [15, 15, 12, 10, 8, 6, 5, 5, 5, 5, 5, 9];
const LS_RAW = [7, 7, 7, 7, 8, 9, 12, 12, 9, 8, 7, 7];

function normalize(arr: readonly number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0);
  return arr.map((x) => x / sum);
}

export const SEASON: Record<SeasonType, number[]> = {
  CA: normalize(CA_RAW),
  FL: normalize(FL_RAW),
  LS: normalize(LS_RAW),
};

/** Onboarding cost per pre-signed contract, paid the month it goes live. */
export const ONBOARDING_COST = 3000;
/** Months the 3 pre-signed contracts trigger onboarding cost. */
export const PRESIGNED_ONBOARD_MONTHS = [4, 6, 7];

/* --------------------------------------------------------------------- */
/* Recurring monthly expenses, calibrated to Chase ...5130 actuals       */
/* (Apr 2025 → Apr 2026, 12-mo window). See forecast-actuals.ts.         */
/* --------------------------------------------------------------------- */

/** Office rent at 85 Eastern Ave. Confirmed: 3 ACHs of $750 in 2026. */
export const OFFICE_RENT_MONTHLY = 750;
/** Dumpster swing — heavier in summer turnover season. */
export const DUMPSTER_WINTER = 50;
export const DUMPSTER_SUMMER = 200;
/** Months considered "winter" (low dumpster cost). */
const WINTER_MONTHS = new Set([11, 12, 1, 2, 3, 4]);
/** Office costs only kick in from March (when the lease begins). */
export const OFFICE_START_MONTH = 3;

/** Software subs (Gusto + Allie's CC + buffer for AppFolio/PMS). */
export const SOFTWARE_MONTHLY = 200;

/** MH Partners debt service. Bank shows steady ~$1,000/mo. */
export const DEBT_SERVICE_MONTHLY = 1000;

/** Insurance (Phillips). Annual $5,264 → smoothed to ~$440/mo. */
export const INSURANCE_MONTHLY = 440;

/** Accounting (MS Consultants). ~$8,600/yr → smoothed to ~$720/mo. */
export const ACCOUNTING_MONTHLY = 720;

/** Bank fees, stop payments, returned checks. */
export const BANK_FEES_MONTHLY = 100;

/**
 * Operating CC pass-through. The single biggest line in the bank data
 * (median $5.9K/mo, mean $6.8K/mo over trailing 12 mo). Likely a mix of
 * SaaS subs not on ACH, supplies, marketing, and some property-level
 * spend. Needs CC-statement decomposition someday — for now, conservative
 * median estimate.
 */
export const CC_OPERATING_MONTHLY = 5900;

/**
 * New hire ($5K/mo) starts in October. Calibrated against actuals: payroll
 * ran ~$3.5K/mo Apr-Oct 2025 + Maggie Butler $2.6K/mo Oct-Dec 2025; the
 * combined run-rate when fully staffed was ~$6K/mo. $5K is a conservative
 * mid-point for the new role.
 */
export const HIRE_MONTHLY = 5000;
export const HIRE_START_MONTH = 10;

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function officeCost(month: number): number {
  if (month < OFFICE_START_MONTH) return 0;
  const dumpster = WINTER_MONTHS.has(month) ? DUMPSTER_WINTER : DUMPSTER_SUMMER;
  return OFFICE_RENT_MONTHLY + dumpster;
}

export type MonthRow = {
  month: number;
  /** Revenue from the 9 current properties this month. */
  rev_current: number;
  /** Revenue from the 3 pre-signed contracts this month. */
  rev_presigned: number;
  /** Revenue from the N hypothetical new properties this month. */
  rev_new: number;
  /** All revenue combined. */
  rev_total: number;

  /** Office rent + dumpster (from March). */
  exp_office: number;
  /** Software subscriptions (Gusto + AppFolio/PMS + Allie CC). */
  exp_software: number;
  /** MH Partners debt service. */
  exp_debt: number;
  /** Insurance (Phillips), smoothed monthly. */
  exp_insurance: number;
  /** Accounting (MS Consultants), smoothed monthly. */
  exp_accounting: number;
  /** Bank fees, stop payments, returned checks. */
  exp_bank: number;
  /** Operating CC pass-through (median of trailing 12 mo). */
  exp_cc_ops: number;
  /** New hire from Oct. */
  exp_hire: number;
  /** $3K onboarding for the 3 pre-signed contracts (Apr/Jun/Jul). */
  exp_onboard_presigned: number;
  /** $3K onboarding for each new property added via the slider. */
  exp_onboard_new: number;
  /** Sum of all the above. */
  exp_total: number;

  /** Revenue minus business expenses — the bottom line for this model. */
  net_business: number;
};

export type YearResult = {
  monthly: MonthRow[];
  /** Cumulative net business income at the end of each month. */
  cumulative: number[];
  /** Months in which a new property comes online (1-12). */
  newStartMonths: number[];
  totals: {
    rev_current: number;
    rev_presigned: number;
    rev_new: number;
    rev_total: number;
    exp_total: number;
    net_business: number;
  };
};

/**
 * Compute the 12-month forecast for a given count of hypothetical new
 * properties. `numNew` is clamped to 0-10.
 */
export function calcYear(numNew: number): YearResult {
  const n = Math.max(0, Math.min(10, Math.round(numNew)));
  const newStartMonths: number[] = NEW_PROPERTY_ORDER.slice(0, n);

  const monthly: MonthRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const i = m - 1;
    const dist = { CA: SEASON.CA[i], FL: SEASON.FL[i], LS: SEASON.LS[i] };

    let rev_current = 0;
    let rev_presigned = 0;
    let rev_new = 0;

    for (const p of CURRENT) {
      if (m >= p.start) rev_current += p.fee * dist[p.type];
    }
    for (const p of PRESIGNED) {
      if (m >= p.start) rev_presigned += p.fee * dist[p.type];
    }
    for (const start of newStartMonths) {
      if (m >= start) rev_new += NEW_PROPERTY_FEE * SEASON[NEW_PROPERTY_TYPE][i];
    }

    const rev_total = Math.round(rev_current + rev_presigned + rev_new);

    const exp_office = officeCost(m);
    const exp_software = SOFTWARE_MONTHLY;
    const exp_debt = DEBT_SERVICE_MONTHLY;
    const exp_insurance = INSURANCE_MONTHLY;
    const exp_accounting = ACCOUNTING_MONTHLY;
    const exp_bank = BANK_FEES_MONTHLY;
    const exp_cc_ops = CC_OPERATING_MONTHLY;
    const exp_hire = m >= HIRE_START_MONTH ? HIRE_MONTHLY : 0;
    const exp_onboard_presigned = PRESIGNED_ONBOARD_MONTHS.includes(m) ? ONBOARDING_COST : 0;
    const exp_onboard_new = newStartMonths.includes(m) ? ONBOARDING_COST : 0;
    const exp_total =
      exp_office +
      exp_software +
      exp_debt +
      exp_insurance +
      exp_accounting +
      exp_bank +
      exp_cc_ops +
      exp_hire +
      exp_onboard_presigned +
      exp_onboard_new;

    const net_business = rev_total - exp_total;

    monthly.push({
      month: m,
      rev_current: Math.round(rev_current),
      rev_presigned: Math.round(rev_presigned),
      rev_new: Math.round(rev_new),
      rev_total,
      exp_office,
      exp_software,
      exp_debt,
      exp_insurance,
      exp_accounting,
      exp_bank,
      exp_cc_ops,
      exp_hire,
      exp_onboard_presigned,
      exp_onboard_new,
      exp_total,
      net_business,
    });
  }

  let running = 0;
  const cumulative = monthly.map((r) => {
    running += r.net_business;
    return running;
  });

  const sum = (k: keyof MonthRow) => monthly.reduce((a, r) => a + (r[k] as number), 0);

  return {
    monthly,
    cumulative,
    newStartMonths: [...newStartMonths],
    totals: {
      rev_current: sum('rev_current'),
      rev_presigned: sum('rev_presigned'),
      rev_new: sum('rev_new'),
      rev_total: sum('rev_total'),
      exp_total: sum('exp_total'),
      net_business: sum('net_business'),
    },
  };
}

/**
 * Format an integer as `$1,234` or `($1,234)` for negatives. Use for display
 * cells where a dollar sign is desired.
 */
export function fmtDollar(n: number): string {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded).toLocaleString();
  return rounded < 0 ? `($${abs})` : `$${abs}`;
}

/** Format an integer with thousands separators, no dollar sign. */
export function fmtNum(n: number): string {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded).toLocaleString();
  return rounded < 0 ? `(${abs})` : abs;
}

/** Format as `$1.2K` for compact bar labels. */
export function fmtCompact(n: number): string {
  const k = Math.round(n / 100) / 10;
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(k)}K`;
}
