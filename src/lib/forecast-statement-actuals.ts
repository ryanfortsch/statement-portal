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
 * Per-property expected annual rental revenue (gross, owner-facing).
 * Used by Smart Forecast as a fallback projection floor for any forward
 * month where a property has zero current bookings — the model can't
 * project \$0 just because nobody has booked October yet in May.
 *
 * Source: trailing-365-days Guesty reservations summed per property,
 * then annualized. Guesty has all bookings whether or not the monthly
 * statement has been closed in Helm — more comprehensive than
 * property_statements, especially for properties that haven't been
 * reconciled recently.
 *
 * Annualization: sum(host_payout) × (365 / daysOfHistory). For a
 * property with 90 days of Guesty stays totaling \$25K, baseline =
 * 25K × 365 / 90 = \$101K annual gross.
 */
export async function getPropertyAnnualBaselines(): Promise<Map<string, number>> {
  if (!isConfigured) return new Map();
  try {
    const today = new Date();
    const yearAgo = new Date(today);
    yearAgo.setDate(yearAgo.getDate() - 365);
    const todayStr = today.toISOString().split('T')[0];
    const yearAgoStr = yearAgo.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('guesty_reservations')
      .select('property_id, check_in, check_out, status, host_payout, owner_net_revenue_guesty, total_paid')
      .gte('check_out', yearAgoStr)
      .lt('check_in', todayStr);
    if (error) {
      console.error('[property-baselines] guesty query failed:', error.message);
      return new Map();
    }

    type Bucket = { total: number; earliest: string; latest: string };
    const byProp = new Map<string, Bucket>();
    for (const r of (data ?? []) as Array<{
      property_id: string | null;
      check_in: string | null;
      check_out: string | null;
      status: string | null;
      host_payout: number | null;
      owner_net_revenue_guesty: number | null;
      total_paid: number | null;
    }>) {
      if (!r.property_id || !r.check_in || !r.check_out) continue;
      // Filter to bookings that actually generated revenue (skip owner blocks,
      // cancelled holds, inquiries).
      const status = (r.status || '').toLowerCase().replace(/_/g, '-');
      if (
        status.includes('cancel') ||
        status.includes('declin') ||
        status === 'inquiry' ||
        status === 'expired'
      ) {
        continue;
      }
      const gross =
        Number(r.host_payout ?? 0) ||
        Number(r.owner_net_revenue_guesty ?? 0) ||
        Number(r.total_paid ?? 0);
      if (gross <= 0) continue;

      const bucket = byProp.get(r.property_id) ?? {
        total: 0,
        earliest: r.check_in,
        latest: r.check_out,
      };
      bucket.total += gross;
      if (r.check_in < bucket.earliest) bucket.earliest = r.check_in;
      if (r.check_out > bucket.latest) bucket.latest = r.check_out;
      byProp.set(r.property_id, bucket);
    }

    const baselines = new Map<string, number>();
    for (const [propId, { total, earliest, latest }] of byProp) {
      const daysSpan = Math.max(
        30,
        Math.round((new Date(latest).getTime() - new Date(earliest).getTime()) / (1000 * 60 * 60 * 24)),
      );
      const annualized = (total * 365) / daysSpan;
      baselines.set(propId, annualized);
    }
    return baselines;
  } catch (err) {
    console.error('[property-baselines] threw:', err);
    return new Map();
  }
}
