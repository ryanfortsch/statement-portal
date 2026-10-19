/**
 * The Stripe sync's "this home has no statement this month: did it have paid
 * bookings?" question.
 *
 * /api/sync-stripe walks every property with a Stripe key. A keyed home with
 * no statement for the month is either a missed ingest (real money with no
 * statement, an error the operator must see) or a quiet month (nothing to
 * do). This decides which.
 *
 * It used to count `total_paid IS NULL OR total_paid > 0` with no status
 * filter. Guesty leaves total_paid NULL on every inquiry and declined
 * request, so any home with a quote request checking out that month read as
 * "paid bookings, run the ingest". 4 Brier Neck (offboarded 2026-08-31, no
 * statement after August) held one inquiry and one declined request in
 * September, and that alone kept the stripe feed red on Delivery & sync and
 * on the close strip's Synced step every night from late September (21
 * failures in a row by 2026-10-18). A real Stripe failure in that window
 * would have landed in an already-red chip.
 *
 * Now it asks the question the way every other probe does
 * (`guesty-revenue-signal.ts`): status confirmed AND a revenue signal in any
 * of the three columns, so a direct stay with total_paid NULL still counts.
 * A failed read is reported as unknown, never as zero.
 *
 * Report-only: this never reads or writes a fee, a payout or a statement.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { CONFIRMED_STATUS, REVENUE_SIGNAL_OR } from './guesty-revenue-signal.ts';

export type PaidBookingsProbe =
  | { known: true; count: number }
  | { known: false; error: string };

/** [first day of month, first day of next month) as YYYY-MM-DD, by checkout. */
export function checkoutWindow(month: string): { start: string; endExclusive: string } {
  const [y, m] = month.split('-').map(Number);
  return {
    start: `${month}-01`,
    endExclusive: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
  };
}

export async function countPaidBookingsCheckingOut(
  supabase: SupabaseClient,
  propertyId: string,
  month: string,
): Promise<PaidBookingsProbe> {
  const { start, endExclusive } = checkoutWindow(month);
  const { count, error } = await supabase
    .from('guesty_reservations')
    .select('*', { count: 'exact', head: true })
    .eq('property_id', propertyId)
    .eq('status', CONFIRMED_STATUS)
    .gte('check_out', start)
    .lt('check_out', endExclusive)
    .or(REVENUE_SIGNAL_OR);
  if (error) return { known: false, error: error.message };
  if (count == null) return { known: false, error: 'no count returned' };
  return { known: true, count };
}
