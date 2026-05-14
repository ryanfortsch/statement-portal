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
