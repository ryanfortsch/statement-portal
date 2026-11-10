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

/** A house today that the crew's route does not already print. */
export type TodayExtraRow =
  | { kind: 'out'; propertyId: string; propertyName: string; guestName: string | null; reason: 'no_cleaning' | 'other_cleaner' }
  | { kind: 'in'; propertyId: string; propertyName: string; guestName: string | null }
  | { kind: 'walked'; propertyId: string; propertyName: string; inspectionId: string };

type NamedStay = Stay & { propertyName: string };

/**
 * Today at the houses, folded into the cleanings strip's Today column
 * (2026-11-08, Dotti: the home printed today's checkouts twice). The
 * route's own lines already name every checkout the crew covers, so this
 * returns only what they cannot: a checkout off the route (marked "no
 * cleaning", or a home outside the crew's region such as 65 Calderwood),
 * today's arrivals, and a home walked with no stay today. `walked` is the
 * set of homes walked today, for the tick on any line.
 */
export function todayExtras(args: {
  routeHomes: ReadonlySet<string>;
  skippedHomes: ReadonlySet<string>;
  /** Route homes turning over today: their arrival already prints as "same day". */
  sameDayHomes: ReadonlySet<string>;
  checkouts: NamedStay[];
  checkins: NamedStay[];
  walks: Array<{ id: string; propertyId: string; propertyName: string }>;
}): { rows: TodayExtraRow[]; walked: Set<string> } {
  const { out, in: arriving } = dropCarryOnStays(args.checkouts, args.checkins);
  const byName = (a: { propertyName: string }, b: { propertyName: string }) => a.propertyName.localeCompare(b.propertyName);
  const outRows: TodayExtraRow[] = out
    .filter((s) => !args.routeHomes.has(s.propertyId))
    .sort(byName)
    .map((s) => ({
      kind: 'out',
      propertyId: s.propertyId,
      propertyName: s.propertyName,
      guestName: s.guestName,
      reason: args.skippedHomes.has(s.propertyId) ? 'no_cleaning' : 'other_cleaner',
    }));
  const inRows: TodayExtraRow[] = arriving.filter((s) => !args.sameDayHomes.has(s.propertyId)).sort(byName).map((s) => ({
    kind: 'in',
    propertyId: s.propertyId,
    propertyName: s.propertyName,
    guestName: s.guestName,
  }));
  const stayHomes = new Set([...out, ...arriving].map((s) => s.propertyId));
  const walkRows: TodayExtraRow[] = args.walks
    .filter((w) => !stayHomes.has(w.propertyId) && !args.routeHomes.has(w.propertyId))
    .map((w) => ({ kind: 'walked', propertyId: w.propertyId, propertyName: w.propertyName, inspectionId: w.id }));
  return { rows: [...outRows, ...inRows, ...walkRows], walked: new Set(args.walks.map((w) => w.propertyId)) };
}
