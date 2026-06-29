/**
 * Cross-month booking installments.
 *
 * A reservation that spans multiple calendar months (e.g. Hancock at 3
 * South, Jun 22 -> Aug 6) can be opt-in split across the months it
 * spans so the owner gets a partial payout each month instead of one
 * lump at checkout. Splits live in the `reservation_installments`
 * table, keyed by (confirmation_code, month) -- which survives
 * /api/ingest's wipe-and-rewrite of the `reservations` table.
 *
 * This module is the read surface. Writes go through a dedicated server
 * action (PR 3). Until PR 2 lands, nothing calls these helpers -- they
 * exist so the eventual ingest fork-point has a one-line lookup.
 *
 * Recognition semantics, set with Dotti 2026-06-01:
 *  - Proration: nights-in-month (Hancock = Jun 9 / Jul 31 / Aug 5).
 *  - Stripe fee: pro-rated across months by revenue ratio. Computed at
 *    recognition time (not stored on the installment row).
 *  - Cleaning, repairs, num_stays, nights_booked: attach ONLY to the
 *    is_final_month=true installment so dashboards / forecast / cost
 *    analysis don't double-count.
 *  - Penny exactness: SUM(installment_revenue) over a code must equal
 *    reservations.adjusted_revenue. Round to cents on the first N-1
 *    months; the final month absorbs the residue.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type Installment = {
  id: string;
  confirmation_code: string;
  property_id: string;
  month: string;                        // 'YYYY-MM'
  installment_revenue: number;          // pre-mgmt-fee, post-Stripe-fee net for this month
  installment_nights: number | null;    // nights of the booking that fall in `month`
  is_final_month: boolean;              // true ONLY on the checkout-month installment
  note: string | null;
  created_at: string;
  updated_at: string;
};

const COLS = 'id, confirmation_code, property_id, month, installment_revenue, installment_nights, is_final_month, note, created_at, updated_at';

/**
 * Tolerate the table not existing yet (migration unrun). Returns null +
 * logs once so the ingest path doesn't fail before PR 1's SQL has been
 * applied in prod.
 */
function isMissingTableError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === 'PGRST205') return true;
  return /does not exist|relation|Could not find the table/i.test(err.message || '');
}

/**
 * Look up the installment row for a specific (confirmation_code, month).
 * Returns null when this booking isn't split, or when the table doesn't
 * exist yet. Callers fall back to the existing single-month behavior on
 * null.
 */
export async function loadInstallment(
  supabase: SupabaseClient,
  confirmationCode: string,
  month: string,
): Promise<Installment | null> {
  if (!confirmationCode || !month) return null;
  const { data, error } = await supabase
    .from('reservation_installments')
    .select(COLS)
    .eq('confirmation_code', confirmationCode)
    .eq('month', month)
    .maybeSingle();
  if (error && !isMissingTableError(error)) {
    console.warn('loadInstallment failed:', error.message);
    return null;
  }
  return (data as Installment | null) ?? null;
}

/**
 * Pull every installment for a confirmation code (across all months).
 * Used by the editor to verify SUM == adjusted_revenue, and by the
 * statement render to show "installment 1 of 3" captions.
 */
export async function loadInstallmentsForCode(
  supabase: SupabaseClient,
  confirmationCode: string,
): Promise<Installment[]> {
  if (!confirmationCode) return [];
  const { data, error } = await supabase
    .from('reservation_installments')
    .select(COLS)
    .eq('confirmation_code', confirmationCode)
    .order('month', { ascending: true });
  if (error && !isMissingTableError(error)) {
    console.warn('loadInstallmentsForCode failed:', error.message);
    return [];
  }
  return (data || []) as Installment[];
}

/**
 * Bulk lookup for a set of confirmation codes scoped to a single month.
 * Returns a Map keyed by confirmation_code -> installment row for
 * O(1) lookups while iterating reservations in /api/ingest.
 */
