/**
 * The Stripe charge-listing window for a statement month, plus the
 * fuzzy-match cutoff. Zero imports on purpose: scripts/lookback_parity.mjs
 * loads this module under plain Node (native TS stripping) to prove the
 * boundaries, and stripe-sync.ts is unloadable there (path-alias imports).
 *
 * Lookback is 18 months (was 6 until 2026-08-31). The 6-month window
 * missed Barry Allen's January 50/50 deposit on an August stay (3 South,
 * GY-2p8ZgNK8): the sync saw only the balance charge, which equals
 * Guesty's under-reported TOTAL_PAID exactly, so the gross
 * reconstruction had nothing to rebuild from and the statement
 * under-recognized the stay by $2,369.57. STR payment plans charge the
 * deposit at BOOKING time, and bookings run up to ~13 months out.
 *
 * fuzzyCutoffUnix is the OLD 6-month boundary. Charges created before it
 * are admitted only to the decisive matchers -- confirmation-code
 * aggregation and exact date-range equality -- and are excluded from the
 * amount fallback, the guest-name fallback, and unmatched_charges
 * reporting. That keeps every fuzzy path's candidate pool identical to
 * the pre-widening behavior: an old charge can never create a new
 * ambiguity, a new false amount match, or review-queue noise; it can only
 * join a stay it provably belongs to. (The extras review queue was
 * already gated to charges created inside the statement month.)
 */
export function chargeWindow(month: string): { startUnix: number; endUnix: number; fuzzyCutoffUnix: number } {
  const [y, m] = month.split('-').map(Number);
  return {
    startUnix: Math.floor(Date.UTC(y, m - 1 - 18, 1) / 1000),
    endUnix: Math.floor(Date.UTC(y, m + 2, 1) / 1000),
    fuzzyCutoffUnix: Math.floor(Date.UTC(y, m - 1 - 6, 1) / 1000),
  };
}
