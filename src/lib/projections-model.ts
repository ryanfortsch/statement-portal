/**
 * Compute layer for the Projections module. Pure functions, no IO.
 *
 * Mirrors Rising_Tide_Property_Analyzer vF.xlsx exactly:
 *   1. Method 1 — Tiered Percentage Rule: home value × tier rate
 *   2. Method 2 — AirDNA 3-Year Average: market × bedroom × trailing 3 years
 *   3. Blended Gross Revenue = average of methods 1 and 2
 *   4. Year 1 Low/Mid/High = blended × 0.9 / 1.0 / 1.1
 *   5. Year 1 Ramped = applies a start-month ramp curve (0.2 → 0.5 → 1.0) to Mid
 *   6. Year 2 = Year 1 Mid × (1 + year2_growth_pct)
 *   7. Monthly forecast = annual × seasonality % from the AirDNA history
 *
 * Cleaning is a fixed expense in the spreadsheet model:
 *   (base_cleaning + max(0, bedrooms - 2) × addl_per_br) × turnovers_per_year
 * The PDF disclaimer notes cleaning is a pass-through to guests; here it sits
 * in the math because the deliverable's "net payout" is gross-of-cleaning.
 */

import { AIRDNA, type AirDnaMarket, type AirDnaMonth } from './projections-airdna';
import { type ProjectionRow, VALUE_TIERS } from './projections-types';

export type Money = number;

export type PayoutBreakdown = {
  grossRevenue: Money;
  managementFee: Money;
  cleaningExpense: Money;
  netPayout: Money;
};

export type MonthRow = {
  monthIndex: number;     // 0 = Jan
  monthLabel: string;     // 'Jan'
  rampMultiplier: number; // 0, 0.2, 0.5, or 1
  grossRevenue: Money;
  managementFee: Money;
  cleaningExpense: Money;
  netPayout: Money;
};

