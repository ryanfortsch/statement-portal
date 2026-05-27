/**
 * Supplies surveyed at the end of every inspection. Each defaults to OK
 * on the review screen; the inspector flips on only what's running low.
 * On Complete Inspection the list of "low" keys is written to
 * inspections.supplies_low and one Rising Tide restock work_slip is
 * created per low key, attributed to the property + inspection.
 *
 * To add or remove items, edit this array — the resulting keys will be
 * stored verbatim on inspections.supplies_low, so historical inspections
 * stay readable as long as old keys still appear here.
 */
export type InspectionSupply = { key: string; label: string };

export const INSPECTION_SUPPLIES: readonly InspectionSupply[] = [
  { key: 'paper_towels', label: 'Paper towels' },
  { key: 'toilet_paper', label: 'Toilet paper' },
  { key: 'sponges', label: 'Sponges' },
  { key: 'laundry_detergent', label: 'Laundry detergent' },
  { key: 'dishwasher_detergent', label: 'Dishwasher detergent' },
  { key: 'trash_bags', label: 'Trash bags' },
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
