/**
 * Which open work slips nobody has touched in 90 days.
 *
 * The board held 298 open slips on 2026-10-18, 289 of them unassigned. Some
 * are real work waiting on a visit; many are residue: a review pasted in
 * June, a cleaner text about a bulb that was changed the next week. The
 * audit's answer is an owner decision, not a cron: "Review stale slips" on
 * the board's Organize menu lists these, grouped by home, with Dismiss per
 * row and per home. Nothing here closes anything on its own.
 *
 * "Touched" means a person did something, so updated_at does not count: the
 * nightly organize pass, the run planner and the launch-readiness cron all
 * write slips, and the organize pass stamped every open slip in October. The
 * signs of a person are: filing it, a comment, someone claiming it, a snooze,
 * an owner email about it, someone in the house confirming it is still
 * outstanding, and a scheduled date.
 *
 * Never stale: a slip someone is on (in progress), one scheduled or riding a
 * live Field packet, one snoozed to a later day, or one with a date still
 * ahead or inside the window.
 *
 * Import-free so `npm test` covers it.
 */

export const STALE_SLIP_DAYS = 90;

export type StaleCandidate = {
  id: string;
  property_id: string;
  status: string;
  created_at: string;
  claimed_at: string | null;
  snoozed_at: string | null;
  snoozed_until: string | null;
  owner_last_contacted_at: string | null;
  last_verified_open_at: string | null;
  scheduled_date: string | null;
};

const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

function dayOf(v: string): string {
  // A bare date is already a day; a timestamp is read in Eastern.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ET_DAY.format(new Date(v));
}

function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The latest Eastern day a person did something with this slip. */
export function slipLastTouchDay(s: StaleCandidate, lastCommentAt?: string | null): string {
  let last = dayOf(s.created_at);
  for (const v of [s.claimed_at, s.snoozed_at, s.owner_last_contacted_at, s.last_verified_open_at, s.scheduled_date, lastCommentAt]) {
    if (!v || !Number.isFinite(Date.parse(v))) continue;
    const day = dayOf(v);
    if (day > last) last = day;
  }
  return last;
}

/** Untouched by a person for more than `days`, and not held by anything. */
export function isSlipStale(
  s: StaleCandidate,
  today: string,
  opts: { lastCommentAt?: string | null; onLivePacket?: boolean; days?: number } = {},
): boolean {
  if (s.status !== 'open') return false;
  if (opts.onLivePacket) return false;
  if (s.snoozed_until && s.snoozed_until.slice(0, 10) > today) return false;
  return slipLastTouchDay(s, opts.lastCommentAt) < shiftDay(today, -(opts.days ?? STALE_SLIP_DAYS));
}

export type StaleGroup<T> = { propertyId: string; slips: T[] };

/**
 * Stale slips grouped by home, homes in the order given by `homeOrder`
 * (the caller sorts by name), each home's slips oldest touch first.
 */
export function groupStaleSlips<T extends StaleCandidate>(
  slips: readonly T[],
  today: string,
  lookup: { lastCommentAt: (id: string) => string | null | undefined; onLivePacket: (id: string) => boolean },
  homeOrder: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): Array<StaleGroup<T & { lastTouchDay: string }>> {
  const byHome = new Map<string, Array<T & { lastTouchDay: string }>>();
  for (const s of slips) {
    const lastCommentAt = lookup.lastCommentAt(s.id) ?? null;
    if (!isSlipStale(s, today, { lastCommentAt, onLivePacket: lookup.onLivePacket(s.id) })) continue;
    const row = { ...s, lastTouchDay: slipLastTouchDay(s, lastCommentAt) };
    const list = byHome.get(s.property_id);
    if (list) list.push(row);
    else byHome.set(s.property_id, [row]);
  }
  return [...byHome.entries()]
    .sort(([a], [b]) => homeOrder(a, b))
    .map(([propertyId, list]) => ({
      propertyId,
      slips: list.sort((x, y) => (x.lastTouchDay < y.lastTouchDay ? -1 : x.lastTouchDay > y.lastTouchDay ? 1 : 0)),
    }));
}
