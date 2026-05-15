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
 * Per-property expected annual rental_revenue (gross, owner-facing), derived
 * from the trailing months of property_statements. Used by the Smart
 * Forecast as a fallback projection for any forward month where a
 * property has zero current bookings — the model can't return \$0 just
 * because nobody has booked October yet on May 15. The baseline assumes
 * the property will fill to its historical pace.
 *
 * Annualized: sum(rental_revenue) × (12 / months_with_data). For a
 * property with 4 months of statement history each at \$15K, baseline =
 * 4 × 15K × 12 / 4 = \$180K annual.
 */
export async function getPropertyAnnualBaselines(): Promise<Map<string, number>> {
  if (!isConfigured) return new Map();
  try {
    const { data, error } = await supabase
      .from('property_statements')
      .select('property_id, month, rental_revenue');
    if (error) {
      console.error('[property-baselines] query failed:', error.message);
      return new Map();
    }

    type Bucket = { total: number; months: Set<string> };
    const byProp = new Map<string, Bucket>();
    for (const row of (data ?? []) as Array<{
      property_id: string | null;
      month: string | null;
      rental_revenue: number | null;
    }>) {
      if (!row.property_id || !row.month) continue;
      const rev = Number(row.rental_revenue ?? 0);
      if (rev <= 0) continue;
      const bucket = byProp.get(row.property_id) ?? { total: 0, months: new Set() };
      bucket.total += rev;
      bucket.months.add(row.month);
      byProp.set(row.property_id, bucket);
    }

    const baselines = new Map<string, number>();
    for (const [propId, { total, months }] of byProp) {
      const monthCount = months.size;
      if (monthCount === 0) continue;
      baselines.set(propId, (total * 12) / monthCount);
    }
    return baselines;
  } catch (err) {
    console.error('[property-baselines] threw:', err);
    return new Map();
  }
}
