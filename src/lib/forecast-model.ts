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

/** Years the model can render. */
export type ForecastYear = 2026 | 2027;

/** 9 properties currently under management as of Jan 2026. */
export const CURRENT_2026: ManagedProperty[] = [
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

/**
 * 5 contracts signed but not yet fully onboarded.
 *   - 3 originally pre-signed (Apr/Jun/Jul). Now rescheduled to May/Jun.
 *   - 79 Main Street: signed; live end of May.
 *   - 16 Waterman: signing this week; live in June.
 */
export const PRESIGNED_2026: ManagedProperty[] = [
  { name: 'Pre-signed #1', fee: 25000, type: 'CA', start: 5 },
  { name: 'Pre-signed #2', fee: 25000, type: 'CA', start: 6 },
  { name: 'Pre-signed #3', fee: 25000, type: 'CA', start: 6 },
  { name: '79 Main Street', fee: 25000, type: 'CA', start: 5 },
  { name: '16 Waterman', fee: 25000, type: 'CA', start: 6 },
];

/**
 * In 2027 the 9 current + 5 pre-signed all roll forward as fully active
 * full-year contracts (start month 1).
 */
export const ACTIVE_2027: ManagedProperty[] = [
  ...CURRENT_2026.map((p) => ({ ...p, start: 1 })),
  ...PRESIGNED_2026.map((p) => ({ ...p, start: 1 })),
];

/**
 * Order in which hypothetical new 2026 properties come online. Sprinkled
 * across June-Dec since pre-signed already saturate May-June. Default
 * count = 3 → first three slots: Jul, Sep, Nov (evenly spread).
 */
export const NEW_ORDER_2026 = [7, 9, 11, 6, 8, 10, 12] as const;

/**
 * 2027 — new properties can land any month. Defaults Mar, Jun, Sep for
 * the first 3, then fill in Q1/Q4 as the count goes up.
 */
export const NEW_ORDER_2027 = [3, 6, 9, 1, 5, 7, 11, 4, 8, 10, 12, 2] as const;

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

/** Onboarding cost per contract, paid the month it goes live. */
export const ONBOARDING_COST = 3000;

/* --------------------------------------------------------------------- */
/* Recurring monthly expenses, calibrated to Chase ...5130 actuals       */
/* (Apr 2025 → Apr 2026, 12-mo window). See forecast-actuals.ts.         */
/* --------------------------------------------------------------------- */

/** Office rent at 85 Eastern Ave. Confirmed: 3 ACHs of $750 in 2026. */
export const OFFICE_RENT_MONTHLY = 750;
/** Dumpster — flat $50/mo year-round (no summer surcharge). */
export const DUMPSTER_MONTHLY = 50;
/** Office costs only kick in from March (when the lease begins). */
export const OFFICE_START_MONTH = 3;

/** Software subs (Gusto + Allie's CC + buffer for AppFolio/PMS). */
export const SOFTWARE_MONTHLY = 200;

/**
 * MH Partners — RT's outside bookkeeper. Steady ~$1,000/mo retainer
 * through April 2026, with a final $1,800 wrap-up payment in May 2026.
 * Zero from June 2026 onward (engagement ends).
 */
export const BOOKKEEPER_MONTHLY = 1000;
/** Final month bookkeeper is paid (1-12). May 2026 — engagement winds down. */
export const BOOKKEEPER_LAST_MONTH = 5;
/** Larger final payment in the wrap-up month. */
export const BOOKKEEPER_FINAL_AMOUNT = 1800;

/**
 * Insurance (Phillips). Annual policy paid as a single lump sum in March.
 * 2026: $5,263.92 was paid 03/02/2026 (already in the actuals).
 * 2027: model assumes the same March renewal at the same amount.
 */
export const INSURANCE_ANNUAL = 5264;
export const INSURANCE_MONTH = 3;

/**
 * Accounting — historically MS Consultants. The $4,442.96 paid 4/15/2026
 * was a one-time engagement; not recurring. Forward run rate is $0.
 */
export const ACCOUNTING_MONTHLY = 0;

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

export function officeCost(month: number, startMonth: number): number {
  if (month < startMonth) return 0;
  return OFFICE_RENT_MONTHLY + DUMPSTER_MONTHLY;
}

/**
 * Bookkeeper cost for a given month under a given year config. Returns
 * the regular retainer through the wrap-up month, the larger final
 * payment in that month, and zero after.
 */
export function bookkeeperCost(month: number, lastMonth: number | null): number {
  if (lastMonth == null) return 0; // engagement already ended (e.g. 2027)
  if (month < lastMonth) return BOOKKEEPER_MONTHLY;
  if (month === lastMonth) return BOOKKEEPER_FINAL_AMOUNT;
  return 0;
}

/**
 * Per-year configuration. `getYearConfig(2026)` returns the layout used by
 * the live model — 9 current + 5 pre-signed (May/Jun) + N new (Jun-Dec).
 * `getYearConfig(2027)` returns 14 active props (the 9 + 5 ex-presigned
 * carried forward) + N new spread across the year, no debt service, hire
 * continues all year.
 */
export type YearConfig = {
  year: ForecastYear;
  /** Properties already producing revenue this year. */
  current: ManagedProperty[];
  /** Properties signed but onboarding mid-year. Empty in 2027. */
  presigned: ManagedProperty[];
  /** Order in which the slider adds new properties this year. */
  newOrder: readonly number[];
  /** Last month bookkeeper retainer is paid (1-12), or null if engagement ended. */
  bookkeeperLastMonth: number | null;
  /** First month new hire shows up in the budget (1-12). */
  hireStartMonth: number;
  /** First month office rent kicks in (1 if continuous from prior year). */
  officeStartMonth: number;
};

export function getYearConfig(year: ForecastYear): YearConfig {
  if (year === 2026) {
    return {
      year: 2026,
      current: CURRENT_2026,
      presigned: PRESIGNED_2026,
      newOrder: NEW_ORDER_2026,
      bookkeeperLastMonth: 5, // MH Partners final $1,800 in May 2026
      hireStartMonth: 10, // Hire starts Oct 2026
      officeStartMonth: 3, // Office lease started Mar 2026
    };
  }
  return {
    year: 2027,
    current: ACTIVE_2027,
    presigned: [],
    newOrder: NEW_ORDER_2027,
    bookkeeperLastMonth: null, // Engagement ended May 2026
    hireStartMonth: 1, // Hire continues from 2026
    officeStartMonth: 1, // Office continues from 2026
  };
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

  /**
   * True when this row's numbers are actual bank-derived data (a past
   * month with a complete record) rather than the model's projection.
   */
  is_actual: boolean;
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

/** Optional actuals override for past months. Index = month - 1. */
export type ActualsByMonth = ReadonlyArray<{
  month: string; // YYYY-MM
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
}>;

/**
 * Optional forward-month override sourced from the Smart Forecast (Guesty
 * bookings × Gloucester pacing × per-property mgmt fee). When provided,
 * the model uses these numbers for rev_current+rev_presigned in forward
 * months instead of the seasonality heuristic. rev_new from the slider
 * still adds on top.
 *
 * Map: month-of-year (1-12) → total RT mgmt fee for that month across
 * all properties already on Guesty.
 */
export type SmartForwardOverride = ReadonlyMap<number, number>;

/**
 * Compute the 12-month forecast for a given year and count of hypothetical
 * new properties. `numNew` is clamped to [0, length of that year's
 * newOrder array].
 *
 * `actuals` (optional): when provided alongside `actualsThroughMonth`, the
 * model substitutes real bank-derived values for months 1..actualsThroughMonth
 * and projects from `actualsThroughMonth + 1` onward. The substituted
 * MonthRow has `is_actual: true`.
 */
export function calcYear(
  numNew: number,
  year: ForecastYear = 2026,
  actuals?: ActualsByMonth,
  actualsThroughMonth?: number,
  smartOverride?: SmartForwardOverride
): YearResult {
  const config = getYearConfig(year);
  const maxNew = config.newOrder.length;
  const n = Math.max(0, Math.min(maxNew, Math.round(numNew)));
  const newStartMonths: number[] = config.newOrder.slice(0, n);
  const useActualsThrough = actuals && actualsThroughMonth ? actualsThroughMonth : 0;

  const monthly: MonthRow[] = [];
  for (let m = 1; m <= 12; m++) {
    // ─── Past month: use bank-derived actuals ──────────────────────────
    if (m <= useActualsThrough && actuals && actuals[m - 1]) {
      const a = actuals[m - 1];
      const exp_total =
        a.exp_office +
        a.exp_software +
        a.exp_debt +
        a.exp_insurance +
        a.exp_accounting +
        a.exp_bank +
        a.exp_cc_ops +
        a.exp_hire +
        a.exp_onboard_presigned +
        a.exp_onboard_new;
      monthly.push({
        month: m,
        rev_current: a.revenue, // attribute everything to current portfolio
        rev_presigned: 0,
        rev_new: 0,
        rev_total: a.revenue,
        exp_office: a.exp_office,
        exp_software: a.exp_software,
        exp_debt: a.exp_debt,
        exp_insurance: a.exp_insurance,
        exp_accounting: a.exp_accounting,
        exp_bank: a.exp_bank,
        exp_cc_ops: a.exp_cc_ops,
        exp_hire: a.exp_hire,
        exp_onboard_presigned: a.exp_onboard_presigned,
        exp_onboard_new: a.exp_onboard_new,
        exp_total,
        net_business: a.revenue - exp_total,
        is_actual: true,
      });
      continue;
    }

    // ─── Future month: project from the model ──────────────────────────
    const i = m - 1;
    const dist = { CA: SEASON.CA[i], FL: SEASON.FL[i], LS: SEASON.LS[i] };

    // If we have a Smart Forecast value for this month, that becomes
    // rev_current — booked + projected from real Guesty data, with each
    // property's actual mgmt fee. Pre-signed contracts run through
    // seasonality regardless: they aren't in Guesty until they actually
    // onboard, so smart forecast can't see them yet. If a presigned shows
    // up in Guesty later, it'll start contributing through smart and the
    // model will overcount — flag for review when that happens.
    const smartFee = smartOverride?.get(m);
    const useSmart = smartFee != null && smartFee > 0;

    let rev_current = 0;
    let rev_presigned = 0;
    let rev_new = 0;

    if (useSmart) {
      // Smart Forecast owns the current 9 portfolio. Presigned + new
      // remain on seasonality because they aren't in Guesty yet.
      rev_current = smartFee;
    } else {
      // No smart data — fall back to seasonality for current too.
      for (const p of config.current) {
        if (m >= p.start) rev_current += p.fee * dist[p.type];
      }
    }
    // Pre-signed contracts: always seasonality (none in Guesty yet).
    for (const p of config.presigned) {
      if (m >= p.start) rev_presigned += p.fee * dist[p.type];
    }
    // N new (slider) properties: always seasonality (hypothetical).
    for (const start of newStartMonths) {
      if (m >= start) rev_new += NEW_PROPERTY_FEE * SEASON[NEW_PROPERTY_TYPE][i];
    }

    const rev_total = Math.round(rev_current + rev_presigned + rev_new);

    // Count contracts whose start month equals this month → multiply by
    // the per-contract onboarding cost. This handles the case where two
    // pre-signeds land the same month (e.g. May 2026 has two starts).
    const presignedStartCount = config.presigned.filter((p) => p.start === m).length;
    const newStartCount = newStartMonths.filter((s) => s === m).length;

    const exp_office = officeCost(m, config.officeStartMonth);
    const exp_software = SOFTWARE_MONTHLY;
    const exp_debt = bookkeeperCost(m, config.bookkeeperLastMonth);
    const exp_insurance = m === INSURANCE_MONTH ? INSURANCE_ANNUAL : 0;
    const exp_accounting = ACCOUNTING_MONTHLY;
    const exp_bank = BANK_FEES_MONTHLY;
    const exp_cc_ops = CC_OPERATING_MONTHLY;
    const exp_hire = m >= config.hireStartMonth ? HIRE_MONTHLY : 0;
    const exp_onboard_presigned = presignedStartCount * ONBOARDING_COST;
    const exp_onboard_new = newStartCount * ONBOARDING_COST;
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
      is_actual: false,
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