export async function loadInstallmentsByCodeForMonth(
  supabase: SupabaseClient,
  confirmationCodes: string[],
  month: string,
): Promise<Map<string, Installment>> {
  const out = new Map<string, Installment>();
  if (confirmationCodes.length === 0 || !month) return out;
  const { data, error } = await supabase
    .from('reservation_installments')
    .select(COLS)
    .in('confirmation_code', confirmationCodes)
    .eq('month', month);
  if (error) {
    if (!isMissingTableError(error)) console.warn('loadInstallmentsByCodeForMonth failed:', error.message);
    return out;
  }
  for (const row of (data || []) as Installment[]) {
    out.set(row.confirmation_code, row);
  }
  return out;
}

/**
 * Compute the Stripe-fee share for a single installment given the
 * reservation's total Stripe fee and the full set of installments for
 * the booking. Pro-rated by revenue ratio so months with bigger
 * installment_revenue absorb more of the fee.
 *
 * Returns 0 if the booking isn't split (caller should use the
 * reservation's stripe_fee verbatim in that case).
 */
export function stripeFeeShare(
  installment: Installment,
  allInstallments: Installment[],
  totalStripeFee: number,
): number {
  if (allInstallments.length === 0) return 0;
  const total = allInstallments.reduce((s, i) => s + Number(i.installment_revenue || 0), 0);
  if (total <= 0) return 0;
  const share = (Number(installment.installment_revenue || 0) / total) * totalStripeFee;
  return Math.round(share * 100) / 100;
}

/**
 * Compute a default "nights-in-month" split given a check-in date and
 * check-out date, total nights, and total adjusted_revenue. Returns one
 * row per spanned calendar month, in ascending month order, with
 * penny-exact totals (rounding residue dumped into the final month).
 *
 * Pure function: no DB calls. The editor uses it to pre-fill the modal;
 * the operator can edit any cell before saving.
 */
export type InstallmentDraft = {
  month: string;                  // 'YYYY-MM'
  installment_nights: number;
  installment_revenue: number;
  is_final_month: boolean;
};

export function computeNightsInMonthSplit(args: {
  checkInIso: string;            // 'YYYY-MM-DD' (the night they ARRIVE; counts toward the check-in month)
  checkOutIso: string;           // 'YYYY-MM-DD' (NOT counted; guest leaves this morning)
  totalNights: number;
  totalRevenue: number;          // adjusted_revenue (pre-mgmt-fee, post-Stripe-fee)
}): InstallmentDraft[] {
  const { checkInIso, checkOutIso, totalNights, totalRevenue } = args;
  if (totalNights <= 0 || !checkInIso || !checkOutIso) return [];

  // Walk each night from check-in (inclusive) to check-out (exclusive)
  // and tally by calendar month. Standard STR convention: the check-out
  // morning is NOT a paid night.
  const nightsByMonth = new Map<string, number>();
  const start = new Date(checkInIso + 'T00:00:00Z');
  const end = new Date(checkOutIso + 'T00:00:00Z');
  const cursor = new Date(start.getTime());
  while (cursor < end) {
    const m = cursor.toISOString().slice(0, 7);  // 'YYYY-MM'
    nightsByMonth.set(m, (nightsByMonth.get(m) || 0) + 1);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const months = Array.from(nightsByMonth.keys()).sort();
  if (months.length === 0) return [];

  // Pre-compute each month's revenue by ratio. Round all but the last
  // to cents; the last month absorbs the residue so the sum is exact.
  const drafts: InstallmentDraft[] = [];
  let runningSum = 0;
  const finalMonth = months[months.length - 1];
  for (const m of months) {
    const nights = nightsByMonth.get(m) || 0;
    let revenue: number;
    if (m === finalMonth) {
      revenue = Math.round((totalRevenue - runningSum) * 100) / 100;
    } else {
      revenue = Math.round(((nights / totalNights) * totalRevenue) * 100) / 100;
      runningSum += revenue;
    }
    drafts.push({
      month: m,
      installment_nights: nights,
      installment_revenue: revenue,
      is_final_month: m === finalMonth,
    });
  }
  return drafts;
}
