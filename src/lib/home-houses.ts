/**
 * Today at the houses: who leaves and who arrives. Pure, so `npm test` pins it.
 */

type Stay = { propertyId: string; guestName: string | null };

/**
 * The same guest out and back in at the same house on the same day is one
 * stay carrying on (an owner block re-entered, an extension booked as a new
 * reservation): nobody leaves and nobody arrives, so neither row prints.
 * A stay with no guest name is never paired, because two unnamed stays are
 * not evidence of one guest.
 */
export function dropCarryOnStays<T extends Stay>(checkouts: T[], checkins: T[]): { out: T[]; in: T[] } {
  const key = (s: Stay) => `${s.propertyId}|${(s.guestName ?? '').trim().toLowerCase()}`;
  const named = (s: Stay) => !!s.guestName?.trim();
  const arriving = new Set(checkins.filter(named).map(key));
  const carriesOn = new Set(checkouts.filter((s) => named(s) && arriving.has(key(s))).map(key));
  return {
    out: checkouts.filter((s) => !carriesOn.has(key(s))),
    in: checkins.filter((s) => !carriesOn.has(key(s))),
  };
}
