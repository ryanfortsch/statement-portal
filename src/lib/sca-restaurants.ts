/**
 * The restaurants a Stay Cape Ann listing can name as its "we'd eat here"
 * pick, each with its map pin. The launcher offers them as a dropdown so
 * nobody types coordinates.
 *
 * Two sources, merged: the verified picks below (seeded 2026-10-31 from the
 * live registry, so the list works when GitHub cannot be read) and every
 * restaurant already on a live listing in data/ical-urls.json, so a pick
 * added through "Another restaurant" joins the list once its listing ships.
 * Pure, no I/O.
 */

export type ScaRestaurant = {
  name: string;
  town: string;
  lat: number;
  lng: number;
  /** A blurb another listing wrote, shown as an example. Listing-specific, never copied in. */
  sampleBlurb?: string;
};

export const VERIFIED_RESTAURANTS: readonly ScaRestaurant[] = [
  { name: "Woodman's of Essex", town: 'Essex', lat: 42.6323, lng: -70.7753, sampleBlurb: 'The inventors of the fried clam, still at it since 1916. Get the clam roll, eat it with your hands.' },
  { name: '1606 at Beauport Hotel', town: 'Gloucester', lat: 42.6094, lng: -70.6653, sampleBlurb: 'Oyster bar and modern New England at the harbor hotel. Sunset cocktails upstairs, dinner downstairs.' },
  { name: '51 Rocky Neck', town: 'Gloucester', lat: 42.606, lng: -70.6572, sampleBlurb: 'Harborfront dining on Rocky Neck with a menu that leans into what the boats brought in.' },
  { name: 'Lobsta Land', town: 'Gloucester', lat: 42.6265, lng: -70.6987, sampleBlurb: 'Classic Cape Ann lobster shack on the Annisquam. Twin lobsters, fried clams, and a screen porch.' },
  { name: 'Oak to Ember', town: 'Gloucester', lat: 42.6112069, lng: -70.6651314, sampleBlurb: 'Elegant restaurant serving seafood, meats and salads, plus burgers, steaks and seafood chowder.' },
  { name: 'Short and Main', town: 'Gloucester', lat: 42.6129, lng: -70.6608, sampleBlurb: 'Wood-fired pizza and a raw bar. The post-beach spot. Walk-ins only, worth the wait.' },
  { name: 'The Gloucester House', town: 'Gloucester', lat: 42.6112635, lng: -70.6632263, sampleBlurb: 'Classic Gloucester seafood on Rogers Street. Twin lobsters, harbor views, no fuss, always open.' },
  { name: 'The Lobster of Gloucester', town: 'Gloucester', lat: 42.6128, lng: -70.6487, sampleBlurb: 'Across the bridge in East Gloucester. No-frills lobster roll, picnic tables on the harbor.' },
  { name: 'The Salted Cod Arthouse', town: 'Gloucester', lat: 42.6059, lng: -70.657, sampleBlurb: 'Small plates and natural wine inside a working artist studio.' },
  { name: 'Tonno', town: 'Gloucester', lat: 42.6115, lng: -70.6662, sampleBlurb: 'Coastal Italian with fresh pasta, a raw bar, and an always-full dining room. Go early or sit at the bar.' },
  { name: 'Feather & Wedge', town: 'Rockport', lat: 42.6585, lng: -70.6178, sampleBlurb: 'Main Street Rockport. Seasonal New American in a warm room, cocktails at the bar.' },
  { name: 'Little Sister', town: 'Rockport', lat: 42.6592, lng: -70.6168, sampleBlurb: 'On Bearskin Neck. Burgers, hot dogs, and local seafood at a walk-up counter, Friday through Sunday.' },
];

/** Name and town compared loosely: "&" = "and", a leading "The" and punctuation ignored. */
export function restaurantKey(name: string, town: string): string {
  return [name, town]
    .map((v) =>
      v
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/^\s*the\s+/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join('|');
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The verified picks plus every pinned restaurant on a live listing, by town then name. */
export function restaurantChoices(registryJson: string | null): ScaRestaurant[] {
  const byKey = new Map<string, ScaRestaurant>();
  for (const r of VERIFIED_RESTAURANTS) byKey.set(restaurantKey(r.name, r.town), { ...r });
  let listings: Record<string, unknown> = {};
  try {
    if (registryJson) listings = (JSON.parse(registryJson) as { listings?: Record<string, unknown> }).listings ?? {};
  } catch {
    listings = {};
  }
  for (const entry of Object.values(listings)) {
    const e = (entry ?? {}) as { stayFavorite?: unknown; extraFavorites?: unknown };
    for (const f of [e.stayFavorite, ...(Array.isArray(e.extraFavorites) ? e.extraFavorites : [])]) {
      const v = (f ?? {}) as Record<string, unknown>;
      if (typeof v.name !== 'string' || typeof v.town !== 'string' || !v.name.trim() || !v.town.trim()) continue;
      if (!finite(v.lat) || !finite(v.lng)) continue;
      const key = restaurantKey(v.name, v.town);
      if (byKey.has(key)) continue;
      byKey.set(key, {
        name: v.name.trim(),
        town: v.town.trim(),
        lat: v.lat,
        lng: v.lng,
        sampleBlurb: typeof v.blurb === 'string' && v.blurb.trim() ? v.blurb.trim() : undefined,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.town.localeCompare(b.town) || a.name.localeCompare(b.name));
}

/** The listed restaurant matching a name and town, or null. */
export function findRestaurant(choices: readonly ScaRestaurant[], name: string, town: string): ScaRestaurant | null {
  const key = restaurantKey(name, town);
  return choices.find((r) => restaurantKey(r.name, r.town) === key) ?? null;
}
