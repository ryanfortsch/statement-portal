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

export type CompetitorId = 'atlantic-vacation-homes' | 'shoreway-management';

export type CompetitorListing = {
  /** Stable slug taken from the competitor's site, used as the primary key. */
  slug: string;
  /** Display name as the competitor markets the listing. */
  name: string;
  /** Town/city. We use the competitor's own classification (so AVH's
   *  "Manchester-by-the-Sea" stays as-is rather than getting normalized). */
  city: string;
  /** Number of bedrooms. 0 = studio. */
  bedrooms: number;
  /** Half baths are common on the North Shore, so this is a number with a
   *  half step (e.g. 2.5). */
  bathrooms: number;
  /** Max guests / sleeps. */
  maxGuests: number;
  petFriendly: boolean;
  /** Absolute URL on the competitor's site — clickable from Helm. */
  url: string;
  /** Best-guess physical address. Filled in by manual research — vacation
   *  rental sites deliberately obscure addresses, so this builds up over
   *  time with confidence bands. Undefined = not yet researched. */
  address?: AddressMatch;
};

/**
 * The address research result for a single listing. We track confidence
 * because vacation rental managers hide exact addresses by design — most
 * matches will be neighborhood-level, some street-level, a few full-address.
 */
export type AddressMatch = {
  /** Street name when we know it, even if not the number. e.g. "Niles Beach Avenue". */
  street?: string;
  /** Neighborhood / village / landmark cluster. e.g. "Annisquam", "East Gloucester · Niles Beach". */
  neighborhood?: string;
  /** Best guess at full address when we have one. e.g. "21 Granite Pier Rd, Rockport". */
  addressGuess?: string;
  /** How much we trust this match.
   *  - high   : verified against assessor records / news / a tax-record fingerprint that uniquely identifies the property
   *  - medium : street confirmed, number narrowed to ~3 candidates from photo or fingerprints
   *  - low    : neighborhood/street guessed from property name; not verified
   *  - unknown: not yet researched */
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  /** One-line note on how we got here, for review. e.g. "AVH page says 'across from Niles Beach' + East Gloucester town record". */
  evidence?: string;
  /** Property owner of record per the town assessor (Vision Government
   *  Solutions). Often an LLC for vacation rentals. */
  owner?: string;
  /** One-line note about how we got the owner, e.g. assessor portal URL,
   *  or a Secretary of State LLC lookup that links the LLC to a person. */
  ownerNote?: string;
  /** True when this match came from a user-entered override
   *  (competitor_listing_overrides table) rather than the static research
   *  overlay. Renders a slightly different "verified by you" chip. */
  userVerified?: boolean;
  /** Email of the team member who verified this, surfaced in a tooltip. */
  verifiedByEmail?: string;
  /** ISO timestamp the user verification happened, for the tooltip. */
  verifiedAt?: string;
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
