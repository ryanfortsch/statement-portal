/**
 * Statement-derived monthly mgmt-fee actuals.
 *
 * Once each month is reconciled in Helm's Statements module, the model
 * should stop projecting that month's revenue and use the real number.
 * This module queries `property_statements`, sums `management_fee` per
 * month across all properties, and returns a map keyed by YYYY-MM.
 *
 * Combined with the bank-derived ACTUALS_2026 baseline:
 *   - Jan-Apr 2026 → bank actuals (full row incl. expenses)
 *   - May+ → statement actuals override revenue, expenses stay projected
 *     until we wire a live expense source
 */

import { supabase, isConfigured } from './supabase';

export type StatementRevenueByMonth = Record<string, number>;

/**
 * Build a period_id → month ("YYYY-MM") map from statement_periods.
 * property_statements carries `period_id`, NOT a denormalized `month`,
 * so every statement query has to resolve the month through here.
 */
async function getPeriodMonthMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await supabase
    .from('statement_periods')
    .select('id, month');
  if (error) {
    console.error('[statement-periods] query failed:', error.message);
    return map;
  }
  for (const p of (data ?? []) as Array<{ id: string | null; month: string | null }>) {
    if (p.id && p.month) map.set(p.id, p.month);
  }
  return map;
}

/**
 * Sum `management_fee` per month across all property_statements. Returns
 * { 'YYYY-MM': totalMgmtFee, … } for every month that has at least one
 * reconciled statement. Month is resolved via statement_periods.
 *
 * Empty map when Supabase isn't configured or the query fails — the
 * forecast falls back to model projection automatically.
 */
export async function getStatementRevenueByMonth(): Promise<StatementRevenueByMonth> {
  if (!isConfigured) return {};
  try {
    const monthByPeriod = await getPeriodMonthMap();

    const { data, error } = await supabase
      .from('property_statements')
      .select('period_id, management_fee');
    if (error) {
      console.error('[forecast-statement-actuals] query failed:', error.message);
      return {};
    }

    const byMonth: StatementRevenueByMonth = {};
    for (const row of (data ?? []) as Array<{ period_id: string | null; management_fee: number | null }>) {
      const month = row.period_id ? monthByPeriod.get(row.period_id) : undefined;
      if (!month) continue;
      const fee = Number(row.management_fee ?? 0);
      if (!fee) continue;
      byMonth[month] = (byMonth[month] ?? 0) + fee;
    }
    return byMonth;
  } catch (err) {
    console.error('[forecast-statement-actuals] threw:', err);
    return {};
  }
}

/**
 * Per-property baseline for the smart forecast.
 *
 *   annualGross    — the property's expected annual rental revenue,
 *     derived from reconciled property_statements. Partial-year history
 *     is extrapolated to a full year via Gloucester seasonality.
 *
 *   monthlyHistory — avg rental_revenue per month-of-year from statements
 *     (kept for diagnostics; the forecast math uses annualGross).
 */
export type PropertyBaseline = {
  annualGross: number;
  monthlyHistory: number[]; // 12 entries, Jan..Dec
};

/**
 * Bundle returned by getPropertyAnnualBaselines: per-property baselines
 * plus a portfolio-wide revenue seasonality curve (share of annual
 * revenue per month-of-year, sums to 1) used by Part B of the forecast.
 */
export type ForecastBaselines = {
  byProperty: Map<string, PropertyBaseline>;
  revenueSeasonality: number[]; // 12 entries, sums to 1
};

// Gloucester seasonality (occupancy share by month-of-year). Pulled
// inline here so we can extrapolate partial-year statement data — if a
// property only has 4 months of closed statements covering Jan-Apr, we
// scale up by 1 / (share of year those 4 months represent) to estimate
// the full annual.
const GLOUCESTER_SEASONALITY = [
  28.35, 46.12, 48.10, 54.09, 54.91, 63.39,
  77.23, 78.77, 55.94, 64.72, 34.87, 36.18,
];
const GLOUCESTER_SUM = GLOUCESTER_SEASONALITY.reduce((s, v) => s + v, 0);

function fallbackRevenueSeasonality(): number[] {
  return GLOUCESTER_SEASONALITY.map((v) => v / GLOUCESTER_SUM);
}

