/**
 * Shared Nominatim geocoder.
 *
 * Extracted from src/lib/projections-distance.ts so other write paths
 * (prospect → property promotion, future property edit auto-geocode)
 * can populate latitude / longitude without duplicating the Nominatim
 * fetch + retry logic.
 *
 * Public OSM service, ~1 req/sec policy; we identify Helm in the
 * User-Agent. ~5s timeout, returns null on any failure so a save still
 * succeeds without coords (the map just skips the pin until backfilled).
 */

export type Coords = { lat: number; lng: number };

const USER_AGENT = 'Helm-Properties/1.0 (https://helm.risingtidestr.com)';

export async function geocodeAddress(address: string): Promise<Coords | null> {
  if (!address || !address.trim()) return null;
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
