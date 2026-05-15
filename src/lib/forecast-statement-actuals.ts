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

export async function getPropertyAnnualBaselines(): Promise<Map<string, PropertyBaseline>> {
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

    type Bucket = {
      monthlyHistory: number[];
      total: number;
      earliest: string;
      latest: string;
    };
    const byProp = new Map<string, Bucket>();

    const nightsBetween = (start: string, end: string): number => {
      const ms = new Date(end).getTime() - new Date(start).getTime();
      return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
    };

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
      const totalNights = nightsBetween(r.check_in, r.check_out);
      if (totalNights <= 0) continue;
      const perNight = gross / totalNights;

      const bucket = byProp.get(r.property_id) ?? {
        monthlyHistory: Array(12).fill(0),
        total: 0,
        earliest: r.check_in,
        latest: r.check_out,
      };

      // Walk this stay across months and bucket nights × perNight.
      let cursor = new Date(r.check_in);
      const checkOut = new Date(r.check_out);
      while (cursor < checkOut) {
        const cy = cursor.getFullYear();
        const cm = cursor.getMonth();
        const monthStart = new Date(cy, cm, 1);
        const monthEnd = new Date(cy, cm + 1, 1);
        const overlapStart = cursor > monthStart ? cursor : monthStart;
        const overlapEnd = checkOut < monthEnd ? checkOut : monthEnd;
        const nights = nightsBetween(
          overlapStart.toISOString().split('T')[0],
          overlapEnd.toISOString().split('T')[0],
        );
        if (nights > 0) {
          bucket.monthlyHistory[cm] += perNight * nights;
          bucket.total += perNight * nights;
        }
        cursor = monthEnd;
      }

      if (r.check_in < bucket.earliest) bucket.earliest = r.check_in;
      if (r.check_out > bucket.latest) bucket.latest = r.check_out;
      byProp.set(r.property_id, bucket);
    }

    const baselines = new Map<string, PropertyBaseline>();
    for (const [propId, { monthlyHistory, total }] of byProp) {
      // Trailing 12 months of observed revenue, no extrapolation. For
      // properties active the whole year, this is their actual annual.
      // For properties activated mid-window (new onboards), this is the
      // partial-year actual — under-projects them slightly until they have
      // a full year of history, which is fine and self-correcting.
      const annualGross = total;
      baselines.set(propId, { annualGross, monthlyHistory });
    }
    return baselines;
  } catch (err) {
    console.error('[property-baselines] threw:', err);
    return new Map();
  }
}
