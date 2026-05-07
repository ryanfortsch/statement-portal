import type { CompetitorListing, CompetitorMeta } from './types';

/**
 * Atlantic Vacation Homes (atlanticvacationhomes.com) — the dominant
 * vacation-rental management company on Cape Ann. They list ~66 properties
 * across Gloucester, Rockport, Beverly, Manchester-by-the-Sea, Newbury, and
 * Essex. This is Rising Tide's most direct competitor by geography and unit
 * mix.
 *
 * Source: scraped from /vacation-rentals on 2026-05-07. Beds/baths/sleeps
 * come from the public listing cards. URLs follow the pattern
 *   /vrp/unit/<slug>-<id>-15
 * where 15 is AVH's account ID on their PMS. The id is what we'd correlate
 * to in Phase 2 when we wire up nightly availability scraping.
 */
export const AVH_META: CompetitorMeta = {
  id: 'atlantic-vacation-homes',
  name: 'Atlantic Vacation Homes',
  tagline: 'Cape Ann · Full-service vacation rental management',
  homepage: 'https://www.atlanticvacationhomes.com',
  listingsUrl: 'https://www.atlanticvacationhomes.com/vacation-rentals',
  primaryMarkets: ['Gloucester', 'Rockport', 'Beverly', 'Manchester-by-the-Sea', 'Essex', 'Newbury'],
  snapshotDate: '2026-05-07',
  source: 'Scraped from /vacation-rentals listing index. Beds/baths from public cards.',
};

const AVH_BASE = 'https://www.atlanticvacationhomes.com/vrp/unit/';

