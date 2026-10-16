/**
 * Homes that sell one another's nights, for the smart forecast.
 *
 * 17 Beach Road was split on 2026-09-28: the whole house stays on Guesty as
 * `17_beach_rd`, and its front unit and guest house joined the registry as
 * Helm-run homes of their own so their Airbnb stays are recorded. A
 * `listing_links` group ties the three together and keeps them from selling
 * the same nights. The forecast, which reads homes one by one, saw three
 * independent homes: the whole house on its statement floor, and each unit,
 * having no bookings or statements, on the portfolio-average annual gross.
 * One address was projected three times over, $130K of fee for 2027 against
 * the $78K the whole house carried alone.
 *
 * A unit of a home already in the forecast takes no portfolio average and
 * adds no capacity of its own: it projects its own bookings and, once it has
 * closed statements, its own floor. The whole house keeps its projection.
 * Pure and dependency-free so the rule is testable without the database.
 */

export type ListingLinkRow = {
  group_key: string | null;
  /** 'whole' for the whole-house listing, 'unit' for a part of it. */
  role: string | null;
  property_id: string | null;
  active?: boolean | null;
};

/**
 * unit property id -> the whole-house property id it sells the nights of.
 * Only groups whose whole-house member is itself an active managed home
 * count: a unit whose whole house has left the fleet is a home of its own.
 */
export function sharedInventoryMap(
  links: readonly ListingLinkRow[],
  activeHomeIds: ReadonlySet<string>,
): Map<string, string> {
  const wholeByGroup = new Map<string, string>();
  for (const l of links) {
    if (l.active === false || l.role !== 'whole' || !l.group_key || !l.property_id) continue;
    if (activeHomeIds.has(l.property_id)) wholeByGroup.set(l.group_key, l.property_id);
  }
  const out = new Map<string, string>();
  for (const l of links) {
    if (l.active === false || l.role !== 'unit' || !l.group_key || !l.property_id) continue;
    const whole = wholeByGroup.get(l.group_key);
    if (!whole || whole === l.property_id || !activeHomeIds.has(l.property_id)) continue;
    out.set(l.property_id, whole);
  }
  return out;
}

/** The annual gross a home's forward pace implies, before the statement floor. */
export function paceAnnualFor(ownAnnual: number, fallbackAnnual: number, sharesInventory: boolean): number {
  if (ownAnnual > 0) return ownAnnual;
  // No bookings of its own: an independent home takes the portfolio
  // average; a unit of a home already projected takes nothing.
  return sharesInventory ? 0 : fallbackAnnual;
}

/** Where a property's annual gross came from. */
export type AnnualBasis = 'pacing' | 'statements' | 'portfolio' | 'unit';

export function annualBasisFor(input: {
  floorAnnual: number;
  paceAnnual: number;
  ownAnnual: number;
  sharesInventory: boolean;
}): AnnualBasis {
  if (input.floorAnnual > input.paceAnnual) return 'statements';
  if (input.ownAnnual > 0) return 'pacing';
  return input.sharesInventory ? 'unit' : 'portfolio';
}
