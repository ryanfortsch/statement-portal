/**
 * CARTO basemap tile URLs.
 *
 * CARTO started requiring an API key on its raster basemaps in September
 * 2026. Tiles requested without a key still render but carry an
 * "API KEY REQUIRED" watermark, which is what showed up across the
 * /properties portfolio map and the Field packet route map. Every Leaflet
 * map in Helm builds its tile URL through this helper so the key lives in
 * exactly one place.
 *
 * The key is necessarily public: it rides on every tile request the
 * browser makes, so it is not a secret and does not belong in the
 * server-only env set. NEXT_PUBLIC_CARTO_API_KEY overrides it per
 * environment; the literal below is the key CARTO issued to Rising Tide
 * (free tier, 5M tiles a month across every site that uses it), kept as a
 * fallback so a missing env var never re-watermarks production. It is the
 * same key stay-cape-ann carries in lib/mapTiles.ts. It is not restricted
 * by website (verified 2026-09-21: keyed tiles come back clean for the
 * helm.risingtidestr.com referer), so one registration covers both sites.
 * If it is ever restricted to staycapeann.com in the CARTO dashboard,
 * register a Helm key at carto.com/basemaps/apikey and set the env var.
 *
 * Attribution: CARTO's terms require the OpenStreetMap and CARTO credits
 * to stay on the map. PropertiesMap renders them; PacketRouteMap is a
 * 220px route thumbnail with attribution off, same as before the key.
 */
const FALLBACK_KEY = 'cb1_32bj_1_dbcede7ee62d40f7e67287f4';

export type CartoStyle = 'light_all' | 'rastertiles/voyager';

export function cartoTileUrl(style: CartoStyle): string {
  const key = process.env.NEXT_PUBLIC_CARTO_API_KEY || FALLBACK_KEY;
  return `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${key}`;
}

/** CARTO serves the a, b, c and d subdomains; Leaflet's default stops at c. */
export const CARTO_TILE_OPTIONS = { subdomains: 'abcd' } as const;
