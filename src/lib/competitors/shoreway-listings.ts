import type { CompetitorListing, CompetitorMeta } from './types';

/**
 * Shore Way Management (shorewaymanagement.hospitable.rentals) — North
 * Shore vacation-rental manager that runs on Hospitable's direct-booking
 * site product. Footprint overlaps Cape Ann (Rockport, Gloucester,
 * Manchester, Essex) but stretches further west into Salem / Beverly /
 * Marblehead / Ipswich, so they're more of a "North Shore" play than the
 * Cape-Ann-pure Atlantic Vacation Homes.
 *
 * Source: scraped from the homepage on 2026-05-07. Hospitable's site
 * exposes 38 listings on a single page (no pagination). Beds/baths/sleeps
 * come from listing card metadata. Most listings don't surface a pet
 * policy on the card — only "Dog Friendly 2BR Home" is marked pet-friendly
 * here. Backfill from detail pages in Phase 2.
 */
export const SHOREWAY_META: CompetitorMeta = {
  id: 'shoreway-management',
  name: 'Shore Way Management',
  tagline: 'North Shore · Vacation rental management on Hospitable',
  homepage: 'https://shorewaymanagement.hospitable.rentals',
  listingsUrl: 'https://shorewaymanagement.hospitable.rentals/',
  primaryMarkets: ['Rockport', 'Salem', 'Gloucester', 'Beverly', 'Marblehead', 'Manchester-by-the-Sea', 'Essex', 'Ipswich'],
  snapshotDate: '2026-05-07',
  source: 'Scraped from Hospitable rentals homepage. Beds/baths/sleeps from listing cards.',
};

const BASE = 'https://shorewaymanagement.hospitable.rentals/property/';

