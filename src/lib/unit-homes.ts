/**
 * Units of a split home (17 Beach's front and back, 4 Middle's two) are homes
 * of their own in the registry, but a list reads them under their house, not
 * as rows beside it. listing_links says which house: a 'unit' member belongs
 * to its group's 'whole' member.
 */

export type LinkRoleRow = { group_key: string; role: string; property_id: string | null };

/** unit property id -> its whole-house property id. */
export function parentOfUnits(links: readonly LinkRoleRow[]): Map<string, string> {
  const whole = new Map<string, string>();
  for (const l of links) if (l.role === 'whole' && l.property_id) whole.set(l.group_key, l.property_id);
  const out = new Map<string, string>();
  for (const l of links) {
    const parent = whole.get(l.group_key);
    if (l.role === 'unit' && l.property_id && parent && parent !== l.property_id) out.set(l.property_id, parent);
  }
  return out;
}

/** Homes in their order, each with its units under it. A unit whose house is
 *  not in the list stays a row of its own rather than vanishing. */
export function nestUnits<T extends { id: string }>(homes: readonly T[], parentOf: ReadonlyMap<string, string>): Array<{ home: T; units: T[] }> {
  const present = new Set(homes.map((h) => h.id));
  const units = new Map<string, T[]>();
  for (const h of homes) {
    const parent = parentOf.get(h.id);
    if (parent && present.has(parent)) units.set(parent, [...(units.get(parent) ?? []), h]);
  }
  return homes
    .filter((h) => !(parentOf.has(h.id) && present.has(parentOf.get(h.id) as string)))
    .map((home) => ({ home, units: units.get(home.id) ?? [] }));
}
