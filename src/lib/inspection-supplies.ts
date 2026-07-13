/**
 * Supplies surveyed at the end of every inspection. Each defaults to OK
 * on the review screen; the inspector flips on only what's running low.
 * On Complete Inspection the list of "low" keys is written to
 * inspections.supplies_low and one Rising Tide restock work_slip is
 * created per low key, attributed to the property + inspection.
 *
 * Each supply carries a `par` target so the inspector doesn't have to
 * judge "low" subjectively — the review screen shows the concrete minimum
 * for THIS property. Count-based supplies scale off bedroom count from a
 * 2-bedroom base (+1 per bedroom above two); the rest are fixed amounts.
 *
 * To add or remove items, edit this array — the resulting keys will be
 * stored verbatim on inspections.supplies_low, so historical inspections
 * stay readable as long as old keys still appear here.
 */
export type InspectionSupply = {
  key: string;
  label: string;
  /**
   * The minimum the inspector should expect on hand, phrased for display
   * under the supply label (e.g. "at least 3 rolls"). `bedrooms` is the
   * property's bedroom count; fixed supplies ignore it.
   */
  par: (bedrooms: number) => string;
};

// 2-bedroom base; +1 for each bedroom beyond two. Floors at the base for
// 1-bedroom or unknown (null → treated as the 2-bedroom base).
function perBedroom(base: number, bedrooms: number): number {
  const beds = Number.isFinite(bedrooms) && bedrooms > 0 ? bedrooms : 2;
  return base + Math.max(0, beds - 2);
}

const rolls = (n: number) => `at least ${n} roll${n === 1 ? '' : 's'}`;

export const INSPECTION_SUPPLIES: readonly InspectionSupply[] = [
  { key: 'paper_towels', label: 'Paper towels', par: (b) => rolls(perBedroom(2, b)) },
  { key: 'toilet_paper', label: 'Toilet paper', par: (b) => rolls(perBedroom(4, b)) },
  { key: 'sponges', label: 'Sponges', par: (b) => `at least ${perBedroom(8, b)}` },
  { key: 'laundry_detergent', label: 'Laundry detergent', par: () => 'at least half a bag' },
  { key: 'dryer_sheets', label: 'Dryer sheets', par: () => 'at least 1 full box' },
  { key: 'dishwasher_detergent', label: 'Dishwasher detergent', par: () => 'at least 1 unopened bag' },
  { key: 'trash_bags', label: 'Trash bags', par: () => 'at least 1 full box' },
  { key: 'coffee_pods', label: 'Coffee pods', par: () => 'at least 2 boxes' },
];

const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  INSPECTION_SUPPLIES.map((s) => [s.key, s.label]),
);

/**
 * Human label for a supply key. Falls back to a Title-Cased version of
 * the raw key so legacy keys removed from the list above still render
 * reasonably on old inspection summaries.
 */
export function suppliesLabel(key: string): string {
  return (
    LABEL_BY_KEY[key] ??
    key
      .split('_')
      .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
      .join(' ')
  );
}
