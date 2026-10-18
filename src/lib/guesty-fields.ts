/**
 * The Guesty fields screen (/properties/[id]/sync-guesty), both directions
 * on one table. Pure, so the rules are tested without Guesty.
 *
 * Until 2026-10-18 these were two tools with look-alike names: "Sync to
 * Guesty" (Helm to Guesty, the guest-facing Wi-Fi, parking and trash
 * fields) on the Guest & listing tab, and "Fill blanks from Guesty" (Guesty
 * to Helm, the house's size and map pin) on the Facts Tools line, which
 * wrote on one click with no preview. Now each field shows Helm's value,
 * Guesty's value and an arrow for the way it moves.
 *
 * Guesty to Helm only ever fills a blank: the house facts are edited on
 * Facts, and Helm's value wins once it has one. (Helm to Guesty may
 * overwrite, on a tick, as it always could.)
 */

export type PullKey = 'bedrooms' | 'bathrooms' | 'square_feet' | 'type_of_unit' | 'map_pin';

export const PULL_FIELDS: ReadonlyArray<{ key: PullKey; label: string; columns: readonly string[] }> = [
  { key: 'bedrooms', label: 'Bedrooms', columns: ['bedrooms'] },
  { key: 'bathrooms', label: 'Bathrooms', columns: ['bathrooms'] },
  { key: 'square_feet', label: 'Square feet', columns: ['square_feet'] },
  { key: 'type_of_unit', label: 'Property type', columns: ['type_of_unit'] },
  { key: 'map_pin', label: 'Map pin', columns: ['latitude', 'longitude'] },
];

/** fill: Helm is blank and Guesty has it (the one move this direction makes).
 *  same: both agree. kept: both set and differ, Helm keeps its value.
 *  guesty-empty: Guesty has nothing to give. */
export type PullStatus = 'fill' | 'same' | 'kept' | 'guesty-empty';

export type PullValues = Record<PullKey, string>;

const blank = (v: unknown): boolean => v == null || (typeof v === 'string' && v.trim() === '');
const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '');

function pin(lat: unknown, lng: unknown): string {
  const a = num(lat);
  const b = num(lng);
  return a && b ? `${a}, ${b}` : '';
}

/** Helm's side, from the properties row. */
export function helmPullValues(p: Record<string, unknown>): PullValues {
  return {
    bedrooms: num(p.bedrooms),
    bathrooms: num(p.bathrooms),
    square_feet: num(p.square_feet),
    type_of_unit: blank(p.type_of_unit) ? '' : String(p.type_of_unit).trim(),
    map_pin: pin(p.latitude, p.longitude),
  };
}

type ListingShape = {
  bedrooms?: unknown;
  bathrooms?: unknown;
  area?: unknown;
  propertyType?: unknown;
  address?: { lat?: unknown; lng?: unknown } | null;
};

/** Guesty's side, from the listing record. */
export function guestyPullValues(l: ListingShape): PullValues {
  return {
    bedrooms: num(l.bedrooms),
    bathrooms: num(l.bathrooms),
    square_feet: num(l.area),
    type_of_unit: blank(l.propertyType) ? '' : String(l.propertyType).trim(),
    map_pin: pin(l.address?.lat, l.address?.lng),
  };
}

export function pullStatus(helm: string, guesty: string): PullStatus {
  if (!guesty) return 'guesty-empty';
  if (!helm) return 'fill';
  return helm.trim().toLowerCase() === guesty.trim().toLowerCase() ? 'same' : 'kept';
}

/**
 * The column writes for a pull: only the selected keys whose Helm side is
 * blank. The map pin fills only when Helm has neither half.
 */
export function pullUpdates(keys: readonly string[], helmRow: Record<string, unknown>, l: ListingShape): Record<string, number | string> {
  const helm = helmPullValues(helmRow);
  const guesty = guestyPullValues(l);
  const out: Record<string, number | string> = {};
  for (const f of PULL_FIELDS) {
    if (!keys.includes(f.key) || pullStatus(helm[f.key], guesty[f.key]) !== 'fill') continue;
    if (f.key === 'map_pin') {
      if (!blank(helmRow.latitude) || !blank(helmRow.longitude)) continue;
      out.latitude = Number(num(l.address?.lat));
      out.longitude = Number(num(l.address?.lng));
    } else if (f.key === 'type_of_unit') {
      out.type_of_unit = guesty.type_of_unit;
    } else {
      out[f.key] = Number(guesty[f.key]);
    }
  }
  return out;
}
