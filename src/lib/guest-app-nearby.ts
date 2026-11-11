/**
 * "Around Cape Ann" for the guest app: the places near one home, with how
 * long it takes to get there.
 *
 * The data is Stay Cape Ann's, bundled at src/data/sca-guide.json by
 * scripts/sync-sca-guide.mjs, and the ranking follows staycapeann.com's
 * nearestAttractions (lib/attractions.ts there): the three anchors always
 * (Good Harbor Beach, Downtown Gloucester, Downtown Rockport), the home's
 * hand-picked restaurants always, then the nearest of the rest; a place is a
 * walk when the walk is 25 minutes or less, otherwise a drive. So the app
 * and the listing page name the same places in the same words with the same
 * minutes. A walk Dotti confirmed on foot (a footbridge, a beach path) wins
 * over the road-only route.
 *
 * Only names in that file reach a guest: Stay Cape Ann's verified-business
 * rule is why a home's restaurant picks are hand-curated there.
 *
 * Pure: the data comes in as an argument, so node:test pins the ranking.
 */

export type GuidePlaceCategory = 'beach' | 'landmark' | 'cultural' | 'outdoors' | 'dining';

export type GuidePlace = {
  name: string;
  category: GuidePlaceCategory | string;
  town: string;
  lat: number;
  lng: number;
  blurb: string;
  anchor?: boolean;
  /** The home's one hand-picked restaurant on staycapeann.com. */
  primary?: boolean;
};

/** [minutes, miles] */
type Leg = [number, number];

export type GuideListing = {
  internalName: string | null;
  publicName: string | null;
  favorites: GuidePlace[];
  legs: Record<string, { w?: Leg; d?: Leg; confirmed?: boolean }>;
};

export type GuideData = {
  attractions: GuidePlace[];
  listings: Record<string, GuideListing>;
};

export type NearbyPlace = {
  name: string;
  category: string;
  town: string;
  blurb: string;
  /** "4 min walk", "12 min drive". */
  travel: string;
  walk: boolean;
  minutes: number;
  /** One of the home's own restaurant picks. */
  ourPick: boolean;
  /** Google Maps directions from the home to the place. */
  directionsUrl: string;
};

const WALK_THRESHOLD_MIN = 25;
export const NEARBY_LIMIT = 10;

export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** staycapeann.com's crow-flies fallback, for a home with no routed table. */
function estimate(miles: number): { minutes: number; walk: boolean } {
  if (miles < 0.6) return { minutes: Math.max(1, Math.round((miles / 2.5) * 60)), walk: true };
  if (miles < 5) return { minutes: Math.max(2, Math.round((miles / 25) * 60)), walk: false };
  return { minutes: Math.max(5, Math.round((miles / 35) * 60)), walk: false };
}

export function directionsUrl(from: { lat: number; lng: number } | null, to: GuidePlace): string {
  const dest = `${to.lat},${to.lng}`;
  const origin = from ? `&origin=${from.lat},${from.lng}` : '';
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${encodeURIComponent(dest)}`;
}

/**
 * The listing key in the guide data: the Guesty listing id staycapeann.com
 * keys everything by, else the home's internal name (a Helm-run home keeps
 * its former Guesty id, and the internal name is the same on both sides).
 */
export function findGuideListing(
  data: GuideData,
  home: { guestyListingId?: string | null; formerGuestyListingId?: string | null; name: string },
): GuideListing | null {
  for (const id of [home.guestyListingId, home.formerGuestyListingId]) {
    if (id && data.listings[id]) return data.listings[id];
  }
  const name = home.name.trim().toLowerCase();
  const byName = Object.values(data.listings).filter((l) => (l.internalName ?? '').trim().toLowerCase() === name);
  return byName.length === 1 ? byName[0] : null;
}

export function nearbyPlaces(
  data: GuideData,
  listing: GuideListing | null,
  home: { lat: number | null; lng: number | null },
  limit = NEARBY_LIMIT,
): NearbyPlace[] {
  const origin = typeof home.lat === 'number' && typeof home.lng === 'number' ? { lat: home.lat, lng: home.lng } : null;
  // With neither a routed table nor coordinates there is no honest minute
  // to print, so the section shows nothing rather than guess.
  if (!listing && !origin) return [];

  type Ranked = NearbyPlace & { selectMiles: number; anchor: boolean };

  const rank = (p: GuidePlace, ourPick: boolean): Ranked | null => {
    const legs = listing?.legs[p.name];
    let minutes: number;
    let walk: boolean;
    let selectMiles: number;
    if (legs && (legs.w || legs.d)) {
      const canWalk = legs.w && legs.w[0] <= WALK_THRESHOLD_MIN;
      walk = Boolean(canWalk);
      minutes = canWalk ? legs.w![0] : (legs.d ?? legs.w)![0];
      selectMiles = (legs.d ?? legs.w)![1];
    } else if (origin) {
      selectMiles = distanceMiles(origin, p);
      ({ minutes, walk } = estimate(selectMiles));
    } else {
      return null;
    }
    return {
      name: p.name,
      category: p.category,
      town: p.town,
      blurb: p.blurb,
      travel: `${minutes} min ${walk ? 'walk' : 'drive'}`,
      walk,
      minutes,
      ourPick,
      directionsUrl: directionsUrl(origin, p),
      selectMiles,
      anchor: Boolean(p.anchor),
    };
  };

  const favorites = (listing?.favorites ?? []).map((f) => rank(f, true)).filter((r): r is Ranked => r !== null);
  const all = data.attractions.map((a) => rank(a, false)).filter((r): r is Ranked => r !== null);
  all.sort((a, b) => a.selectMiles - b.selectMiles);
  const anchors = all.filter((a) => a.anchor);
  const rest = all.filter((a) => !a.anchor);
  const fill = Math.max(0, limit - anchors.length - favorites.length);

  const picked = new Map<string, Ranked>();
  for (const p of [...favorites, ...anchors, ...rest.slice(0, fill)]) {
    if (!picked.has(p.name)) picked.set(p.name, p);
  }
  // Walks first, then drives, each in the order of the minutes they print.
  return [...picked.values()]
    .sort((a, b) => Number(b.walk) - Number(a.walk) || a.minutes - b.minutes || a.name.localeCompare(b.name))
    .map((p): NearbyPlace => ({
      name: p.name,
      category: p.category,
      town: p.town,
      blurb: p.blurb,
      travel: p.travel,
      walk: p.walk,
      minutes: p.minutes,
      ourPick: p.ourPick,
      directionsUrl: p.directionsUrl,
    }));
}
