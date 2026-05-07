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
    owner: 'Mcavoy, Elizabeth K',
    ownerNote: 'Beverly assessor (parcel F_823764_3027769); individual ownership, last sold Dec 2020 for $510k. Not held by a preservation society despite National Register status.',
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
    owner: '33 Dearborn Street LLC',
    ownerNote: 'Salem assessor (Patriot Properties). Single-asset LLC — typical STR investor structure. Manager / registered agent not retrieved (MA SOS lookup behind interactive search).',
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
    owner: 'Curran, Joseph & Virginia',
    ownerNote: 'Rockport assessor (Patriot Properties), parcel 18-7-199. Condo, built 1760.',
  },

  'atlantic-vacation-homes::twin-lights': {
    addressGuess: '6 Charles St, Rockport, MA 01966',
    street: 'Charles St',
    neighborhood: 'Rockport',
    confidence: 'high',
    evidence: 'Rentable.co "Winter Rental: Twin Lights" at 6 Charles St (2BR/2BA matches AVH unit-120). VRBO #2739136. Note: distinct from "Twin Light Terrace" at 9 Twin Light Cir (a 4BR sister listing).',
    owner: 'Wang, Valerie & Jones, Graham',
    ownerNote: 'Rockport assessor (Patriot Properties), parcel 18-11. Built 1949 Ranch; sold 8/16/2021 for $580k.',
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
    evidence: 'Zillow + Trulia winter rental "Mill Lane" at 6A Mill Ln. Half of a duplex; sister 4BR is Mill Brook House. AVH unit-38. VRBO #2261641.',
    owner: 'Kelley, Kevin Christopher Jr & Gruenberg-Kelley, Sandra',
    ownerNote: 'Rockport assessor (Patriot Properties), parcel 18-352. 6 / 6A is one Two Family parcel with a single owner pair. Built 1750; sold 8/5/2013 for $580k.',
  },

  'atlantic-vacation-homes::granite-cottage': {
    addressGuess: '93 Granite St, Rockport, MA 01966',
    street: 'Granite St',
    neighborhood: 'Pigeon Cove, Rockport',
    confidence: 'high',
    evidence: 'Identified during AVH cross-listing sweep as the sister of Granite Pier on the Granite St / Phillips Ave run (Pigeon Cove). 1BR/1BA matches AVH unit-26.',
    owner: 'Rockport Gem Properties LLC (mgr Robert A Meyer)',
    ownerNote: 'Rockport assessor parcel 17-22. MA SOS ID 001269399 — manager Robert A Meyer, 97 Montgomery Ave, Scarsdale NY 10583; resident agent Robert L. Visnick, Rockport. LLC was administratively dissolved 12/30/2022 (still assessor owner of record).',
  },

  // AVH winter-rental cross-listing sweep — Wave 5 (Apartments.com /
  // Rentable / Trulia / ApartmentList).

  'atlantic-vacation-homes::helena-house': {
    addressGuess: '11 S Kilby St, Gloucester, MA 01930',
    street: 'S Kilby St',
    neighborhood: 'Bay View, Gloucester',
    confidence: 'high',
    evidence: 'Apartments.com winter rental at 11 S Kilby St — "Bay View neighborhood, Queen Anne", matches AVH Helena House (3BR/2.5BA, pet-friendly).',
  },

  'atlantic-vacation-homes::the-gallery': {
    addressGuess: '37 Rocky Neck Ave, Gloucester, MA 01930',
    street: 'Rocky Neck Ave',
    neighborhood: 'Rocky Neck art colony, East Gloucester',
    confidence: 'high',
    evidence: 'Apartments.com "Winter Rental: The Gallery" at 37 Rocky Neck Ave (3BR/3BA matches AVH unit-308).',
  },

  'atlantic-vacation-homes::perrywinkle': {
    addressGuess: '5 Rackliffe St, Gloucester, MA 01930',
    street: 'Rackliffe St',
    neighborhood: 'Gloucester',
    confidence: 'high',
    evidence: 'Apartments.com URL slug literally "winter-rental-perrywinkle" at 5 Rackliffe St (4BR/3BA matches AVH unit-41).',
  },

  'atlantic-vacation-homes::josephs-way': {
    addressGuess: '10 Josephs Way, Gloucester, MA 01930',
    street: 'Josephs Way',
    neighborhood: 'Gloucester',
    confidence: 'high',
    evidence: 'Rentable.co "Winter Rental: Joseph\'s Way" at 10 Josephs Way (the listing name = the street name).',
  },

  'atlantic-vacation-homes::tidebend': {
    addressGuess: '64 Riverview Rd, Gloucester, MA 01930',
    street: 'Riverview Rd',
    neighborhood: 'Annisquam River, Gloucester',
    confidence: 'high',
    evidence: 'Rentable.co "Exceptional 6-bedroom Home Overlooking The Annisquam River" at 64 Riverview Rd (matches AVH 6BR/2.5BA).',
  },

  'atlantic-vacation-homes::mill-pond-cottage': {
    addressGuess: '379 Washington St, Gloucester, MA 01930',
    street: 'Washington St',
    neighborhood: 'Annisquam (Mill Pond)',
    confidence: 'high',
    evidence: 'Rentable.co / ApartmentList "Winter Rental: Mill Pond Cottage" at 379 Washington St (3BR matches AVH unit-289).',
  },

  'atlantic-vacation-homes::thorwald-by-the-sea': {
    addressGuess: '19 Atlantic Rd, Gloucester, MA 01930',
    street: 'Atlantic Rd',
    neighborhood: 'East Gloucester (Atlantic Rd cliff)',
    confidence: 'high',
    evidence: 'Rentable.co "Winter Rental at the Thorwald Condos" at 19 Atlantic Rd (2BR/1.5BA matches AVH unit-68).',
  },

  'atlantic-vacation-homes::garden-by-the-sea': {
    addressGuess: '24 Atlantic Rd, Gloucester, MA 01930',
    street: 'Atlantic Rd',
    neighborhood: 'East Gloucester (Atlantic Rd cliff)',
    confidence: 'high',
    evidence: 'Apartments.com URL "24-atlantic-rd-gloucester-ma-unit-garden-by-the-sea" (2BR matches AVH unit-24, walk to Good Harbor).',
  },

  'atlantic-vacation-homes::harbortown-hideaway': {
    addressGuess: '13 Middle St, Gloucester, MA 01930',
    street: 'Middle St',
    neighborhood: 'downtown Gloucester',
    confidence: 'high',
    evidence: 'Trulia "Winter rental: Harbortown Hideaway" at 13 Middle St (matches AVH unit-121).',
  },

  'atlantic-vacation-homes::mill-brook-house': {
    addressGuess: '6 Mill Lane, Rockport, MA 01966',
    street: 'Mill Lane',
    neighborhood: 'Rockport',
    confidence: 'high',
    evidence: 'Apartments.com "6 Mill Ln Unit Mill Brook House" (4BR matches AVH unit-310). Duplex sister of Mill Lane (6A) — not Pleasant House.',
    owner: 'Kelley, Kevin Christopher Jr & Gruenberg-Kelley, Sandra',
    ownerNote: 'Same Rockport parcel 18-352 as Mill Lane (6 / 6A is one Two Family parcel).',
  },

  // ────────────────────────────────────────────────────────────────────
  // ATLANTIC VACATION HOMES — Wave 1: name + Cape Ann geography
  // ────────────────────────────────────────────────────────────────────
  // Listings whose name betrays a specific street, beach, or village on
  // Cape Ann. These are LOW or MEDIUM confidence — street/area inferred
  // from the listing name, not verified against assessor records.

  'atlantic-vacation-homes::granite-pier': {
    street: 'Granite St / Phillips Ave (Pigeon Cove)',
    neighborhood: 'Pigeon Cove, Rockport',
    confidence: 'medium',
    evidence: 'Sister of Granite Cottage (93 Granite St) and on the same Granite St / Phillips Ave run by the actual Granite Pier — "120 yards from the boat launch", per AVH copy. House # not pinned (107 Granite St surfaced as a winter rental but its schoolhouse description doesn\'t match AVH\'s "270° views" copy — likely a different unit). VRBO #1044623.',
  },

  'atlantic-vacation-homes::long-beach-house': {
    neighborhood: 'Long Beach, East Gloucester',
    street: 'Long Beach Rd / Bass Ave',
    confidence: 'medium',
    evidence: 'Name + "early 1900s" + "Just steps away" from Long Beach (Gloucester side).',
  },

  'atlantic-vacation-homes::pleasant-house-in-rockport': {
    neighborhood: 'Rockport',
    street: 'Pleasant St (likely)',
    confidence: 'low',
    evidence: 'Earlier guess pinned this to 6 Mill Lane (the duplex sister of Mill Lane), but Wave 5 confirmed Mill Brook House at 6 Mill Ln is that sister. Pleasant House is more likely on Pleasant St itself; 17 Pleasant St is the Rockport House Inn (unrelated), so a different Pleasant St #. Not yet verified.',
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
    addressGuess: '52 Marmion Way, Rockport, MA 01966',
    street: 'Marmion Way',
    neighborhood: 'South Rockport (Gap Cove)',
    confidence: 'high',
    evidence: 'Apartments.com 52 Marmion Way matches AVH Straitsmouth Cove copy ("Gap Cove views, vintage country manor, antique brick fireplace", 5BR/2BA = AVH unit-59).',
    owner: 'Wagner, Jennifer & Edward',
    ownerNote: 'Rockport assessor parcel 30-37. Built 1928 Colonial; sold 3/9/2018 for $1.5M.',
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

  'atlantic-vacation-homes::portside-glimpse': {
    addressGuess: '8 Hale St, Rockport, MA 01966',
    street: 'Hale St',
    neighborhood: 'downtown Rockport (Bearskin Neck side)',
    confidence: 'high',
    evidence: 'Zillow apartments + Trulia "Winter Rental: Portside Glimpse" at 8 Hale St (1BR matches AVH unit-303).',
    owner: 'Driver, Erin Bridget & Simon James',
    ownerNote: 'Rockport assessor parcel 18-419. Built 1850, Multi-Conv (Three Family), 5BR/4BA — entire building is one parcel with a single owner pair, despite multiple AVH Portside listings inside.',
  },

  'atlantic-vacation-homes::portside-overlook': {
    addressGuess: '8 Hale St, Rockport, MA 01966',
    street: 'Hale St',
    neighborhood: 'downtown Rockport (Bearskin Neck side)',
    confidence: 'high',
    evidence: 'Zillow apartments "Winter Rental: Portside Overlook" at 8 Hale St — same building as the other Portside listings; likely a multi-unit conversion.',
    owner: 'Driver, Erin Bridget & Simon James',
    ownerNote: 'Same parcel as Portside Glimpse — Drivers own the entire 8 Hale St building.',
  },

  'atlantic-vacation-homes::portside-walkabout': {
    street: 'Hale St (likely)',
    neighborhood: 'downtown Rockport (Bearskin Neck side)',
    confidence: 'medium',
    evidence: 'Sister of Portside Glimpse + Overlook (8 Hale St) per the Portside cluster naming pattern; specific unit not yet confirmed.',
  },

  'atlantic-vacation-homes::portside-at-front-beach': {
    street: 'Hale St / Beach St / Mt Pleasant area, Rockport',
    neighborhood: 'Front Beach / Bearskin Neck side, downtown Rockport',
    confidence: 'medium',
    evidence: 'Largest Portside listing (4BR/4BA); same Hale St cluster likely, or one block over toward Front Beach.',
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
    addressGuess: '57 Grapevine Rd, Gloucester, MA 01930',
    street: 'Grapevine Rd',
    neighborhood: 'East Gloucester (Bass Rocks side)',
    confidence: 'high',
    evidence: 'Apartments.com "Bell View - Entire Home" at 57 Grapevine Rd; Grapevine Rd runs to Bass Rocks, fits the PickleTrip "stone\'s throw from Bass Rocks, Rocky Neck on the way in" description.',
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