const raw: Array<Omit<CompetitorListing, 'url'> & { path: string }> = [
  { slug: 'ipswich-riverfront-lodge',          path: 'ipswich-riverfront-lodgesleeps-10kayakcanoe',          name: 'Ipswich Riverfront Lodge',                 city: 'Ipswich',               bedrooms: 5, bathrooms: 2.5, maxGuests: 10, petFriendly: false },
  { slug: 'long-beach-oceanfront-4br',         path: 'rare-oceanfront-4-br-long-beach-vacation-home',        name: '4BR Oceanfront on Long Beach',              city: 'Rockport',              bedrooms: 4, bathrooms: 2,   maxGuests: 8,  petFriendly: false },
  { slug: 'rockport-3br-firepit',              path: 'newly-renovated-homeyardwalk-to-bearskin-neck',        name: 'Rockport 3BR with Firepit',                 city: 'Rockport',              bedrooms: 3, bathrooms: 2.5, maxGuests: 8,  petFriendly: false },
  { slug: 'beverly-2br-coming-soon',           path: 'coming-soon-downtownbeverly-2br',                      name: 'Downtown Beverly 2BR',                      city: 'Beverly',               bedrooms: 2, bathrooms: 1,   maxGuests: 4,  petFriendly: false },
  { slug: 'beverly-garden-getaway',            path: 'newgarden-getaway2br-minutes-to-salemtrain',           name: 'Beverly Garden Getaway',                    city: 'Beverly',               bedrooms: 2, bathrooms: 1,   maxGuests: 4,  petFriendly: false },
  { slug: 'rockport-2br-2-king-beds',          path: '2br2bath2-floors2-king-bedsprivate-parking',           name: 'Rockport 2BR · Steps to Beach',             city: 'Rockport',              bedrooms: 2, bathrooms: 2,   maxGuests: 6,  petFriendly: false },
  { slug: 'rockport-balcony-king-suite',       path: '2br25bathking-suitebalconyreserved-parking',           name: 'Rockport Balcony King Suite',               city: 'Rockport',              bedrooms: 2, bathrooms: 2.5, maxGuests: 4,  petFriendly: false },
  { slug: 'rockport-1br-ocean-view',           path: '1brprivate-deck-with-ocean-viewsking-bedparking',      name: 'Rockport 1BR · Ocean View Deck',            city: 'Rockport',              bedrooms: 1, bathrooms: 1,   maxGuests: 2,  petFriendly: false },
  { slug: 'the-bookstore',                     path: 'the-bookstore2-private-parking-spots2-king-beds',      name: 'The Bookstore',                             city: 'Rockport',              bedrooms: 2, bathrooms: 1,   maxGuests: 4,  petFriendly: false },
  { slug: 'beverly-1686-5br',                  path: 'historic-1686-5br-downtown-home-minutes-to-salem',     name: 'Historic 1686 5BR Beverly',                 city: 'Beverly',               bedrooms: 5, bathrooms: 3,   maxGuests: 8,  petFriendly: false },
  { slug: 'rockport-studio',                   path: 'new-rockport-studiowalk-to-bearskin-neckparking',      name: 'Rockport Studio',                           city: 'Rockport',              bedrooms: 0, bathrooms: 1,   maxGuests: 2,  petFriendly: false },
  { slug: 'salem-1824-robert-manning',         path: '1824-robert-manning-placehalloweenparkingsalem',       name: '1824 Robert Manning Place',                 city: 'Salem',                 bedrooms: 3, bathrooms: 2,   maxGuests: 8,  petFriendly: false },
  { slug: 'gloucester-3br-harborside',         path: 'new-3br-harborside-homebackyardgrillocean-views',      name: '3BR Harborside Home',                       city: 'Gloucester',            bedrooms: 3, bathrooms: 2,   maxGuests: 8,  petFriendly: false },
  { slug: 'gloucester-2br-harbor-home',        path: '2br-harborside-homegloucesterrockportocean-view',      name: '2BR Harbor Home · Ocean View',              city: 'Gloucester',            bedrooms: 2, bathrooms: 3,   maxGuests: 6,  petFriendly: false },
  { slug: 'marblehead-nautical-home',          path: 'historic-marblehead-nautical-homeminutes-to-salem',    name: 'Historic Marblehead Nautical Home',         city: 'Marblehead',            bedrooms: 2, bathrooms: 1,   maxGuests: 4,  petFriendly: false },
  { slug: 'salem-4br-historic',                path: '4br-salem-wparkingminutes-to-haunted-happenings',      name: '4BR Historic Salem',                        city: 'Salem',                 bedrooms: 4, bathrooms: 2,   maxGuests: 7,  petFriendly: false },
  { slug: 'salem-1803-1br',                    path: 'steps-2-haunted-happenings-1803-historic-salem',       name: '1803 Downtown Salem 1BR',                   city: 'Salem',                 bedrooms: 1, bathrooms: 1,   maxGuests: 2,  petFriendly: false },
  { slug: 'rockport-family-friendly-2br',      path: 'new-2br-homeminutes-to-downtown-rockportbeach',        name: 'Family Friendly Rockport 2BR',              city: 'Rockport',              bedrooms: 2, bathrooms: 1.5, maxGuests: 4,  petFriendly: false },
  { slug: 'gloucester-antique-cottage',        path: 'antique-cottageprivate-saunabeachfirepitgrill',        name: 'Antique Cottage · Private Sauna',           city: 'Gloucester',            bedrooms: 2, bathrooms: 1.5, maxGuests: 6,  petFriendly: false },
  { slug: 'gloucester-seaside-village',        path: 'seaside-village-homeprivate-fenced-yardkayaks',        name: 'Seaside Village Home · Sleeps 7',           city: 'Gloucester',            bedrooms: 2, bathrooms: 2,   maxGuests: 7,  petFriendly: false },
  { slug: 'rockport-waterfront-penthouse',     path: 'new-rare-waterfront-luxury-penthousebearskin-neck',    name: 'Waterfront Luxury Penthouse',               city: 'Rockport',              bedrooms: 1, bathrooms: 1,   maxGuests: 5,  petFriendly: false },
  { slug: 'gloucester-the-mariner',            path: 'the-mariner3br25-bthwalk-to-beachbackyard',            name: 'The Mariner',                               city: 'Gloucester',            bedrooms: 3, bathrooms: 2.5, maxGuests: 8,  petFriendly: false },
  { slug: 'rockport-dog-friendly-2br',         path: 'renovated-dog-friendly-home-steps-to-back-beach',      name: 'Dog Friendly 2BR · Back Beach',             city: 'Rockport',              bedrooms: 2, bathrooms: 1.5, maxGuests: 4,  petFriendly: true  },
  { slug: 'rockport-2br-downtown-parking',     path: 'new-2br-homeminutes-to-downtown-rockportbeach-1',      name: 'Rockport 2BR · Downtown',                   city: 'Rockport',              bedrooms: 2, bathrooms: 1,   maxGuests: 5,  petFriendly: false },
  { slug: 'marblehead-1742-studio',            path: 'historic1742minutes-to-salemprivate-parking',          name: '1742 Marblehead Studio',                    city: 'Marblehead',            bedrooms: 0, bathrooms: 1,   maxGuests: 3,  petFriendly: false },
  { slug: 'manchester-singing-beach',          path: 'singing-beach-passesoutdoor-fireplaceking-bed',        name: 'Manchester · Singing Beach Passes',         city: 'Manchester-by-the-Sea', bedrooms: 4, bathrooms: 3,   maxGuests: 8,  petFriendly: false },
  { slug: 'salem-1br-2-floor',                 path: 'new-spacious-1br-wparking-in-the-heart-of-salem',      name: 'Salem 2-Floor 1BR',                         city: 'Salem',                 bedrooms: 1, bathrooms: 1,   maxGuests: 4,  petFriendly: false },
  { slug: 'salem-common-1br',                  path: 'new-1br-on-salem-common-l-parking-l-walk-to-town',     name: '1BR on Salem Common',                       city: 'Salem',                 bedrooms: 1, bathrooms: 1,   maxGuests: 4,  petFriendly: false },
  { slug: 'salem-witch-museum-1br',            path: 'new-1br-downtown-salem-steps-2-witch-museum',          name: 'Salem 1BR · Steps to Witch Museum',         city: 'Salem',                 bedrooms: 1, bathrooms: 1,   maxGuests: 4,  petFriendly: false },
  { slug: 'rockport-4br-walk-beach',           path: '4br-home-walk-to-beach-downtown-parking',              name: 'Rockport 4BR · Walk to Beach',              city: 'Rockport',              bedrooms: 4, bathrooms: 2,   maxGuests: 8,  petFriendly: false },
  { slug: 'salem-3br-townhouse',               path: '3br-townhouse-walk-2-downtown-salem-parking',          name: 'Salem 3BR Townhouse',                       city: 'Salem',                 bedrooms: 3, bathrooms: 2.5, maxGuests: 8,  petFriendly: false },
  { slug: 'gloucester-cranberry-hill',         path: 'cranberry-hill-9-br-22-acre-estate-sleeps-22',         name: 'Cranberry Hill · 22 Acre Estate',           city: 'Gloucester',            bedrooms: 9, bathrooms: 6.5, maxGuests: 16, petFriendly: false },
  { slug: 'gloucester-3br-oceanview',          path: '3br-oceanviewtownhousewalk-to-downtownsleeps-8',       name: 'Oceanview 3BR Townhouse',                   city: 'Gloucester',            bedrooms: 3, bathrooms: 2,   maxGuests: 8,  petFriendly: false },
  { slug: 'salem-1803-1br-haunted',            path: 'new-1803-salem-1br-walk-2-haunted-happenings',         name: '1803 Salem 1BR · Haunted Happenings',       city: 'Salem',                 bedrooms: 1, bathrooms: 1,   maxGuests: 2,  petFriendly: false },
  { slug: 'gloucester-bell-view-pickleball',   path: 'bell-view-pickleballviews',                            name: 'Bell View · Private Pickleball',            city: 'Gloucester',            bedrooms: 6, bathrooms: 5,   maxGuests: 16, petFriendly: false },
  { slug: 'rockport-3br-coastal-retreat',      path: '3br-rockport-coastal-retreat-walk-to-beach',           name: 'Rockport 3BR Coastal Retreat',              city: 'Rockport',              bedrooms: 3, bathrooms: 1.5, maxGuests: 8,  petFriendly: false },
  { slug: 'essex-the-little-house',            path: 'the-little-housewalk-to-essex-waterfrontbeach',        name: 'The Little House · Essex',                  city: 'Essex',                 bedrooms: 1, bathrooms: 1,   maxGuests: 2,  petFriendly: false },
  { slug: 'gloucester-seaside-plum-cove',      path: 'seaside-homesleeps-6plum-cove-beachrockport',          name: 'Seaside Home · Plum Cove Beach',            city: 'Gloucester',            bedrooms: 3, bathrooms: 2.5, maxGuests: 6,  petFriendly: false },
];

export const SHOREWAY_LISTINGS: CompetitorListing[] = raw.map(({ path, ...rest }) => ({
  ...rest,
  url: `${BASE}${path}`,
}));
