/**
 * Drive-time computation from Rising Tide HQ to a prospect's property.
 * Used to populate projections.drive_time_minutes when a new prospect is
 * created or saved without a manual override.
 *
 * Stack (zero API keys, zero Dotti setup):
 *   1. OpenStreetMap Nominatim for geocoding the prospect's address.
 *      Public service, ~1 req/sec policy. Sets a User-Agent so they can
 *      identify us if we ever cause load.
 *   2. project-osrm.org public OSRM server for driving directions.
 *      Returns total duration in seconds; we round to whole minutes.
 *
 * Rising Tide HQ coordinates are hardcoded from a one-time Nominatim
 * lookup of "85 Eastern Ave, Gloucester, MA".
 *
 * Both calls have ~5s timeouts and any failure returns null so the
 * projection save still succeeds — the slide just falls back to the
 * generic 10-minute positioning when drive_time_minutes is null.
 */

const HQ_LAT = 42.6209;
const HQ_LNG = -70.6450;
const USER_AGENT = 'Helm-Projections/1.0 (https://statements.risingtidestr.com)';

type Coords = { lat: number; lng: number };

async function geocode(address: string): Promise<Coords | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', address);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us');
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as Array<{ lat: string; lon: string }>;
    if (!data?.length) return null;
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

async function osrmDriveMinutes(dest: Coords): Promise<number | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${HQ_LNG},${HQ_LAT};${dest.lng},${dest.lat}?overview=false`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!r.ok) return null;
    const data = (await r.json()) as { routes?: Array<{ duration: number }> };
    if (!data.routes?.length) return null;
    return Math.round(data.routes[0].duration / 60);
  } catch {
    return null;
  }
}

/**
 * Geocode the address, then compute the OSRM driving duration from HQ.
 * Returns null if either step fails (network, ambiguous address, no route, etc.)
 */
export async function getDriveTimeMinutes(addressFull: string): Promise<number | null> {
  if (!addressFull?.trim()) return null;
  const coords = await geocode(addressFull);
  if (!coords) return null;
  return osrmDriveMinutes(coords);
}
