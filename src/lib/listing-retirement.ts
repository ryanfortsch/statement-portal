/**
 * Which guesty_listings rows to retire after a listings pull.
 *
 * The listing sync upserts what Guesty returns and, until now, never
 * removed what it stopped returning. 17 Beach's "Back Unit" listing left
 * Guesty on 2026-06-02 and sat in the table for three months; every
 * calendar refresh hit it, took a 404, and abandoned all of 17 Beach.
 *
 * Retirement is deliberately timid, because the failure on the other side
 * is worse: a partial or empty response from Guesty must never wipe the
 * map. So nothing is retired unless the pull walked every page to a short
 * one, returned a plausible fleet, and the stale set is a small fraction
 * of the table. Anything bigger is reported, not deleted.
 *
 * Import-free so `npm test` covers the guard without a database.
 */

export type ListingRowLite = { listing_id: string; property_id: string | null; nickname: string | null };

export type RetirementDecision = {
  /** Rows safe to delete this run. */
  retire: ListingRowLite[];
  /** Stale rows held back, with the reason. Empty when nothing was held. */
  held: ListingRowLite[];
  reason: 'ok' | 'incomplete_pull' | 'implausible_fleet' | 'too_many_stale' | 'nothing_stale';
};

/** Below this many live listings the pull does not look like the fleet. */
export const MIN_PLAUSIBLE_FLEET = 5;
/** Never retire more than this share of the table in one run (at least 3 rows). */
export const MAX_STALE_SHARE = 0.25;

export function decideListingRetirement(
  existing: ListingRowLite[],
  liveListingIds: Iterable<string>,
  opts: { pullComplete: boolean },
): RetirementDecision {
  const live = new Set(liveListingIds);
  const stale = existing.filter((r) => !live.has(r.listing_id));
  if (stale.length === 0) return { retire: [], held: [], reason: 'nothing_stale' };
  if (!opts.pullComplete) return { retire: [], held: stale, reason: 'incomplete_pull' };
  if (live.size < MIN_PLAUSIBLE_FLEET) return { retire: [], held: stale, reason: 'implausible_fleet' };
  const cap = Math.max(3, Math.floor(existing.length * MAX_STALE_SHARE));
  if (stale.length > cap) return { retire: [], held: stale, reason: 'too_many_stale' };
  return { retire: stale, held: [], reason: 'ok' };
}
