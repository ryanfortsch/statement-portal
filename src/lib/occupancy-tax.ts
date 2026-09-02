/**
 * Per-property occupancy tax rates for Direct / Stay Cape Ann charges.
 *
 * Base Cape Ann stack: 5.7% MA state + 6% local = 11.7%. Properties that
 * owe the 3% Community Impact Fee charge their guests 14.7% (per Dotti
 * 2026-08-02, starting with 79 Main).
 *
 * **The CIF is per-property. It is never a blanket rate, and it is never
 * inferred from folio data.** A sweep of `guesty_reservations.folio_items`
 * tells you what a listing BILLED, which is not the same question as what
 * the property OWES: a listing whose tax config is wrong bills the wrong
 * rate for years without complaint. #1437 derived the property set from
 * exactly such a sweep and got 17 Beach wrong as a result. The owed set
 * below is Dotti's, confirmed 2026-09-02, and only she changes it.
 *
 * Because those two questions can disagree, this module answers both and
 * callers must pick deliberately:
 *
 *   occupancyTaxMultiplier()  what the listing IS billing. Use it to invert
 *                             a tax-inclusive charge into pre-tax rent, or
 *                             to recognize a charge's tax-inclusive total.
 *   owedOccupancyTaxRate()    what the property OWES. Use it for the
 *                             remittance benchmark and to price new tax on
 *                             an add-on fee.
 *
 * Reaching for the wrong one has a direction. Using the OWED rate to invert
 * a charge recognizes over-collected tax as RENT and pays it to the owner
 * (the 79 Main July bug, $132.74 over-credited, Dotti's ruling 2026-08-02).
 * Using the BILLED rate as the remittance benchmark makes the sheet agree
 * with a misconfigured listing and wire out tax nobody owes.
 *
 * Keep in sync with stay-cape-ann's lib/occupancyTax.ts (the quote-side
 * twin, keyed by Guesty listing id) and with the listing's tax config in
 * Guesty itself, which is what live SCA quotes actually charge.
 */

export const BASE_OCCUPANCY_TAX_RATE = 0.117;
const CIF_RATE = 0.03;

/**
 * Properties that genuinely owe the Community Impact Fee, mapped to the
 * date the obligation starts. Dotti's list; do not add a property here off
 * a folio sweep.
 *
 * 17 Beach is deliberately absent. Its Guesty listing has billed the CIF
 * since inception, but the property does not owe it (Dotti 2026-09-02).
 */
const CIF_OWED_FROM: Record<string, string> = {
  '79_main': '1970-01-01',
  '3_south_st': '1970-01-01',
  '3_windward': '1970-01-01',
};

/**
 * What each listing's Guesty tax config has actually been charging guests.
 * `from` is inclusive, `until` is exclusive; a null `until` means it is
 * still billing the CIF today.
 *
 * This normally mirrors CIF_OWED_FROM. It diverges only while a listing is
 * misconfigured, and the divergence is what the remittance sheet exists to
 * surface.
 */
const CIF_BILLED_WINDOW: Record<string, { from: string; until: string | null }> = {
  '79_main': { from: '1970-01-01', until: null },
  '3_south_st': { from: '1970-01-01', until: null },
  '3_windward': { from: '1970-01-01', until: null },
  // 17 Beach never owed the CIF, but Guesty auto-calculated it on every
  // Direct/VRBO folio from inception until Dotti switched the listing tax
  // config off on 2026-09-02 (both listings: 695d5c8afb0a0500153d5d1c and
  // the relist 696a76a01e0e260014e13054). 11 bookings billed it,
  // $2,260.93, 2026-05-27 through 2027-07-08.
  //
  // The entry STAYS, closed rather than deleted. Deleting it would make
  // applyCollectedNet invert those 11 tax-inclusive charges at 1.117 and
  // hand each guest's 3% to the owner as rent, which is the 79 Main July
  // bug ($132.74 over-credited, Dotti's ruling 2026-08-02). Nicole Handley
  // alone would have moved $266.77.
  //
  // `until` is 09-03, not 09-02, because the switch was thrown partway
  // through 09-02 and a date cannot split a day. Charges created that day
  // therefore invert at 14.7%. That is the deliberate direction: a charge
  // billed at 11.7% and inverted at 14.7% under-recognizes rent by ~2.6%
  // and shows up in collected_rebuilds, whereas the other rounding would
  // silently pay an owner tax money.
  '17_beach_rd': { from: '1970-01-01', until: '2026-09-03' },
};

function inWindow(w: { from: string; until: string | null } | undefined, iso: string): boolean {
  if (!w) return false;
  return iso >= w.from && (w.until === null || iso < w.until);
}

/**
 * Tax-inclusive multiplier (e.g. 1.117 or 1.147) for what the listing was
 * actually BILLING on `chargeCreatedIso` (YYYY-MM-DD). This is the rate a
 * charge's gross was computed at, so it is the only correct divisor when
 * inverting that gross back to pre-tax rent.
 */
export function occupancyTaxMultiplier(propertyId: string, chargeCreatedIso: string): number {
  const cif = inWindow(CIF_BILLED_WINDOW[propertyId], chargeCreatedIso) ? CIF_RATE : 0;
  return 1 + BASE_OCCUPANCY_TAX_RATE + cif;
}

/**
 * The statutory rate the property OWES on `onIso` (defaults to today), as a
 * rate rather than a multiplier: 0.117 base, 0.147 where the CIF applies.
 * Independent of whatever the listing happens to be billing.
 */
export function owedOccupancyTaxRate(propertyId: string, onIso?: string): number {
  const from = CIF_OWED_FROM[propertyId];
  const iso = onIso || new Date().toISOString().slice(0, 10);
  return BASE_OCCUPANCY_TAX_RATE + (from && iso >= from ? CIF_RATE : 0);
}

/**
 * How far a listing's billed rate sits above what the property owes on
 * `chargeCreatedIso`. Positive means guests are being over-charged and the
 * excess is a refund liability, not tax and not rent. 0 in the normal case.
 */
export function overCollectedTaxRate(propertyId: string, chargeCreatedIso: string): number {
  const billed = occupancyTaxMultiplier(propertyId, chargeCreatedIso) - 1;
  const owed = owedOccupancyTaxRate(propertyId, chargeCreatedIso);
  return Math.round((billed - owed) * 10000) / 10000;
}