export async function getPropertyAnnualBaselines(): Promise<ForecastBaselines> {
  if (!isConfigured) {
    return { byProperty: new Map(), revenueSeasonality: fallbackRevenueSeasonality() };
  }
  try {
    // property_statements is RT's authoritative reconciled monthly record.
    // Month comes from statement_periods via period_id.
    const monthByPeriod = await getPeriodMonthMap();

    const { data, error } = await supabase
      .from('property_statements')
      .select('property_id, period_id, rental_revenue');
    if (error) {
      console.error('[property-baselines] statements query failed:', error.message);
      return { byProperty: new Map(), revenueSeasonality: fallbackRevenueSeasonality() };
    }

    type Bucket = {
      monthlyHistory: number[];      // index 0..11 = Jan..Dec; accumulates across years if multiple years of statements
      monthlyHistoryCount: number[]; // how many statements contributed to each month
      observedMonths: Set<string>;   // YYYY-MM strings seen for this property
    };
    const byProp = new Map<string, Bucket>();

    // Portfolio-level accumulation for the revenue-seasonality curve.
    const portfolioMonthly = Array(12).fill(0);
    const portfolioMonthlyCount = Array(12).fill(0);

    for (const row of (data ?? []) as Array<{
      property_id: string | null;
      period_id: string | null;
      rental_revenue: number | null;
    }>) {
      if (!row.property_id || !row.period_id) continue;
      const month = monthByPeriod.get(row.period_id);
      if (!month) continue;
      const rev = Number(row.rental_revenue ?? 0);
      if (rev <= 0) continue;
      const monthOfYear = parseInt(month.slice(5, 7), 10) - 1; // 0..11
      if (Number.isNaN(monthOfYear) || monthOfYear < 0 || monthOfYear > 11) continue;

      const bucket = byProp.get(row.property_id) ?? {
        monthlyHistory: Array(12).fill(0),
        monthlyHistoryCount: Array(12).fill(0),
        observedMonths: new Set<string>(),
      };
      bucket.monthlyHistory[monthOfYear] += rev;
      bucket.monthlyHistoryCount[monthOfYear] += 1;
      bucket.observedMonths.add(month);
      byProp.set(row.property_id, bucket);

      portfolioMonthly[monthOfYear] += rev;
      portfolioMonthlyCount[monthOfYear] += 1;
    }

    // Portfolio revenue seasonality: avg rental_revenue per month-of-year
    // across all properties / years, normalized to sum 1. This is the
    // "% of revenue that typically comes in month X" for Part B.
    const portfolioAvg = portfolioMonthly.map((s, i) =>
      portfolioMonthlyCount[i] > 0 ? s / portfolioMonthlyCount[i] : 0,
    );
    const portfolioAvgSum = portfolioAvg.reduce((a, b) => a + b, 0);
    const revenueSeasonality =
      portfolioAvgSum > 0
        ? portfolioAvg.map((v) => v / portfolioAvgSum)
        : fallbackRevenueSeasonality();

    const baselines = new Map<string, PropertyBaseline>();
    for (const [propId, { monthlyHistory, monthlyHistoryCount, observedMonths }] of byProp) {
      // Average across multiple statement years for a given month-of-year
      // (e.g. Nov 2025 + Nov 2024 → averaged) so the projection isn't
      // skewed by a single hot month.
      const avgMonthly = monthlyHistory.map((sum, i) =>
        monthlyHistoryCount[i] > 0 ? sum / monthlyHistoryCount[i] : 0,
      );

      // Annualize the observed data. Sum the avg-monthly values for
      // months we actually have data for, divide by the Gloucester
      // seasonality share those months represent, → full-year estimate.
      const monthsObservedSet = new Set<number>();
      for (const ym of observedMonths) {
        const moy = parseInt(ym.slice(5, 7), 10) - 1;
        if (!Number.isNaN(moy)) monthsObservedSet.add(moy);
      }
      const observedSum = Array.from(monthsObservedSet).reduce(
        (s, i) => s + avgMonthly[i],
        0,
      );
      const observedShare = Array.from(monthsObservedSet).reduce(
        (s, i) => s + GLOUCESTER_SEASONALITY[i] / GLOUCESTER_SUM,
        0,
      );
      const annualGross = observedShare > 0 ? observedSum / observedShare : observedSum;

      baselines.set(propId, { annualGross, monthlyHistory: avgMonthly });
    }
    return { byProperty: baselines, revenueSeasonality };
  } catch (err) {
    console.error('[property-baselines] threw:', err);
    return { byProperty: new Map(), revenueSeasonality: fallbackRevenueSeasonality() };
  }
}