const raw: Array<Omit<CompetitorListing, 'url'> & { path: string }> = [
  { slug: 'two-beaches-cottage',         path: 'Two_Beaches_Cottage-1-15',          name: 'Two Beaches Cottage',         city: 'Gloucester',             bedrooms: 3, bathrooms: 1.5, maxGuests: 8,  petFriendly: true  },
  { slug: 'afternoon-delight',           path: 'Afternoon_Delight-4-15',            name: 'Afternoon Delight',           city: 'Beverly',                bedrooms: 3, bathrooms: 2,   maxGuests: 6,  petFriendly: true  },
  { slug: 'annisquam-singing-pines',     path: 'Annisquam_Singing_Pines-8-15',      name: 'Annisquam Singing Pines',     city: 'Gloucester',             bedrooms: 5, bathrooms: 2,   maxGuests: 10, petFriendly: false },
  { slug: 'beach-bungalow',              path: 'Beach_Bungalow-9-15',               name: 'Beach Bungalow',              city: 'Rockport',               bedrooms: 2, bathrooms: 1,   maxGuests: 5,  petFriendly: false },
  { slug: 'booth-cottage',               path: 'Booth_Cottage-14-15',               name: 'Booth Cottage',               city: 'Manchester-by-the-Sea',  bedrooms: 4, bathrooms: 3.5, maxGuests: 8,  petFriendly: true  },
  { slug: 'changes-in-latitude',         path: 'Changes_In_Latitude-17-15',         name: 'Changes In Latitude',         city: 'Gloucester',             bedrooms: 3, bathrooms: 2,   maxGuests: 6,  petFriendly: false },
  { slug: 'garden-by-the-sea',           path: 'Garden_by_the_Sea-24-15',           name: 'Garden by the Sea',           city: 'Gloucester',             bedrooms: 2, bathrooms: 1,   maxGuests: 4,  petFriendly: false },
  { slug: 'golden-sands',                path: 'Golden_Sands-25-15',                name: 'Golden Sands',                city: 'Gloucester',             bedrooms: 7, bathrooms: 3.5, maxGuests: 12, petFriendly: false },
  { slug: 'granite-cottage',             path: 'Granite_Cottage-26-15',             name: 'Granite Cottage',             city: 'Rockport',               bedrooms: 1, bathrooms: 1,   maxGuests: 4,  petFriendly: false },
  { slug: 'granite-pier',                path: 'Granite_Pier-27-15',                name: 'Granite Pier',                city: 'Rockport',               bedrooms: 3, bathrooms: 2,   maxGuests: 8,  petFriendly: true  },
  { slug: 'helena-house',                path: 'Helena_House-29-15',                name: 'Helena House',                city: 'Gloucester',             bedrooms: 3, bathrooms: 2.5, maxGuests: 7,  petFriendly: true  },
  { slug: 'captain-john-butman-house',   path: 'Captain_John_Butman_House-31-15',   name: 'Captain John Butman House',   city: 'Rockport',               bedrooms: 3, bathrooms: 2,   maxGuests: 6,  petFriendly: true  },
  { slug: 'josephs-way',                 path: 'Josephs_Way-32-15',                 name: "Joseph's Way",                city: 'Gloucester',             bedrooms: 2, bathrooms: 1,   maxGuests: 4,  petFriendly: true  },
  { slug: 'long-beach-house',            path: 'Long_Beach_House-36-15',            name: 'Long Beach House',            city: 'Gloucester',             bedrooms: 5, bathrooms: 2.5, maxGuests: 10, petFriendly: true  },
  { slug: 'mill-lane',                   path: 'Mill_Lane-38-15',                   name: 'Mill Lane',                   city: 'Rockport',               bedrooms: 1, bathrooms: 1,   maxGuests: 3,  petFriendly: false },
  { slug: 'over-by-good-harbor',         path: 'Over_By_Good_Harbor-40-15',         name: 'Over By Good Harbor',         city: 'Gloucester',             bedrooms: 4, bathrooms: 3.5, maxGuests: 10, petFriendly: true  },
  { slug: 'perrywinkle',                 path: 'Perrywinkle-41-15',                 name: 'Perrywinkle',                 city: 'Gloucester',             bedrooms: 4, bathrooms: 3,   maxGuests: 7,  petFriendly: false },
  { slug: 'pleasant-house-in-rockport',  path: 'Pleasant_House_in_Rockport-44-15',  name: 'Pleasant House in Rockport',  city: 'Rockport',               bedrooms: 4, bathrooms: 4,   maxGuests: 10, petFriendly: false },
  { slug: 'rivers-edge',                 path: 'Rivers_Edge-46-15',                 name: "River's Edge",                city: 'Gloucester',             bedrooms: 3, bathrooms: 1.5, maxGuests: 5,  petFriendly: true  },
  { slug: 'river-watch',                 path: 'River_Watch-47-15',                 name: 'River Watch',                 city: 'Gloucester',             bedrooms: 3, bathrooms: 2,   maxGuests: 6,  petFriendly: true  },
  { slug: 'ryal-side-hideaway-cove',     path: 'Ryal_Side_Hideaway_Cove-50-15',     name: 'Ryal Side Hideaway Cove',     city: 'Beverly',                bedrooms: 3, bathrooms: 1,   maxGuests: 6,  petFriendly: true  },
  { slug: 'sage-hill',                   path: 'Sage_Hill-51-15',                   name: 'Sage Hill',                   city: 'Rockport',               bedrooms: 3, bathrooms: 3,   maxGuests: 6,  petFriendly: true  },
  { slug: 'salt-island-views',           path: 'Salt_Island_Views-52-15',           name: 'Salt Island Views',           city: 'Gloucester',             bedrooms: 3, bathrooms: 2,   maxGuests: 8,  petFriendly: false },
  { slug: 'seacroft',                    path: 'Seacroft-53-15',                    name: 'Seacroft',                    city: 'Rockport',               bedrooms: 7, bathrooms: 3,   maxGuests: 16, petFriendly: false },
  { slug: 'seaside-house',               path: 'Seaside_House-55-15',               name: 'Seaside House',               city: 'Gloucester',             bedrooms: 4, bathrooms: 2.5, maxGuests: 10, petFriendly: false },
  { slug: 'the-spinnaker',               path: 'The_Spinnaker-57-15',               name: 'The Spinnaker',               city: 'Rockport',               bedrooms: 3, bathrooms: 2,   maxGuests: 6,  petFriendly: true  },
  { slug: 'squam-light',                 path: 'Squam_Light-58-15',                 name: 'Squam Light',                 city: 'Gloucester',             bedrooms: 3, bathrooms: 2,   maxGuests: 9,  petFriendly: true  },
  { slug: 'straitsmouth-cove',           path: 'Straitsmouth_Cove-59-15',           name: 'Straitsmouth Cove',           city: 'Rockport',               bedrooms: 5, bathrooms: 2,   maxGuests: 9,  petFriendly: true  },
  { slug: 'sunrise-on-the-cove',         path: 'Sunrise_on_the_Cove-60-15',         name: 'Sunrise on the Cove',         city: 'Rockport',               bedrooms: 4, bathrooms: 2.5, maxGuests: 12, petFriendly: true  },
  { slug: 'sunset-cove',                 path: 'Sunset_Cove-61-15',                 name: 'Sunset Cove',                 city: 'Gloucester',             bedrooms: 2, bathrooms: 2.5, maxGuests: 6,  petFriendly: false },
  { slug: 'terra-nova-cottage',          path: 'Terra_Nova_Cottage-62-15',          name: 'Terra Nova Cottage',          city: 'Gloucester',             bedrooms: 3, bathrooms: 2,   maxGuests: 6,  petFriendly: true  },
  { slug: 'the-rockporter',              path: 'The_Rockporter-64-15',              name: 'The Rockporter',              city: 'Rockport',               bedrooms: 3, bathrooms: 2,   maxGuests: 7,  petFriendly: true  },
  { slug: 'the-view',                    path: 'The_View-65-15',                    name: 'The View',                    city: 'Rockport',               bedrooms: 2, bathrooms: 2,   maxGuests: 6,  petFriendly: false },
  { slug: 'thurston-point-cottage',      path: 'Thurston_Point_Cottage-66-15',      name: 'Thurston Point Cottage',      city: 'Gloucester',             bedrooms: 3, bathrooms: 1.5, maxGuests: 7,  petFriendly: true  },
  { slug: 'wingaerchic',                 path: 'Wingaerchic-69-15',                 name: 'Wingaerchic',                 city: 'Gloucester',             bedrooms: 3, bathrooms: 2.5, maxGuests: 6,  petFriendly: true  },
  { slug: 'twin-lights',                 path: 'Twin_Lights-120-15',                name: 'Twin Lights',                 city: 'Rockport',               bedrooms: 2, bathrooms: 2,   maxGuests: 4,  petFriendly: false },
  { slug: 'harbortown-hideaway',         path: 'Harbortown_Hideaway-121-15',        name: 'Harbortown Hideaway',         city: 'Gloucester',             bedrooms: 3, bathrooms: 2,   maxGuests: 8,  petFriendly: false },
  { slug: 'dots-place',                  path: 'Dots_Place-274-15',                 name: "Dot's Place",                 city: 'Rockport',               bedrooms: 1, bathrooms: 1,   maxGuests: 2,  petFriendly: true  },
  { slug: 'lofty-views',                 path: 'Lofty_Views-270-15',                name: 'Lofty Views',                 city: 'Newbury',                bedrooms: 2, bathrooms: 1,   maxGuests: 5,  petFriendly: false },
  { slug: 'thorwald-by-the-sea',         path: 'Thorwald_by_the_Sea-68-15',         name: 'Thorwald by the Sea',         city: 'Gloucester',             bedrooms: 2, bathrooms: 1.5, maxGuests: 4,  petFriendly: false },
  { slug: 'sur-la-mer',                  path: 'Sur_la_Mer-288-15',                 name: 'Sur la Mer',                  city: 'Rockport',               bedrooms: 5, bathrooms: 2.5, maxGuests: 10, petFriendly: false },
  { slug: 'mill-pond-cottage',           path: 'Mill_Pond_Cottage-289-15',          name: 'Mill Pond Cottage',           city: 'Gloucester',             bedrooms: 3, bathrooms: 2,   maxGuests: 6,  petFriendly: true  },
  { slug: 'sea-for-miles',               path: 'Sea_For_Miles-280-15',              name: 'Sea For Miles',               city: 'Gloucester',             bedrooms: 3, bathrooms: 2,   maxGuests: 6,  petFriendly: true  },
  { slug: 'salt-marsh-cottage',          path: 'Salt_Marsh_Cottage-293-15',         name: 'Salt Marsh Cottage',          city: 'Gloucester',             bedrooms: 3, bathrooms: 2.5, maxGuests: 8,  petFriendly: true  },
  { slug: 'just-for-the-halibut',        path: 'Just_For_the_Halibut-298-15',       name: 'Just For the Halibut',        city: 'Rockport',               bedrooms: 3, bathrooms: 1.5, maxGuests: 6,  petFriendly: true  },
  { slug: 'first-light',                 path: 'First_Light-301-15',                name: 'First Light',                 city: 'Rockport',               bedrooms: 3, bathrooms: 1,   maxGuests: 7,  petFriendly: false },
  { slug: 'niles-beach-house',           path: 'Niles_Beach_House-296-15',          name: 'Niles Beach House',           city: 'Gloucester',             bedrooms: 4, bathrooms: 2,   maxGuests: 8,  petFriendly: true  },
  { slug: 'portside-glimpse',            path: 'Portside_Glimpse-303-15',           name: 'Portside Glimpse',            city: 'Rockport',               bedrooms: 1, bathrooms: 1,   maxGuests: 2,  petFriendly: true  },
  { slug: 'portside-walkabout',          path: 'Portside_Walkabout-304-15',         name: 'Portside Walkabout',          city: 'Rockport',               bedrooms: 1, bathrooms: 1,   maxGuests: 2,  petFriendly: true  },
  { slug: 'portside-overlook',           path: 'Portside_Overlook-305-15',          name: 'Portside Overlook',           city: 'Rockport',               bedrooms: 2, bathrooms: 2,   maxGuests: 5,  petFriendly: true  },
  { slug: 'portside-at-front-beach',     path: 'Portside_at_Front_Beach-302-15',    name: 'Portside at Front Beach',     city: 'Rockport',               bedrooms: 4, bathrooms: 4,   maxGuests: 10, petFriendly: false },
  { slug: 'cape-hedge-house',            path: 'Cape_Hedge_House-300-15',           name: 'Cape Hedge House',            city: 'Rockport',               bedrooms: 3, bathrooms: 3,   maxGuests: 6,  petFriendly: true  },
  { slug: 'the-gallery',                 path: 'The_Gallery-308-15',                name: 'The Gallery',                 city: 'Gloucester',             bedrooms: 3, bathrooms: 3,   maxGuests: 6,  petFriendly: true  },
  { slug: 'painters-perch',              path: 'Painters_Perch-307-15',             name: "Painter's Perch",             city: 'Gloucester',             bedrooms: 2, bathrooms: 1.5, maxGuests: 5,  petFriendly: true  },
  { slug: 'mill-brook-house',            path: 'Mill_Brook_House-310-15',           name: 'Mill Brook House',            city: 'Rockport',               bedrooms: 4, bathrooms: 2,   maxGuests: 8,  petFriendly: false },
  { slug: 'life-of-reilly',              path: 'Life_of_Reilly-313-15',             name: 'Life of Reilly',              city: 'Rockport',               bedrooms: 2, bathrooms: 1.5, maxGuests: 4,  petFriendly: true  },
  { slug: 'tidebend',                    path: 'Tidebend-311-15',                   name: 'Tidebend',                    city: 'Gloucester',             bedrooms: 6, bathrooms: 2.5, maxGuests: 10, petFriendly: false },
  { slug: 'slice-of-heaven',             path: 'Slice_of_Heaven-314-15',            name: 'Slice of Heaven',             city: 'Gloucester',             bedrooms: 2, bathrooms: 1.5, maxGuests: 4,  petFriendly: false },
  { slug: 'spyglass',                    path: 'Spy_Glass-316-15',                  name: 'Spyglass',                    city: 'Gloucester',             bedrooms: 2, bathrooms: 1,   maxGuests: 3,  petFriendly: true  },
  { slug: 'hastings-haven',              path: 'Hastings_Haven-317-15',             name: 'Hastings Haven',              city: 'Beverly',                bedrooms: 1, bathrooms: 1,   maxGuests: 2,  petFriendly: true  },
  { slug: 'ledgewood',                   path: 'Ledgewood-312-15',                  name: 'Ledgewood',                   city: 'Gloucester',             bedrooms: 2, bathrooms: 2,   maxGuests: 4,  petFriendly: true  },
  { slug: 'gulls-nest',                  path: 'Gulls_Nest-319-15',                 name: "Gull's Nest",                 city: 'Gloucester',             bedrooms: 4, bathrooms: 2,   maxGuests: 10, petFriendly: true  },
  { slug: 'beach-bound',                 path: 'Beach_Bound-318-15',                name: 'Beach Bound',                 city: 'Gloucester',             bedrooms: 3, bathrooms: 1.5, maxGuests: 6,  petFriendly: true  },
  { slug: 'holbrook-house',              path: 'Holbrook_House-324-15',             name: 'Holbrook House',              city: 'Rockport',               bedrooms: 3, bathrooms: 2,   maxGuests: 6,  petFriendly: true  },
  { slug: 'life-on-deck',                path: 'Life_on_Deck-325-15',               name: 'Life on Deck',                city: 'Gloucester',             bedrooms: 3, bathrooms: 1.5, maxGuests: 6,  petFriendly: false },
  { slug: 'robbins-nest',                path: 'Robbins_Nest-326-15',               name: "Robbin's Nest",               city: 'Essex',                  bedrooms: 2, bathrooms: 2,   maxGuests: 4,  petFriendly: false },
];

export const AVH_LISTINGS: CompetitorListing[] = raw.map(({ path, ...rest }) => ({
  ...rest,
  url: `${AVH_BASE}${path}`,
}));
