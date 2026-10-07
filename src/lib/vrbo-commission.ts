/**
 * Vrbo's flat 12% commission, and the booking-date line that keeps the
 * legacy 4.4% kludge stripper from eating it.
 *
 * Every Vrbo recompute site (/api/ingest, /api/refresh-statement,
 * /api/fill-gap and the revenue-math UI mirror) strips the pre-overhaul
 * kludge by RATIO: real Vrbo commission was 5%, so anything above 7% of the
 * pre-tax booking total was read as the kludge stacked on top and rewritten
 * to 5%. From 2026-10-29 Vrbo charges hosts a flat 12% (Vrbo help center;
 * Skift, 2026-09-29), which that rule would rewrite to 5%: owner revenue
 * overstated by about 7% of the booking, the owner overpaid, and our fee
 * charged on money that never arrived.
 *
 * The two cannot be told apart by size (a kludged old booking reads about
 * 9.4%, and a folio-less base on a 50/50 split doubles any ratio), so the
 * line is drawn on WHEN THE GUEST BOOKED. `guesty_reservations.booked_at`
 * (Guesty confirmedAt, falling back to createdAt) is captured on every row
 * synced since 2026-09-02. A booking made on or after the cutoff carries
 * its real commission as given; everything else, including every row with
 * no booked_at, keeps the old rule exactly. No booking can be dated after
 * the cutoff before it arrives, so this changes no statement already built.
 *
 * Midnight Eastern: Vrbo announced the change for October 29 to U.S. hosts.
 */
export const VRBO_FLAT_COMMISSION_FROM = '2026-10-29T04:00:00Z';

const CUTOFF_MS = Date.parse(VRBO_FLAT_COMMISSION_FROM);

/** True when a Vrbo booking falls under the flat-commission regime. */
export function isVrboFlatCommissionBooking(bookedAt: string | null | undefined): boolean {
  if (!bookedAt) return false;
  const t = Date.parse(bookedAt);
  return Number.isFinite(t) && t >= CUTOFF_MS;
}
