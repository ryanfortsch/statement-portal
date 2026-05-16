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
 *
 * The per-property annual-gross baselines for the smart forecast's Part B
 * are NOT built here — they come from trailing-12-month Guesty actuals in
 * forecast-smart.ts (property_statements is too sparse to baseline the
 * whole portfolio).
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
