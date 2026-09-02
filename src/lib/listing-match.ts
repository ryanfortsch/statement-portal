/**
 * Resolving a Guesty listing name to a Helm property.
 *
 * Guesty's exports identify a stay by LISTING (the property's External Title,
 * what a guest sees), never by Helm's property id. Anything reading one of
 * those files has to map the name back, and three routes need to: the owner
 * PDF section router, the platform-CSV path inside /api/ingest, and
 * /api/ingest-guesty-csv.
 *
 * This lived only in /api/ingest-guesty-csv. /api/ingest never used it, which
 * is how 31 stays ended up on 3 Windward: its platform-CSV loop walked a
 * FLEET-WIDE csv and stamped the statement's own property onto every row it
 * saw. Whichever property was ingested last captured the lot.
 *
 * LONGEST match wins, so a sub-unit needle ('53 rocky neck (down') beats its
 * parent's '53 rocky neck' prefix and can never be absorbed by it. Same rule
 * as sync-guesty's LISTING_MATCH and the PDF section assignment. First-match
 * wins would reintroduce the downstairs misrouting the moment
 * 53_rocky_neck_2 became reachable.
 */

/**
 * Neighborhood nicknames, tried only when no listing_match needle hits.
 * Code-side because there is no DB column for them. Longest match wins here
 * too, for the same reason.
 */
export const NICKNAME_HINTS: Record<string, string> = {
  '3_south_st':    'old garden beach',
  '21_horton':     'rocky neck',
  '53_rocky_neck': 'the neck',
  '4_brier_neck':  'brier neck',
  '30_woodward':   'little river',
  '20_hammond':    'east gloucester',
  '20_enon':       'beverly shops',
  '73_rocky_neck': 'smith cove',
  '17_beach_rd':   'niles beach',
  '65_calderwood': 'black rock harbor',
  '3_locust':      'niles beach',
  '3246_ne_27th':  'lighthouse point',
};

/** Longest needle the haystack contains, or null. */
export function longestMatch(
  haystack: string,
  needles: Record<string, string>,
): string | null {
  let best: string | null = null;
  let bestLen = 0;
  for (const [pid, needle] of Object.entries(needles)) {
    if (needle && needle.length > bestLen && haystack.includes(needle)) {
      best = pid;
      bestLen = needle.length;
    }
  }
  return best;
}

/**
 * Property id for a Guesty listing name, or null when nothing matches.
 *
 * Null means "this row is not ours to claim". Callers must SKIP such a row,
 * never fall back to whatever property they happen to be processing: that
 * fallback is the exact bug this module exists to prevent.
 */
export function matchProperty(
  listing: string,
  listingMatches: Record<string, string>,
): string | null {
  const h = (listing || '').toLowerCase();
  if (!h) return null;
  return longestMatch(h, listingMatches) ?? longestMatch(h, NICKNAME_HINTS);
}

/**
 * Load the `listing_match` needle for every active property.
 *
 * Fails closed. An empty map would silently mark every row unmatched and
 * still return success, which is the shape of failure /api/ingest-guesty-csv
 * already had once.
 */
export async function loadListingMatches(
  sb: { from: (t: string) => any },
): Promise<Record<string, string>> {
  const { data, error } = await sb
    .from('properties')
    .select('id, listing_match')
    .eq('is_active', true);
  if (error) throw new Error(`listing_match load failed: ${error.message}`);
  const out: Record<string, string> = {};
  for (const row of (data || []) as Array<{ id: string | null; listing_match: string | null }>) {
    if (row.id && row.listing_match) out[row.id] = String(row.listing_match).toLowerCase();
  }
  if (Object.keys(out).length === 0) {
    throw new Error('No active properties carry a listing_match -- refusing to drop every CSV row silently');
  }
  return out;
}
