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
 *   - Any fully-closed later month with a reconciled statement →
 *     statement actuals override revenue (expenses stay projected).
 *   - The current, in-progress month is never treated as an actual —
 *     it stays projected until it closes.
 *
 * The per-property annual-gross baselines for the smart forecast's Part B
 * are NOT built here — they come from trailing-12-month Guesty actuals in
 * forecast-smart.ts (property_statements is too sparse to baseline the
 * whole portfolio).
 */

import { createClient } from '@supabase/supabase-js';
import { selectAllPaged } from './paged-select';

/**
 * SERVICE ROLE, deliberately.
 *
 * This module used to import the shared anon client from './supabase'.
 * `property_statements` and `statement_periods` both have RLS enabled with
 * ZERO policies, so the anon key reads them as an empty set - no error, no
 * log line, just nothing. The revenue overlay silently returned {} and the
 * forecast fell back to the hardcoded bank figures forever. April 2026
 * rendered its $7,869 bank sweep instead of its real $6,683 management fee,
 * and May and June rendered $0 because the hardcoded fallback stops at
 * April.
 *
 * Absence of rows is not absence of data. Anything reading the statements
 * tables server-side needs the service-role key.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const isConfigured = !!supabaseUrl && !!supabaseKey;

export type StatementRevenueByMonth = Record<string, number>;


/**
 * Sum `management_fee` per month across all property_statements. Returns
 * { 'YYYY-MM': totalMgmtFee, … } for every fully-closed past month that
 * has at least one reconciled statement. Month is resolved via
 * statement_periods.
 *
 * The current, in-progress month is deliberately excluded: a partial or
 * early-drafted statement for it would otherwise freeze the forecast at
 * a mid-month number. That month stays projected until it closes.
 *
 * Empty map when Supabase isn't configured or the query fails — the
 * forecast falls back to model projection automatically.
 */
export async function getStatementRevenueByMonth(): Promise<StatementRevenueByMonth> {
  if (!isConfigured) return {};
  try {
    const db = createClient(supabaseUrl, supabaseKey);

    // period_id -> "YYYY-MM". property_statements carries `period_id`, NOT a
    // denormalized `month`, so every statement query resolves through here.
    const monthByPeriod = new Map<string, string>();
    for (const p of await selectAllPaged<{ id: string | null; month: string | null }>(
      (from, to) => db.from('statement_periods').select('id, month').order('id').range(from, to),
      { label: 'statement_periods' },
    )) {
      if (p.id && p.month) monthByPeriod.set(p.id, p.month);
    }

    const data = await selectAllPaged<{ period_id: string | null; management_fee: number | null }>(
      (from, to) =>
        db.from('property_statements').select('period_id, management_fee').order('id').range(from, to),
      { label: 'property_statements' },
    );

    // Only months strictly before the current calendar month count as
    // actuals — the in-progress month is still earning and must stay
    // projected, even if a partial statement already exists for it.
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const byMonth: StatementRevenueByMonth = {};
    for (const row of data) {
      const month = row.period_id ? monthByPeriod.get(row.period_id) : undefined;
      if (!month) continue;
      if (month >= currentMonthKey) continue;
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
