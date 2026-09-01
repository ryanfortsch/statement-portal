/**
 * "Does this guesty_reservations row carry revenue?" -- one implementation.
 *
 * The question was being answered in four places with four different column
 * sets, and the two drift probes answered it with `total_paid > 0` alone.
 * That is wrong in a way that hides money: Guesty only populates total_paid
 * when Guesty itself processed the payment. A staycapeann.com direct booking
 * takes payment through the property's own Stripe, so Guesty records
 * total_paid NULL and carries the gross in host_payout instead -- and
 * PostgREST's `.gt()` excludes NULL, so every one of those stays was
 * invisible to the "new bookings not on a statement" banner and to Refresh
 * Statement. Verified against live data 2026-09-01: for August, the
 * total_paid-only rule saw 1 missing booking; the three-column rule sees 3.
 *
 * The filter's REAL job is excluding homeowner stays (an owner blocking
 * their own house earns nothing), which /api/ingest states as "Manual with
 * zero accrual revenue". A homeowner block is zero in all three columns, so
 * the three-column rule keeps excluding it -- confirmed against August's 19
 * such rows, every one of them zero across the board.
 *
 * IMPORTANT -- candidacy is not permission to insert. These columns are
 * three DIFFERENT bases: total_paid is what Guesty collected, host_payout is
 * gross including taxes, owner_net_revenue_guesty is already net of the
 * management fee. Only total_paid can be fed to the Stripe-on-gross
 * reconstruction. A row that is a candidate on host_payout alone must be
 * REPORTED, never priced. See /api/refresh-statement.
 */

/** Columns any drift or candidate probe must select to answer the question. */
export const REVENUE_SIGNAL_COLUMNS = 'total_paid, host_payout, owner_net_revenue_guesty';

/**
 * PostgREST predicate form. Each `.gt.0` excludes NULL on its own, so the OR
 * is true only when at least one column carries real money.
 */
export const REVENUE_SIGNAL_OR = 'total_paid.gt.0,host_payout.gt.0,owner_net_revenue_guesty.gt.0';

export type RevenueSignalRow = {
  total_paid?: number | null;
  host_payout?: number | null;
  owner_net_revenue_guesty?: number | null;
};

/**
 * The largest revenue signal on a row; 0 when it carries none. For DISPLAY
 * and for candidacy tests only -- never as an input to payout math, because
 * the three columns are different bases and picking the max mixes them.
 */
export function revenueSignal(row: RevenueSignalRow): number {
  return Math.max(
    Number(row.total_paid) || 0,
    Number(row.host_payout) || 0,
    Number(row.owner_net_revenue_guesty) || 0,
  );
}

/** Does this row carry revenue at all? (false = homeowner stay / empty row) */
export function hasRevenueSignal(row: RevenueSignalRow): boolean {
  return revenueSignal(row) > 0;
}

/**
 * Can this row be PRICED by the Stripe-on-gross reconstruction? Only
 * total_paid answers that; host_payout and owner_net_revenue_guesty are
 * other bases and feeding them to the formula would invent money.
 */
export function hasPriceableGross(row: RevenueSignalRow): boolean {
  return (Number(row.total_paid) || 0) > 0;
}
