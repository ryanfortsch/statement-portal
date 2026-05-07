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

  // AVH winter-rental cross-listing sweep (verified via Apartments.com /
  // Rentable / Zillow / ApartmentList — AVH cross-lists their inventory as
  // long-stay winter rentals with full addresses on those platforms).

  'atlantic-vacation-homes::niles-beach-house': {
    addressGuess: '2 Eastern Point Blvd, Gloucester, MA 01930',
    street: 'Eastern Point Blvd',
    neighborhood: 'Eastern Point, East Gloucester',
    confidence: 'high',
    evidence: 'Apartments.com winter rental at 2 Eastern Point Blvd reproduces AVH copy verbatim — king/twin/queen/2-queen layout, "across the street to Niles Beach", Boston skyline views. VRBO #4135062.',
  },

  'atlantic-vacation-homes::captain-john-butman-house': {
    addressGuess: '7 Granite St, Rockport, MA 01966',
    street: 'Granite St',
    neighborhood: 'Pigeon Cove, Rockport',
    confidence: 'high',
    evidence: 'Apartments.com winter rental "Captain John Butman House" at 7 Granite St + MACRIS RCP.59 ("Butnam, John House" c.1760) at 7 Granite St. VRBO #2299860.',
  },

  'atlantic-vacation-homes::twin-lights': {
    addressGuess: '6 Charles St, Rockport, MA 01966',
    street: 'Charles St',
    neighborhood: 'Rockport',
    confidence: 'high',
    evidence: 'Rentable.co "Winter Rental: Twin Lights" at 6 Charles St (2BR/2BA matches AVH unit-120). VRBO #2739136. Note: distinct from "Twin Light Terrace" at 9 Twin Light Cir (a 4BR sister listing).',
  },

  'atlantic-vacation-homes::squam-light': {
    addressGuess: '24 Leonard St, Gloucester, MA 01930',
    street: 'Leonard St',
    neighborhood: 'Annisquam',
    confidence: 'high',
    evidence: 'ApartmentList winter rental "Squam Light" matches AVH copy (3BR upstairs, clawfoot tub) at 24 Leonard St. AVH unit-58.',
  },

  'atlantic-vacation-homes::wingaerchic': {
    addressGuess: '206 Atlantic St, Gloucester, MA 01930',
    street: 'Atlantic St',
    neighborhood: 'Wingaersheek, West Gloucester',
    confidence: 'high',
    evidence: 'Apartments.com / ApartmentList "206 Atlantic Street" = "private contemporary furnished house perched on a shady hilltop near Wingaersheek Beach", verbatim AVH copy. AVH unit-69.',
  },

  'atlantic-vacation-homes::two-beaches-cottage': {
    addressGuess: '16 Warwick Rd, Gloucester, MA 01930',
    street: 'Warwick Rd',
    neighborhood: 'between Long Beach and Good Harbor, East Gloucester',
    confidence: 'high',
    evidence: 'Rentable.co "Winter Rental: Two Beaches Cottage" at 16 Warwick Rd, 3BR, $2,975/mo, "ideally situated between Long Beach and Good Harbor". AVH unit-1.',
  },

  'atlantic-vacation-homes::salt-island-views': {
    addressGuess: '26 Salt Island Rd, Gloucester, MA 01930',
    street: 'Salt Island Rd',
    neighborhood: 'East Gloucester (overlooking Salt Island)',
    confidence: 'high',
    evidence: 'Apartments.com listing at 26 Salt Island Rd matches AVH copy (5-min walk to Good Harbor + Long Beach, 3BR/2BA). VRBO #991938. AVH unit-52.',
  },

  'atlantic-vacation-homes::mill-lane': {
    addressGuess: '6A Mill Lane, Rockport, MA 01966',
    street: 'Mill Lane',
    neighborhood: 'Rockport',
    confidence: 'high',
    evidence: 'Zillow + Trulia winter rental "Mill Lane" at 6A Mill Ln. Half of a duplex (sister 4BR is "Pleasant House"). AVH unit-38. VRBO #2261641.',
  },

  'atlantic-vacation-homes::granite-cottage': {
    addressGuess: '93 Granite St, Rockport, MA 01966',
    street: 'Granite St',
    neighborhood: 'Pigeon Cove, Rockport',
    confidence: 'high',
    evidence: 'Identified during AVH cross-listing sweep as the sister of Granite Pier on the Granite St / Phillips Ave run (Pigeon Cove). 1BR/1BA matches AVH unit-26.',
  },

  // ────────────────────────────────────────────────────────────────────
  // ATLANTIC VACATION HOMES — Wave 1: name + Cape Ann geography
  // ────────────────────────────────────────────────────────────────────
  // Listings whose name betrays a specific street, beach, or village on
  // Cape Ann. These are LOW or MEDIUM confidence — street/area inferred
  // from the listing name, not verified against assessor records.

  'atlantic-vacation-homes::granite-pier': {
    street: 'Granite St (Pigeon Cove)',
    neighborhood: 'Pigeon Cove, Rockport',
    confidence: 'medium',
    evidence: 'Sister of Granite Cottage (93 Granite St) and on the same Granite St / Phillips Ave run by the actual Granite Pier — "120 yards from the boat launch", per AVH copy. House # not yet pinned. VRBO #1044623.',
  },

  'atlantic-vacation-homes::long-beach-house': {
    neighborhood: 'Long Beach, East Gloucester',
    street: 'Long Beach Rd / Bass Ave',
    confidence: 'medium',
    evidence: 'Name + "early 1900s" + "Just steps away" from Long Beach (Gloucester side).',
  },

  'atlantic-vacation-homes::pleasant-house-in-rockport': {
    addressGuess: '6 Mill Lane, Rockport, MA 01966',
    street: 'Mill Lane',
    neighborhood: 'Rockport',
    confidence: 'medium',
    evidence: 'AVH copy: Mill Lane (1BR) "is part of a two-family home with a 4-bedroom house that is also available to rent" — that 4BR is Pleasant House. Mill Lane = 6A, so Pleasant House is the other half (6 or 6B). Not 17 Pleasant St (= unrelated Rockport House Inn).',
  },

  'atlantic-vacation-homes::booth-cottage': {
    addressGuess: '19 Old Neck Rd, Manchester-by-the-Sea, MA 01944',
    street: 'Old Neck Rd',
    neighborhood: 'Manchester-by-the-Sea',
    confidence: 'medium',
    evidence: 'Apartments.com indexes 19 Old Neck Rd as a Manchester rental; AVH copy places Booth Cottage on Old Neck Rd above former Old Neck Beach / Singing Beach (historic Junius Brutus Booth Jr. property, duplex-divided). VRBO #1053530.',
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
    street: 'South St (south end), Rockport',
    neighborhood: 'Cape Hedge / South Rockport',
    confidence: 'medium',
    evidence: 'Adjacent winter rentals on Apartments.com at 141 South St and 177 South St cite Cape Hedge Beach proximity; Cape Hedge House sits between them on the cliff overlooking Cape Hedge Beach. House # not yet pinned. VRBO #3483773.',
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
