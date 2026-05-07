import type { CompetitorId, AddressMatch } from './types';

/**
 * Address matches for competitor listings, populated by manual research.
 *
 * Vacation rental managers deliberately obscure exact addresses (privacy +
 * anti-squatter), so matching listings to real addresses is a research
 * problem, not a scraping problem. This file is the source of truth for
 * what we've figured out so far. Each entry includes a confidence band and
 * one-line evidence so a future reviewer can audit and correct.
 *
 * Confidence bands:
 * - high    : verified against tax records / news / a unique fingerprint
 * - medium  : street confirmed, house number narrowed by photos or fingerprints
 * - low     : neighborhood/street inferred from listing name + Cape Ann
 *             geography only; not verified
 * - unknown : not yet researched (no entry here)
 *
 * Keyed by `${competitorId}::${listingSlug}`. See the wave comments below
 * for how the data was sourced.
 */
export const COMPETITOR_ADDRESSES: Partial<Record<string, AddressMatch>> = {
  // ════════════════════════════════════════════════════════════════════
  // VERIFIED ADDRESSES (high confidence — sourced from MLS, National
  // Register, or cross-listing sites where the slug encodes the address)
  // ════════════════════════════════════════════════════════════════════

  'atlantic-vacation-homes::annisquam-singing-pines': {
    addressGuess: '56 Thurston Point Rd, Gloucester, MA 01930',
    street: 'Thurston Point Rd',
    neighborhood: 'Annisquam',
    confidence: 'high',
    evidence: 'Cross-listed on beachhouse.com with the address in the URL slug. Matches all fingerprints (5BR, ~2418 sqft, Annisquam riverfront, "summer home of Governor Bates").',
  },

  'shoreway-management::beverly-1686-5br': {
    addressGuess: '337 Cabot St, Beverly, MA 01915',
    street: 'Cabot St',
    neighborhood: 'downtown Beverly',
    confidence: 'high',
    evidence: 'Hazadiah Smith House — First Period (1686), National Register listed 1990. 0.2 mi from Montserrat (370 Cabot), matches walk-to-Salem-train description.',
  },

  'shoreway-management::gloucester-cranberry-hill': {
    addressGuess: '33 Way Rd, Gloucester, MA 01930',
    street: 'Way Rd',
    neighborhood: 'Bass Rocks, East Gloucester',
    confidence: 'high',
    evidence: 'Verani MLS #73208421 + Homes.com both name the property "Cranberry Hill" at 33 Way Rd. Matches 22-acre lot, 1924 build, Ezra Phillips architect.',
  },

  'shoreway-management::salem-1824-robert-manning': {
    addressGuess: '33 Dearborn St, Salem, MA 01970',
    street: 'Dearborn St',
    neighborhood: 'North Salem',
    confidence: 'high',
    evidence: 'Library of Congress HABS MA-187 documents "Robert Manning Place, 33 Dearborn Street, Salem." Salem Public Library wiki: Manning (Hawthorne\'s uncle) built #33 in 1824 for his bride.',
  },

  // ────────────────────────────────────────────────────────────────────
  // ATLANTIC VACATION HOMES — Wave 1: name + Cape Ann geography
  // ────────────────────────────────────────────────────────────────────
  // Listings whose name betrays a specific street, beach, or village on
  // Cape Ann. These are LOW or MEDIUM confidence — street/area inferred
  // from the listing name, not verified against assessor records.

  'atlantic-vacation-homes::two-beaches-cottage': {
    neighborhood: 'between Long Beach and Good Harbor, East Gloucester',
    street: 'Atlantic Rd / Bass Ave area',
    confidence: 'low',
    evidence: 'AVH page: "Walk to Long Beach in 3 minutes, Good Harbor 8 minutes" — narrows to the Bass Ave / Atlantic Rd corridor.',
  },

  'atlantic-vacation-homes::granite-pier': {
    neighborhood: 'Pigeon Cove, Rockport',
    street: 'Granite Pier Rd',
    confidence: 'medium',
    evidence: 'Listing name + "Boat launch at the pier just 120 yards from the house" — Granite Pier Rd has ~10 houses within that radius.',
  },

  'atlantic-vacation-homes::granite-cottage': {
    neighborhood: 'Pigeon Cove / Granite St corridor, Rockport',
    street: 'Granite St',
    confidence: 'low',
    evidence: 'Name reference to Granite — Pigeon Cove\'s historic granite-quarry district runs along Granite St.',
  },

  'atlantic-vacation-homes::niles-beach-house': {
    neighborhood: 'Eastern Point, East Gloucester',
    street: 'Niles Beach Ave (opposite the beach)',
    confidence: 'medium',
    evidence: 'AVH page: "Walk a few steps across the street right onto Niles Beach" — narrows to Niles Beach Ave or Mussel Point Rd.',
  },

  'atlantic-vacation-homes::long-beach-house': {
    neighborhood: 'Long Beach, East Gloucester',
    street: 'Long Beach Rd / Bass Ave',
    confidence: 'medium',
    evidence: 'Name + "early 1900s" + "Just steps away" from Long Beach (Gloucester side).',
  },

  'atlantic-vacation-homes::mill-lane': {
    neighborhood: 'Rockport',
    street: 'Mill Lane',
    confidence: 'medium',
    evidence: 'Listing name = the street name. Mill Lane is a real ~10-house lane off Main St in Rockport.',
  },

  'atlantic-vacation-homes::pleasant-house-in-rockport': {
    neighborhood: 'Rockport',
    street: 'Pleasant St',
    confidence: 'medium',
    evidence: 'Listing name suggests Pleasant St, a real Rockport street.',
  },

  'atlantic-vacation-homes::rivers-edge': {
    neighborhood: 'Annisquam River area, Gloucester (likely Riverdale or Annisquam)',
    confidence: 'low',
    evidence: 'Name implies riverfront. Gloucester\'s named "river" is the Annisquam.',
  },

  'atlantic-vacation-homes::river-watch': {
    neighborhood: 'Annisquam River area, Gloucester',
    confidence: 'low',
    evidence: 'Same as River\'s Edge — Gloucester river = Annisquam.',
  },

  'atlantic-vacation-homes::ryal-side-hideaway-cove': {
    neighborhood: 'Ryal Side, Beverly',
    confidence: 'medium',
    evidence: 'Listing name = the Beverly neighborhood (north of downtown, on the Bass River).',
  },

  'atlantic-vacation-homes::sage-hill': {
    neighborhood: 'Rockport',
    street: 'Sage Hill Rd',
    confidence: 'medium',
    evidence: 'Listing name matches Sage Hill Rd, a real Rockport street.',
  },

  'atlantic-vacation-homes::salt-island-views': {
    neighborhood: 'East Gloucester (overlooking Salt Island)',
    street: 'Atlantic Rd',
    confidence: 'medium',
    evidence: 'Salt Island sits off Good Harbor Beach; Atlantic Rd is the cliff road that overlooks it.',
  },

  'atlantic-vacation-homes::squam-light': {
    neighborhood: 'Annisquam, Gloucester',
    street: 'Wigwam Hill / Lighthouse Rd area',
    confidence: 'medium',
    evidence: 'Annisquam Light sits on Wigwam Hill at the mouth of the Annisquam River.',
  },

  'atlantic-vacation-homes::straitsmouth-cove': {
    neighborhood: 'South Rockport (near Straitsmouth Island)',
    street: 'Straitsmouth Cove Lane / South St area',
    confidence: 'medium',
    evidence: 'Straitsmouth Cove Lane is the named access road to Straitsmouth Cove.',
  },

  'atlantic-vacation-homes::thurston-point-cottage': {
    neighborhood: 'Annisquam, Gloucester',
    street: 'Thurston Point Rd',
    confidence: 'medium',
    evidence: 'Listing name = the street. Thurston Point Rd is the small Annisquam lane (~15 houses). Distinct from "Annisquam Singing Pines" at 56 Thurston Point — same street, different house.',
  },

  'atlantic-vacation-homes::wingaerchic': {
    neighborhood: 'Wingaersheek, West Gloucester',
    street: 'Atlantic St / Concord St area',
    confidence: 'medium',
    evidence: 'Listing name is a phonetic play on Wingaersheek; the beach is accessed from Atlantic St / Concord St.',
  },

  'atlantic-vacation-homes::twin-lights': {
    neighborhood: 'South Rockport (near Thacher Island)',
    street: 'Marmion Way / Eden Rd corridor',
    confidence: 'medium',
    evidence: 'Twin Lights = Thacher Island twin lighthouses; Marmion Way and Eden Rd run the bluff facing the island.',
  },

  'atlantic-vacation-homes::just-for-the-halibut': {
    neighborhood: 'Pigeon Cove, Rockport (near Halibut Point)',
    confidence: 'medium',
    evidence: 'Halibut → Halibut Point State Reservation in north Rockport.',
  },

  'atlantic-vacation-homes::portside-at-front-beach': {
    neighborhood: 'Front Beach, downtown Rockport',
    street: 'Beach St / Mt Pleasant St area',
    confidence: 'medium',
    evidence: 'Listing name explicitly cites Front Beach; the beach fronts Beach St / Mt Pleasant.',
  },

  'atlantic-vacation-homes::portside-glimpse': {
    neighborhood: 'downtown Rockport (T-Wharf / Bearskin Neck area)',
    confidence: 'low',
    evidence: 'Portside cluster sits in the harbor district; specific street to be narrowed.',
  },

  'atlantic-vacation-homes::portside-walkabout': {
    neighborhood: 'downtown Rockport (T-Wharf / Bearskin Neck area)',
    confidence: 'low',
    evidence: 'Same Portside cluster as above.',
  },

  'atlantic-vacation-homes::portside-overlook': {
    neighborhood: 'downtown Rockport (T-Wharf / Bearskin Neck area)',
    confidence: 'low',
    evidence: 'Same Portside cluster as above.',
  },

  'atlantic-vacation-homes::cape-hedge-house': {
    neighborhood: 'Cape Hedge / South Rockport (Pebble Beach)',
    street: 'Penzance Rd / Land\'s End area',
    confidence: 'medium',
    evidence: 'Cape Hedge Beach (aka Pebble Beach) is accessed from Penzance Rd off Land\'s End.',
  },

  'atlantic-vacation-homes::painters-perch': {
    neighborhood: 'Rocky Neck art colony, East Gloucester',
    confidence: 'low',
    evidence: '"Painter\'s" + East Gloucester points to Rocky Neck, the historic artist colony.',
  },

  'atlantic-vacation-homes::salt-marsh-cottage': {
    neighborhood: 'West Gloucester (Wingaersheek / Annisquam marshes)',
    confidence: 'low',
    evidence: 'Cape Ann\'s salt marshes are along the Annisquam and Essex rivers.',
  },

  'atlantic-vacation-homes::mill-pond-cottage': {
    neighborhood: 'Annisquam, Gloucester (Mill Pond)',
    confidence: 'low',
    evidence: 'Mill Pond is in Annisquam, off Mill Pond Rd.',
  },

  'atlantic-vacation-homes::hastings-haven': {
    neighborhood: 'downtown Beverly (Hastings district)',
    street: 'Hastings Ave area',
    confidence: 'low',
    evidence: 'Beverly\'s Hastings district sits between downtown and Beverly Cove.',
  },

  'atlantic-vacation-homes::robbins-nest': {
    neighborhood: 'Essex village',
    confidence: 'low',
    evidence: 'Essex is small (~1 sq mi village) — most rentals cluster on Main St / Eastern Ave / John Wise.',
  },

  'atlantic-vacation-homes::over-by-good-harbor': {
    neighborhood: 'Good Harbor, East Gloucester',
    street: 'Atlantic Rd / Witham St / Bass Ave corridor',
    confidence: 'medium',
    evidence: 'Listing name explicitly cites Good Harbor Beach proximity.',
  },

  'atlantic-vacation-homes::golden-sands': {
    neighborhood: 'large beach-adjacent property, Gloucester (likely Wingaersheek or Long Beach)',
    confidence: 'low',
    evidence: '"Sands" + 7BR/12 sleeps suggests a large estate near a sand beach (Wingaersheek or Long Beach).',
  },

  // ────────────────────────────────────────────────────────────────────
  // SHORE WAY MANAGEMENT — Wave 1: name + town + Hospitable description
  // ────────────────────────────────────────────────────────────────────

  'shoreway-management::long-beach-oceanfront-4br': {
    neighborhood: 'Long Beach, South Rockport',
    street: 'Long Beach Rd / Penzance Rd corridor',
    confidence: 'medium',
    evidence: '"Oceanfront on Long Beach" + Rockport — Rockport side of Long Beach is accessed via Long Beach Rd / Penzance.',
  },

  'shoreway-management::rockport-3br-firepit': {
    neighborhood: 'downtown Rockport (near Bearskin Neck)',
    confidence: 'low',
    evidence: 'Listing name: "Walk to Bearskin Neck + Beach" — narrows to a few blocks of downtown Rockport.',
  },

  'shoreway-management::the-bookstore': {
    neighborhood: 'downtown Rockport (Bearskin Neck / Front Beach)',
    confidence: 'low',
    evidence: 'Listing name + "Steps to Front Beach, Bearskin Neck" + "former bookstore" — central Rockport.',
  },

  'shoreway-management::rockport-waterfront-penthouse': {
    neighborhood: 'Bearskin Neck, Rockport',
    confidence: 'low',
    evidence: 'Listing name explicitly cites Bearskin Neck.',
  },

  'shoreway-management::gloucester-the-mariner': {
    neighborhood: 'East Gloucester (Niles Beach / Rocky Neck)',
    confidence: 'medium',
    evidence: 'Listing description: "Steps from Niles Beach and Rocky Neck" — narrows to the Niles Beach Ave / Mussel Point area.',
  },

  'shoreway-management::rockport-dog-friendly-2br': {
    neighborhood: 'downtown Rockport (near Back Beach)',
    confidence: 'low',
    evidence: 'Listing description: "Steps to Back Beach + Bearskin Neck" — Back Beach side of downtown Rockport.',
  },

  'shoreway-management::manchester-singing-beach': {
    neighborhood: 'Manchester-by-the-Sea (near Singing Beach)',
    street: 'Beach St / Masconomo St area',
    confidence: 'medium',
    evidence: 'Listing offers Singing Beach passes; Singing Beach sits at the end of Beach St in Manchester.',
  },

  'shoreway-management::salem-common-1br': {
    neighborhood: 'Salem Common, downtown Salem',
    street: 'Washington Square area',
    confidence: 'medium',
    evidence: 'Listing: "1BR on Salem Common" — Salem Common is the public green; surrounding addresses are on Washington Sq.',
  },

  'shoreway-management::salem-witch-museum-1br': {
    neighborhood: 'downtown Salem (near Witch Museum)',
    street: 'Washington Square area',
    confidence: 'low',
    evidence: 'Witch Museum is at 19½ Washington Square N; listing is "steps to" it.',
  },

  'shoreway-management::gloucester-seaside-village': {
    neighborhood: 'Lanesville, Gloucester (Plum Cove Beach)',
    street: 'Washington St / Langsford St / Andrews St area',
    confidence: 'medium',
    evidence: 'Listing + VRBO #4332217ha: Plum Cove Beach steps away, <2 mi to Halibut Point. Lanesville core streets.',
  },

  'shoreway-management::gloucester-seaside-plum-cove': {
    neighborhood: 'Lanesville, Gloucester (Plum Cove)',
    street: 'Washington St / Langsford St / Andrews St area',
    confidence: 'medium',
    evidence: 'Same Plum Cove / Lanesville fingerprint as the sister "Seaside Village" listing.',
  },

  'shoreway-management::gloucester-antique-cottage': {
    neighborhood: 'Annisquam village, Gloucester',
    street: 'Wigwam Rd / Leonard St / Norwood Heights area',
    confidence: 'medium',
    evidence: 'Booking.com / Expedia cross-listings explicitly say "located in peaceful Annisquam"; "Lighthouse Beach" = Wigwam Beach by Annisquam Light.',
  },

  'shoreway-management::gloucester-bell-view-pickleball': {
    neighborhood: 'Bass Rocks / Back Shore, East Gloucester',
    street: 'Way Rd / Atlantic Rd corridor',
    confidence: 'medium',
    evidence: 'PickleTrip cross-listing: "stone\'s throw from Bass Rocks," "Rocky Neck art colony on the way in," long private driveway. Way Rd is the only quiet street fitting that geometry — likely a Cranberry Hill neighbor.',
  },

  'shoreway-management::marblehead-nautical-home': {
    neighborhood: 'Old Town Marblehead',
    confidence: 'low',
    evidence: '"Historic" + Marblehead → Old Town historic district.',
  },

  'shoreway-management::marblehead-1742-studio': {
    neighborhood: 'Old Town Marblehead (Captain Ben Andrews House)',
    confidence: 'medium',
    evidence: 'Listing identifies the building as "Captain Ben Andrews\'s home, 1742." Old Town Marblehead historic district. Specific street number not yet in MACRIS.',
  },

  'shoreway-management::essex-the-little-house': {
    neighborhood: 'Essex village',
    street: 'Main St / Eastern Ave / John Wise Ave',
    confidence: 'low',
    evidence: 'Listing: "Walk to Essex Waterfront + Beach" — Essex village core.',
  },
};

export function addressKey(competitorId: CompetitorId, listingSlug: string): string {
  return `${competitorId}::${listingSlug}`;
}

export function getAddressMatch(
  competitorId: CompetitorId,
  listingSlug: string,
): AddressMatch | undefined {
  return COMPETITOR_ADDRESSES[addressKey(competitorId, listingSlug)];
}
