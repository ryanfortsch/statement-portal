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
 * Sum `management_fee` per month from property_statements. Returns
 * { 'YYYY-MM': totalMgmtFee, … } for every month that has at least one
 * reconciled statement.
 *
 * Empty map when Supabase isn't configured or the query fails — the
 * forecast falls back to model projection automatically.
 */
export async function getStatementRevenueByMonth(
  yearsToInclude: number[] = [2026, 2027, 2028]
): Promise<StatementRevenueByMonth> {
  if (!isConfigured) return {};

  // property_statements.month is text "YYYY-MM"; cheap filter via range
  // on the string ordering since YYYY-MM sorts lexically.
  const minMonth = `${Math.min(...yearsToInclude)}-01`;
  const maxMonth = `${Math.max(...yearsToInclude) + 1}-01`;

  try {
    const { data, error } = await supabase
      .from('property_statements')
      .select('month, management_fee')
      .gte('month', minMonth)
      .lt('month', maxMonth);

    if (error) {
      console.error('[forecast-statement-actuals] query failed:', error.message);
      return {};
    }

    const byMonth: StatementRevenueByMonth = {};
    for (const row of (data ?? []) as Array<{ month: string; management_fee: number | null }>) {
      const fee = Number(row.management_fee ?? 0);
      if (!fee || !row.month) continue;
      byMonth[row.month] = (byMonth[row.month] ?? 0) + fee;
    }
    return byMonth;
  } catch (err) {
    console.error('[forecast-statement-actuals] threw:', err);
    return {};
  }
}

/**
 * Per-property baseline for the smart-forecast fallback. Two layers:
 *
 *   monthlyHistory[m] — actual Guesty revenue per month-of-year from
 *     the trailing 365 days, pro-rated by nights for stays that cross
 *     month boundaries. Self-corrects to each property's real
 *     seasonality (ADR + occupancy already baked in).
 *
 *   annualGross — sum of all trailing revenue, annualized by the days
 *     of history actually covered. Used as a secondary fallback for
 *     months where the property had no bookings last year (e.g. new
 *     onboards). Distributed by Gloucester occupancy share at the
 *     consumer site.
 *
 * The smart forecast takes max(monthlyHistory[m], annualGross × Gloucester
 * share[m]) as the floor, then max'es that against (bookedRevenue ×
 * portfolio pacing multiplier) for the final projection.
 */
export type PropertyBaseline = {
  annualGross: number;
  monthlyHistory: number[]; // 12 entries, Jan..Dec
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

export async function getPropertyAnnualBaselines(): Promise<Map<string, PropertyBaseline>> {
  if (!isConfigured) return new Map();
  try {
    // Pull all available rental_revenue rows. property_statements is
    // RT's authoritative reconciled monthly record — preferable to
    // guesty_reservations for historicals because Guesty syncs forward
    // bookings reliably but past stays can be sparse.
    const { data, error } = await supabase
      .from('property_statements')
      .select('property_id, month, rental_revenue');
    if (error) {
      console.error('[property-baselines] statements query failed:', error.message);
      return new Map();
    }

    type Bucket = {
      monthlyHistory: number[];      // index 0..11 = Jan..Dec; accumulates across years if multiple years of statements
      monthlyHistoryCount: number[]; // how many statements contributed to each month
      observedMonths: Set<string>;   // YYYY-MM strings seen for this property
    };
    const byProp = new Map<string, Bucket>();

    for (const row of (data ?? []) as Array<{
      property_id: string | null;
      month: string | null;
      rental_revenue: number | null;
    }>) {
      if (!row.property_id || !row.month) continue;
      const rev = Number(row.rental_revenue ?? 0);
      if (rev <= 0) continue;
      const monthOfYear = parseInt(row.month.slice(5, 7), 10) - 1; // 0..11
      if (Number.isNaN(monthOfYear) || monthOfYear < 0 || monthOfYear > 11) continue;

      const bucket = byProp.get(row.property_id) ?? {
        monthlyHistory: Array(12).fill(0),
        monthlyHistoryCount: Array(12).fill(0),
        observedMonths: new Set<string>(),
      };
      bucket.monthlyHistory[monthOfYear] += rev;
      bucket.monthlyHistoryCount[monthOfYear] += 1;
      bucket.observedMonths.add(row.month);
      byProp.set(row.property_id, bucket);
    }

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
    return baselines;
  } catch (err) {
    console.error('[property-baselines] threw:', err);
    return new Map();
  }
}
