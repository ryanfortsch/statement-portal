/**
 * 2026 business financial model for Rising Tide.
 *
 * Pure functions + constants — no React, no DOM. The /forecast page imports
 * `calcYear` and the typed constants and renders the result.
 *
 * The model layers four revenue streams over a 12-month seasonality curve:
 *   1. CURRENT     — 9 properties already under management
 *   2. PRESIGNED   — 3 contracts signed but not yet onboarded
 *   3. NEW         — N hypothetical adds (the slider — 0 to 10)
 *   4. OWNED       — 3 Rising Tide-owned properties (full revenue, not fee)
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

export type OwnedProperty = {
  name: string;
  /** Annual gross rental revenue, not management fee. */
  rev: number;
  type: SeasonType;
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
 * 3 Rising Tide-owned units — handled separately from the management book
 * because gross revenue (not just the management fee) flows back to the
 * business. These are the three RT treats apart from the owner-statement
 * pipeline:
 *   - 3 Locust         — Cape Ann (Niles Beach), Lucas family
 *   - Lighthouse Point — 3246 NE 27th, Lighthouse Point FL
 *   - 65 Calderwood    — Calderwood Lane, Fairfield CT (less-seasonal)
 */
export const OWNED: OwnedProperty[] = [
  { name: '3 Locust', rev: 25000, type: 'CA' },
  { name: 'Lighthouse Point', rev: 40000, type: 'FL' },
  { name: '65 Calderwood', rev: 25000, type: 'LS' },
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

/** Steady corporate overhead — software, accounting, insurance, etc. */
export const CORP_OVERHEAD_MONTHLY = 4000;
/** Office rent. */
export const OFFICE_RENT_MONTHLY = 750;
/** Dumpster swing — heavier in summer turnover season. */
export const DUMPSTER_WINTER = 50;
export const DUMPSTER_SUMMER = 200;
/** Months considered "winter" (low dumpster cost). */
const WINTER_MONTHS = new Set([11, 12, 1, 2, 3, 4]);
/** Office costs only kick in from March (when the lease begins). */
export const OFFICE_START_MONTH = 3;

/** New hire ($5K/mo) starts in October. */
export const HIRE_MONTHLY = 5000;
export const HIRE_START_MONTH = 10;

/** Personal draw — Ryan's owner draw. Steps up Apr 1. */
export const PERSONAL_LOW = 12000;
export const PERSONAL_HIGH = 21200;
export const PERSONAL_STEP_MONTH = 4;

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function officeCost(month: number): number {
  if (month < OFFICE_START_MONTH) return 0;
  const dumpster = WINTER_MONTHS.has(month) ? DUMPSTER_WINTER : DUMPSTER_SUMMER;
  return OFFICE_RENT_MONTHLY + dumpster;
}

export function personalDraw(month: number): number {
  return month < PERSONAL_STEP_MONTH ? PERSONAL_LOW : PERSONAL_HIGH;
}

export type MonthRow = {
  month: number;
  /** Revenue from the 9 current properties this month. */
  rev_current: number;
  /** Revenue from the 3 pre-signed contracts this month. */
  rev_presigned: number;
  /** Revenue from the N hypothetical new properties this month. */
  rev_new: number;
  /** Revenue from the 3 owned properties (gross, not fee). */
  rev_owned: number;
  /** All revenue combined. */
  rev_total: number;

  exp_corp: number;
  exp_office: number;
  exp_hire: number;
  exp_onboard_presigned: number;
  exp_onboard_new: number;
  exp_total: number;

  /** Revenue minus business expenses, before owner's personal draw. */
  net_business: number;
  /** Personal draw / owner's salary. */
  personal: number;
  /** Net cash flow into the bank — the bottom line. */
  net_cash: number;
};

export type YearResult = {
  monthly: MonthRow[];
  /** Cumulative net cash flow at the end of each month. */
  cumulative: number[];
  /** Months in which a new property comes online (1-12). */
  newStartMonths: number[];
  totals: {
    rev_current: number;
    rev_presigned: number;
    rev_new: number;
    rev_owned: number;
    rev_total: number;
    exp_total: number;
    net_business: number;
    personal: number;
    net_cash: number;
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
    let rev_owned = 0;

    for (const p of CURRENT) {
      if (m >= p.start) rev_current += p.fee * dist[p.type];
    }
    for (const p of PRESIGNED) {
      if (m >= p.start) rev_presigned += p.fee * dist[p.type];
    }
    for (const start of newStartMonths) {
      if (m >= start) rev_new += NEW_PROPERTY_FEE * SEASON[NEW_PROPERTY_TYPE][i];
    }
    for (const p of OWNED) {
      rev_owned += p.rev * dist[p.type];
    }

    const rev_total = Math.round(rev_current + rev_presigned + rev_new + rev_owned);

    const exp_corp = CORP_OVERHEAD_MONTHLY;
    const exp_office = officeCost(m);
    const exp_hire = m >= HIRE_START_MONTH ? HIRE_MONTHLY : 0;
    const exp_onboard_presigned = PRESIGNED_ONBOARD_MONTHS.includes(m) ? ONBOARDING_COST : 0;
    const exp_onboard_new = newStartMonths.includes(m) ? ONBOARDING_COST : 0;
    const exp_total = exp_corp + exp_office + exp_hire + exp_onboard_presigned + exp_onboard_new;

    const net_business = rev_total - exp_total;
    const personal = personalDraw(m);
    const net_cash = net_business - personal;

    monthly.push({
      month: m,
      rev_current: Math.round(rev_current),
      rev_presigned: Math.round(rev_presigned),
      rev_new: Math.round(rev_new),
      rev_owned: Math.round(rev_owned),
      rev_total,
      exp_corp,
      exp_office,
      exp_hire,
      exp_onboard_presigned,
      exp_onboard_new,
      exp_total,
      net_business,
      personal,
      net_cash,
    });
  }

  let running = 0;
  const cumulative = monthly.map((r) => {
    running += r.net_cash;
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
      rev_owned: sum('rev_owned'),
      rev_total: sum('rev_total'),
      exp_total: sum('exp_total'),
      net_business: sum('net_business'),
      personal: sum('personal'),
      net_cash: sum('net_cash'),
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
