/**
 * Shared revenue math helpers for the EDITOR / UI mirror of /api/ingest.
 *
 * The canonical recognition math lives in /api/ingest -- per project rule,
 * that code is hands-off without explicit approval and a parity harness.
 * This module is the UI-side mirror used by the cross-month installment
 * editor and the property page's multi-month bookings section, so both
 * surfaces agree on how to display the booking breakdown.
 *
 * If /api/ingest's effectiveCommission ever changes intentionally, update
 * this mirror to match -- but do NOT refactor /api/ingest to import from
 * here. Keeping the canonical copy isolated is deliberate.
 */

/**
 * Strip the legacy 4.4% commission kludge.
 *
 * Pre-overhaul, Ryan/Dotti added 4.4% to CHANNEL COMMISSION in Guesty so
 * the PDF would approximate the post-Stripe owner net. Bookings before
 * the fix landed still carry the inflated value (e.g. Hancock at $32,000
 * has commission=$1,408 -- exactly 4.4% -- on a Manual booking where the
 * real commission is 0).
 *
 * Rules:
 *   - Manual / Direct: real commission = 0. Anything > 2% of (totalPaid -
 *     taxes) is the kludge -- return 0.
 *   - VRBO / HomeAway: real commission = 5%. > 7% means the 4.4% kludge
 *     is stacked on top -- restore the underlying 5%.
 *   - Airbnb / Booking.com: pass through unchanged; they handle commission
 *     themselves and were never kludged.
 */
export function effectiveCommission(
  platform: string,
  totalPaid: number,
  taxes: number,
  commission: number,
): number {
  if (!commission || commission <= 0) return 0;
  const base = Math.max(totalPaid - taxes, 0);
  if (base <= 0) return commission;
  const ratio = commission / base;
  const p = platform.toUpperCase();
  if (p === 'MANUAL' || p === 'DIRECT') {
    return ratio > 0.02 ? 0 : commission;
  }
  if (p.includes('HOMEAWAY') || p === 'VRBO') {
    return ratio > 0.07 ? Math.round(base * 0.05 * 100) / 100 : commission;
  }
  return commission;
}

/**
 * Returns true when the supplied commission would be stripped by
 * effectiveCommission -- i.e. the raw Guesty value was non-zero but the
 * mirror drops or reduces it as a legacy 4.4% kludge artifact.
 *
 * Used by the editor's breakdown panel to render a small "(legacy 4.4%
 * kludge stripped)" annotation so the operator understands why a
 * Guesty-shown commission doesn't appear in the deduction stack.
 */
export function wasCommissionStripped(
  platform: string,
  totalPaid: number,
  taxes: number,
  commission: number,
): boolean {
  if (!commission || commission <= 0) return false;
  const eff = effectiveCommission(platform, totalPaid, taxes, commission);
  // Use a 1-cent tolerance to avoid floating point noise.
  return Math.abs(eff - commission) > 0.01;
}