export type ProjectionComputed = {
  // Inputs echoed for convenience
  inputs: ProjectionRow;

  // Method 1
  tieredRate: number;
  tieredRevenue: Money;

  // Method 2 (annual totals per year, then 3-yr average)
  airdnaYears: { year: number; total: number }[];
  airdna3YrAvg: Money;

  // Blended
  blendedGrossRevenue: Money;

  // Year 1 (full year, no ramp) — Low / Mid / High
  year1: { low: PayoutBreakdown; mid: PayoutBreakdown; high: PayoutBreakdown };

  // Year 1 ramped — applies start_month ramp to Mid only
  year1Ramped: PayoutBreakdown & {
    activeMonthCount: number;
    effectiveAnnualizedMultiplier: number;
  };

  // Year 2 (full year, no ramp, +growth_pct on Year 1 Mid)
  year2: PayoutBreakdown;

  // Monthly arrays
  seasonality: number[];                  // 12 entries summing to ~1.0
  monthlyYear1: MonthRow[];               // full year, no ramp (Year 1 Perf chart)
  monthlyYear1Ramped: MonthRow[];         // with ramp applied (Launch ramp slide)
  monthlyYear2: MonthRow[];               // full year

  // Hero range used on the cover page
  heroLow: Money;
  heroHigh: Money;

  // Monthly averages used on the Performance pages
  year1MonthlyAvg: Money; // full Year 1 Mid ÷ 12 (steady-state)
  year2MonthlyAvg: Money; // Year 2 ÷ 12

  // Market comparison ladder for the Year 1 page (avg by BR in the chosen market)
  marketComparison: { bedrooms: number; revenue: number }[];
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Year 1 ramp curve: at the start month and the next two months, scale up. */
const RAMP_CURVE = [0.2, 0.5, 1.0];

// ─── Bedroom column accessor (1..6+ → AirDnaMonth field) ────────────────────
function bedroomKey(br: number): keyof AirDnaMonth {
  const clamped = Math.max(1, Math.min(6, br));
  if (clamped >= 6) return 'br6plus';
  return (`br${clamped}` as keyof AirDnaMonth);
}

function airdnaValue(row: AirDnaMonth, br: number): number {
  const v = row[bedroomKey(br)];
  return typeof v === 'number' ? v : 0;
}

// ─── Method 1: Tiered % Rule ────────────────────────────────────────────────
export function tieredRate(homeValue: number): number {
  for (const t of VALUE_TIERS) {
    if (homeValue >= t.min && homeValue <= t.max) return t.rate;
  }
  return 0;
}

// ─── Method 2: AirDNA 3-Year Average ────────────────────────────────────────
/**
 * Sum of the 12 monthly values for the given market+bedrooms within `year`.
 * Returns null if the year isn't fully present in the AirDNA series.
 */
function annualAirdnaTotal(market: AirDnaMarket, br: number, year: number): number | null {
  const rows = AIRDNA[market].filter((r) => r.date.startsWith(`${year}-`));
  if (rows.length < 12) return null;
  return rows.reduce((s, r) => s + airdnaValue(r, br), 0);
}

/**
 * Trailing-three-year window ending at the latest year for which we have a
 * full 12 months of AirDNA data. Mirrors the spreadsheet's 2023/2024/2025 window.
 */
function airdnaThreeYearWindow(market: AirDnaMarket, br: number) {
  const dates = AIRDNA[market].map((r) => r.date);
  const lastFullYear = (() => {
    const years = new Map<number, number>();
    for (const d of dates) {
      const y = Number(d.slice(0, 4));
      years.set(y, (years.get(y) ?? 0) + 1);
    }
    let best = 0;
    for (const [y, count] of years) {
      if (count >= 12 && y > best) best = y;
    }
    return best;
  })();
  if (!lastFullYear) return { years: [] as { year: number; total: number }[], avg: 0 };
  const years: { year: number; total: number }[] = [];
  for (let y = lastFullYear - 2; y <= lastFullYear; y++) {
    const total = annualAirdnaTotal(market, br, y);
    if (total != null) years.push({ year: y, total });
  }
  const avg = years.length ? years.reduce((s, x) => s + x.total, 0) / years.length : 0;
  return { years, avg };
}

// ─── Seasonality (% of annual total per month, 3-yr window) ────────────────
function airdnaSeasonality(market: AirDnaMarket, br: number, lastFullYear: number): number[] {
  const months = Array(12).fill(0);
  let counted = 0;
  for (let y = lastFullYear - 2; y <= lastFullYear; y++) {
    for (let m = 0; m < 12; m++) {
      const date = `${y}-${String(m + 1).padStart(2, '0')}`;
      const row = AIRDNA[market].find((r) => r.date === date);
      if (!row) continue;
      months[m] += airdnaValue(row, br);
    }
    counted++;
  }
  if (counted === 0) return Array(12).fill(1 / 12);
  // Average each month across the years, then normalize to 1.0
  const avgMonths = months.map((m) => m / counted);
  const total = avgMonths.reduce((s, x) => s + x, 0);
  return total > 0 ? avgMonths.map((m) => m / total) : Array(12).fill(1 / 12);
}

// ─── Cleaning expense (annual) ──────────────────────────────────────────────
/**
 * Per-turnover cleaning fees stay in a $200–$325 range across Rising Tide's
 * portfolio. The base + per-BR formula scales naturally for 2–4BR but would
 * generate $350+ for 5+BR properties without a cap. Bound the per-turn value
 * to MAX_CLEANING_PER_TURN so projections never advertise above-market
 * cleaning expenses.
 */
const MAX_CLEANING_PER_TURN = 325;

function annualCleaning(input: Pick<ProjectionRow, 'base_cleaning' | 'addl_cleaning_per_br' | 'bedrooms' | 'turnovers_per_year'>): Money {
  const formulaPerTurn = input.base_cleaning + Math.max(0, input.bedrooms - 2) * input.addl_cleaning_per_br;
  const perTurn = Math.min(MAX_CLEANING_PER_TURN, formulaPerTurn);
  return perTurn * input.turnovers_per_year;
}

// ─── Single-year payout breakdown given a gross revenue ─────────────────────
function payoutFor(grossRevenue: Money, mgmtFeePct: number, cleaning: Money): PayoutBreakdown {
  const managementFee = grossRevenue * mgmtFeePct;
  return {
    grossRevenue,
    managementFee,
    cleaningExpense: cleaning,
    netPayout: grossRevenue - managementFee - cleaning,
  };
}

// ─── Market comparison (avg annual by BR in chosen market) ──────────────────
function marketComparison(market: AirDnaMarket): { bedrooms: number; revenue: number }[] {
  const out: { bedrooms: number; revenue: number }[] = [];
  for (let br = 1; br <= 6; br++) {
    const { avg } = airdnaThreeYearWindow(market, br);
    out.push({ bedrooms: br, revenue: avg });
  }
  return out;
}

// ─── Year 1 ramp helper ─────────────────────────────────────────────────────
/**
 * For each calendar month (0..11), return the ramp multiplier given the
 * property's start_month (1..12). Months before start = 0; the start month
 * and next two follow RAMP_CURVE; everything after = 1.0.
 */
function rampMultipliers(startMonth1Indexed: number): number[] {
  const start = Math.max(1, Math.min(12, startMonth1Indexed)) - 1; // 0..11
  return Array.from({ length: 12 }, (_, m) => {
    if (m < start) return 0;
    const into = m - start;
    if (into < RAMP_CURVE.length) return RAMP_CURVE[into];
    return 1;
  });
}

// ─── The main entrypoint ────────────────────────────────────────────────────
export function computeProjection(inputs: ProjectionRow): ProjectionComputed {
  // Method 1
  const tRate = tieredRate(inputs.home_value);
  const tRevenue = inputs.home_value * tRate;

  // Method 2
  const { years: airdnaYears, avg: airdna3YrAvg } = airdnaThreeYearWindow(inputs.market, inputs.bedrooms);
  const lastFullYear = airdnaYears.length ? airdnaYears[airdnaYears.length - 1].year : 0;
  const seasonality = lastFullYear ? airdnaSeasonality(inputs.market, inputs.bedrooms, lastFullYear) : Array(12).fill(1 / 12);

  // Blended (or override)
  const blendedGrossRevenue = (tRevenue + airdna3YrAvg) / 2;

  const overrideLow = inputs.revenue_override_low;
  const overrideHigh = inputs.revenue_override_high;
  const grossLow = overrideLow ?? blendedGrossRevenue * 0.9;
  const grossMid = (overrideLow != null && overrideHigh != null)
    ? (overrideLow + overrideHigh) / 2
    : blendedGrossRevenue;
  const grossHigh = overrideHigh ?? blendedGrossRevenue * 1.1;

  const cleaning = annualCleaning(inputs);

  const year1Low = payoutFor(grossLow, inputs.mgmt_fee_pct, cleaning);
  const year1Mid = payoutFor(grossMid, inputs.mgmt_fee_pct, cleaning);
  const year1High = payoutFor(grossHigh, inputs.mgmt_fee_pct, cleaning);

  // Year 2 (full year, +growth_pct on Year 1 Mid). Spreadsheet behavior:
  // scale the *net* directly (Inputs!F10 × Year 1 net), not the gross. This
  // implicitly assumes cleaning + fees scale with revenue. Matches B30 in
  // Monthly Forecast and gives Dotti the same numbers she sees in the model.
  const year2NetMid = year1Mid.netPayout * (1 + inputs.year2_growth_pct);
  // Back into a consistent gross/fees breakdown for the monthly calc.
  const year2Gross = (year2NetMid + cleaning) / (1 - inputs.mgmt_fee_pct);
  const year2 = payoutFor(year2Gross, inputs.mgmt_fee_pct, cleaning);

  // Year 1 monthly. Compute two parallel arrays:
  //   monthlyYear1       — full year, no ramp. Used on the Year 1 Performance
  //                        slide so the chart and big number reflect the
  //                        property's *run rate* (steady-state earning power).
  //   monthlyYear1Ramped — actual ramp applied when apply_ramp is on (months
  //                        before start = 0, then 0.2 / 0.5 / 1.0). Drives
  //                        the launch-year ramp slide and the year1Ramped
  //                        totals on the prospect detail page.
  // When apply_ramp is off the two arrays are identical.
  // Cleaning splits by *seasonality* not evenly: more turnovers in peak
  // months. Matches spreadsheet C13 = annual_cleaning × seasonality[m].
  const buildMonthly = (ramps: number[]): MonthRow[] =>
    MONTH_LABELS.map((label, m) => {
      const monthGross = grossMid * seasonality[m] * ramps[m];
      const monthMgmt = monthGross * inputs.mgmt_fee_pct;
      const monthClean = cleaning * seasonality[m] * ramps[m];
      return {
        monthIndex: m,
        monthLabel: label,
        rampMultiplier: ramps[m],
        grossRevenue: monthGross,
        managementFee: monthMgmt,
        cleaningExpense: monthClean,
        netPayout: monthGross - monthMgmt - monthClean,
      } satisfies MonthRow;
    });

  const fullRamps = Array(12).fill(1);
  const launchRamps = inputs.apply_ramp ? rampMultipliers(inputs.start_month) : fullRamps;
  const monthlyYear1 = buildMonthly(fullRamps);
  const monthlyYear1Ramped = buildMonthly(launchRamps);

  const rampedTotal = monthlyYear1Ramped.reduce(
    (acc, m) => ({
      grossRevenue: acc.grossRevenue + m.grossRevenue,
      managementFee: acc.managementFee + m.managementFee,
      cleaningExpense: acc.cleaningExpense + m.cleaningExpense,
      netPayout: acc.netPayout + m.netPayout,
    }),
    { grossRevenue: 0, managementFee: 0, cleaningExpense: 0, netPayout: 0 },
  );
  const activeMonthCount = launchRamps.filter((r) => r > 0).length;
  const effectiveAnnualizedMultiplier = launchRamps.reduce((s, r, i) => s + r * seasonality[i], 0);

  // Year 2 monthly forecast — full year, cleaning by seasonality.
  const monthlyYear2 = MONTH_LABELS.map((label, m) => {
    const monthGross = year2Gross * seasonality[m];
    const monthMgmt = monthGross * inputs.mgmt_fee_pct;
    const monthClean = cleaning * seasonality[m];
    return {
      monthIndex: m,
      monthLabel: label,
      rampMultiplier: 1,
      grossRevenue: monthGross,
      managementFee: monthMgmt,
      cleaningExpense: monthClean,
      netPayout: monthGross - monthMgmt - monthClean,
    } satisfies MonthRow;
  });

  // Hero range default: always the full Year 1 run rate (Low → High),
  // regardless of whether ramp is applied. This is what the property earns
  // at full operation. The launch-year ramp story (calendar-year reality)
  // gets its own conditional slide later in the deck so the cover stays
  // focused on the steady-state expectation.
  const heroLow = inputs.hero_low_override ?? year1Low.netPayout;
  const heroHigh = inputs.hero_high_override ?? year1High.netPayout;

  return {
    inputs,
    tieredRate: tRate,
    tieredRevenue: tRevenue,
    airdnaYears,
    airdna3YrAvg,
    blendedGrossRevenue,
    year1: { low: year1Low, mid: year1Mid, high: year1High },
    year1Ramped: { ...rampedTotal, activeMonthCount, effectiveAnnualizedMultiplier },
    year2,
    seasonality,
    monthlyYear1,
    monthlyYear1Ramped,
    monthlyYear2,
    heroLow,
    heroHigh,
    year1MonthlyAvg: year1Mid.netPayout / 12,
    year2MonthlyAvg: year2.netPayout / 12,
    marketComparison: marketComparison(inputs.market),
  };
}

// ─── Formatting helpers used by the form preview and render page ────────────
export function fmtMoney(n: number, opts: { decimals?: number; signed?: boolean } = {}): string {
  const { decimals = 0, signed = false } = opts;
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function fmtMoneyRange(low: number, high: number): string {
  return `${fmtMoney(roundToThousand(low))} - ${fmtMoney(roundToThousand(high))}`;
}

export function roundToThousand(n: number): number {
  return Math.round(n / 1000) * 1000;
}

export function fmtPercent(pct: number, decimals = 0): string {
  return `${(pct * 100).toFixed(decimals)}%`;
}

export function fmtMonthYear(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  if (!y || !m) return yyyymm;
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
}
