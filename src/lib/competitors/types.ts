/**
 * Competitor module data shapes.
 *
 * A "competitor" is another vacation rental management company that operates
 * in the same Cape Ann / North Shore market as Rising Tide. We track the
 * portfolio of listings each competitor manages so we can benchmark size,
 * geography, unit mix, and (later) pricing & availability.
 *
 * Phase 1 stores listings as a static seed file per competitor. Phase 2 will
 * back this with Supabase + a periodic scrape so beds/baths/availability
 * stay in sync without manual updates.
 */

export type CompetitorId = 'atlantic-vacation-homes';

export type CompetitorListing = {
  /** Stable slug taken from the competitor's site, used as the primary key. */
  slug: string;
  /** Display name as the competitor markets the listing. */
  name: string;
  /** Town/city. We use the competitor's own classification (so AVH's
   *  "Manchester-by-the-Sea" stays as-is rather than getting normalized). */
  city: string;
  bedrooms: number;
  /** Half baths are common on the North Shore, so this is a number with a
   *  half step (e.g. 2.5). */
  bathrooms: number;
  /** Max guests / sleeps. */
  maxGuests: number;
  petFriendly: boolean;
  /** Absolute URL on the competitor's site — clickable from Helm. */
  url: string;
};

export type CompetitorMeta = {
  id: CompetitorId;
  /** Display name. */
  name: string;
  /** Short descriptor for cards, e.g. "Cape Ann · Vacation rental management". */
  tagline: string;
  /** Public website root, used in the competitor card. */
  homepage: string;
  /** Listing index URL — the page Helm links to for "see their full inventory". */
  listingsUrl: string;
  /** Towns the competitor operates in, in display order. */
  primaryMarkets: string[];
  /** When the seed data was last refreshed (YYYY-MM-DD). Surfaced as
   *  "Snapshot · 2026-05-07" so we know how stale the inventory is. */
  snapshotDate: string;
  /** One-line note on how the data was captured. */
  source: string;
};

export type CompetitorSummary = {
  meta: CompetitorMeta;
  totalListings: number;
  totalBedrooms: number;
  totalBaths: number;
  totalSleeps: number;
  petFriendlyCount: number;
  cityBreakdown: Array<{ city: string; count: number }>;
  /** Rooms-per-listing histogram; index 0 = studios/1BR, etc. */
  bedroomBreakdown: Array<{ bedrooms: number; count: number }>;
};

/** Compute summary statistics for a competitor's listings. */
export function summarizeCompetitor(
  meta: CompetitorMeta,
  listings: CompetitorListing[],
): CompetitorSummary {
  const cityCounts = new Map<string, number>();
  const bedroomCounts = new Map<number, number>();
  let totalBedrooms = 0;
  let totalBaths = 0;
  let totalSleeps = 0;
  let petFriendlyCount = 0;

  for (const l of listings) {
    cityCounts.set(l.city, (cityCounts.get(l.city) ?? 0) + 1);
    bedroomCounts.set(l.bedrooms, (bedroomCounts.get(l.bedrooms) ?? 0) + 1);
    totalBedrooms += l.bedrooms;
    totalBaths += l.bathrooms;
    totalSleeps += l.maxGuests;
    if (l.petFriendly) petFriendlyCount += 1;
  }

  const cityBreakdown = [...cityCounts.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));

  const bedroomBreakdown = [...bedroomCounts.entries()]
    .map(([bedrooms, count]) => ({ bedrooms, count }))
    .sort((a, b) => a.bedrooms - b.bedrooms);

  return {
    meta,
    totalListings: listings.length,
    totalBedrooms,
    totalBaths,
    totalSleeps,
    petFriendlyCount,
    cityBreakdown,
    bedroomBreakdown,
  };
}
