/**
 * Itemising the corporate card (Chase ...3878) on /forecast.
 *
 * The Recurring Monthly rows used to be a proportional split of one card
 * lump: every month's card total, actual or projected, was carved up by a
 * fixed set of weights. That is fine for a projection and a fiction for an
 * actual month. April 2026 carried a $3,189 Arbella premium on the card,
 * the split smeared it across six rows, and "Vehicle & other insurance"
 * read $3,707 for a month in which GEICO charged $519 like every other.
 *
 * Now each bucket is measured. An ACT month's row is the sum of the card
 * rows the categorizer filed under it; a projected month's row is the
 * model's own term for it (ccOperatingDetail in forecast-model.ts). The
 * split survives only as a fallback for a month whose card spend is known
 * solely through the operating account's card payoff, which has no
 * category detail to offer.
 *
 * Three card categories never reach these buckets. Software has its own row
 * (#1459), a non-vehicle insurance premium on the card is a one-time hit
 * that belongs on the Insurance line beside Phillips, not in the monthly
 * run rate, and Republic Services (the office dumpster, filed as Rent &
 * office) rides the Office line beside the rent it is projected with.
 *
 * Deliberately dependency-free so `scripts/forecast_rerack_check.mjs` can
 * import it on its own.
 */

export type CardDetailKey =
  | 'supplies'
  | 'repairs'
  | 'vehicle_insurance'
  | 'travel_other'
  | 'marketing'
  | 'telecom';

export const CC_DETAIL_KEYS: readonly CardDetailKey[] = [
  'supplies',
  'repairs',
  'vehicle_insurance',
  'travel_other',
  'marketing',
  'telecom',
];

export type CardDetail = Record<CardDetailKey, number>;

export function emptyCardDetail(): CardDetail {
  return {
    supplies: 0,
    repairs: 0,
    vehicle_insurance: 0,
    travel_other: 0,
    marketing: 0,
    telecom: 0,
  };
}

export function sumCardDetail(d: CardDetail): number {
  let total = 0;
  for (const k of CC_DETAIL_KEYS) total += d[k];
  return total;
}

/**
 * The auto policy. GEICO is the only insurer that bills the card monthly;
 * anything else filed under Insurance on the card is a premium paid once.
 */
export function isVehicleInsurance(descUpper: string): boolean {
  return descUpper.includes('GEICO');
}

/**
 * Chase's card export writes the ampersand as "&amp;", so an AT&T bill can
 * reach here as "AT&AMP;T MOBILITY EPAY". The ingest route now decodes
 * that before storing, but four 2026 bills were stored escaped and read as
 * Travel & other for months; this keeps the matcher honest against any row
 * that slipped through. Same one-liner as decodeHtmlEntities in
 * overhead-categories.ts, repeated here because this module must stay
 * import-free for scripts/forecast_rerack_check.mjs.
 */
function unescapeAmp(descUpper: string): string {
  return descUpper.replace(/&AMP;|&#0*38;|&#X0*26;/g, '&');
}

/**
 * AT&T bills as "AT&T MOBILITY EPAY", "AT&T BILL PAYMENT" and "ATT*BILL
 * PAYMENT". The categorizer has no Telecom bucket, so these land in Other
 * and are pulled out here by description.
 */
export function isTelecom(descUpper: string): boolean {
  const d = unescapeAmp(descUpper);
  return (
    d.includes('AT&T') ||
    d.includes('ATT*') ||
    d.includes('VERIZON') ||
    d.includes('T-MOBILE') ||
    d.includes('COMCAST') ||
    d.includes('XFINITY')
  );
}

/**
 * Where a card-shaped overhead row lands: its own row (software, a one-time
 * insurance premium) or one of the six Recurring buckets.
 */
export type CardRoute = 'software' | 'insurance' | 'office' | CardDetailKey;

export function routeCardRow(category: string, descUpper: string): CardRoute {
  switch (category) {
    case 'Software':
      return 'software';
    case 'Insurance':
      return isVehicleInsurance(descUpper) ? 'vehicle_insurance' : 'insurance';
    case 'Rent & office':
      // Republic Services, the office dumpster, bills the card. The Office
      // line projects it (DUMPSTER_MONTHLY beside the rent), so an ACT month
      // has to carry it there too or the row changes shape at the seam.
      // Until 2026-09-06 it fell through to Travel & other while the Office
      // row projected a $50 dumpster no bank row had ever shown.
      return 'office';
    case 'Guest supplies':
      return 'supplies';
    case 'Repairs & upkeep':
      return 'repairs';
    case 'Marketing':
    case 'Listing platforms':
      return 'marketing';
    default:
      // Travel, Other, the card's own interest charges, and whatever else
      // the categorizer could not name.
      return isTelecom(descUpper) ? 'telecom' : 'travel_other';
  }
}
