/**
 * Per-property occupancy tax rates for Direct / Stay Cape Ann charges.
 *
 * Base Cape Ann stack: 5.7% MA state + 6% local = 11.7%. Properties in
 * the CIF map ALSO owe the 3% Community Impact Fee, so their guests are
 * charged 14.7% (per Dotti 2026-08-02, starting with 79 Main).
 *
 * The `effective from` date is when the booking site began COLLECTING
 * the higher rate for that property -- charges created before it invert
 * at the 11.7% base rate. 79 Main has charged the CIF from inception
 * (Guesty's listing tax config always had it; only the SCA estimate
 * fallback ever underquoted at 11.7%), so its date is the epoch. The
 * date gate exists for any FUTURE property whose rate genuinely changes
 * mid-history: flipping a multiplier retroactively would silently
 * rewrite already-recognized rent on old statements.
 *
 * Keep in sync with stay-cape-ann's lib/occupancyTax.ts (the quote-side
 * twin, keyed by Guesty listing id) and with the listing's tax config in
 * Guesty itself, which is what live SCA quotes actually charge.
 */

export const BASE_OCCUPANCY_TAX_RATE = 0.117;
const CIF_RATE = 0.03;

// property_id -> ISO date the 14.7% collection started.
const CIF_EFFECTIVE_FROM: Record<string, string> = {
  '79_main': '1970-01-01',
};

/** Tax-inclusive multiplier (e.g. 1.117 or 1.147) for a charge created on
 * `chargeCreatedIso` (YYYY-MM-DD) against the given property. */
export function occupancyTaxMultiplier(propertyId: string, chargeCreatedIso: string): number {
  const from = CIF_EFFECTIVE_FROM[propertyId];
  const cif = from && chargeCreatedIso >= from ? CIF_RATE : 0;
  return 1 + BASE_OCCUPANCY_TAX_RATE + cif;
}
