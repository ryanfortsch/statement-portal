/**
 * The filming forecast for the fleet.
 *
 * Weather decides whether a shoot is worth sending: blue sky sells a
 * vacation rental, a flat grey sky does not, and rain cancels the day. The
 * creative planner grid, its send bar and the shoot page's Shoot-day card
 * all read this module, so they cannot disagree about a day.
 *
 * ONE forecast covers the whole fleet. Every managed home is on Cape Ann,
 * inside about six miles end to end, and a National Weather Service grid
 * cell is 2.5km: per-home forecasts here would be the same sentence printed
 * fifteen times, at fifteen times the requests. If Rising Tide ever manages
 * a home off Cape Ann, this is the assumption to revisit.
 *
 * SOURCE: api.weather.gov (NOAA). Chosen over the commercial APIs because
 * it is a work of the US government: public domain, no key, no quota, and
 * no licence question about a business using it. It covers the US only,
 * which is exactly this fleet. It forecasts SEVEN days, so a planner grid
 * showing more than a week has bare columns at the end; that is the honest
 * answer, not a gap to fill with a guess.
 *
 * ADVISORY ONLY. Weather never gates a send and never greys out a day:
 * Dotti decides whether to shoot in the rain. Every failure path here
 * returns no forecast rather than a wrong one, and every surface renders
 * unchanged when the forecast is missing (see [[fail-open posture]]: the
 * absence of weather must never read as good weather).
 */

import 'server-only';

import { classifySky, gradeDay, parseWindMph, type DayWeather } from './weather-types';

export * from './weather-types';

/** Cape Ann, off Gloucester's inner harbour. See the fleet note above. */
const FLEET_POINT = { lat: 42.6209, lng: -70.645 };

const UA = 'RisingTideHelm/1.0 (helm.risingtidestr.com, dotti@risingtidestr.com)';
/** The office reads the board all day; NWS updates roughly hourly. */
const FORECAST_TTL_MS = 30 * 60 * 1000;
/** Never let a slow forecast hold up the board. */
const TIMEOUT_MS = 4000;

/** The shape weather.gov returns, as much of it as this reads. */
type NwsPeriod = {
  startTime?: string;
  isDaytime?: boolean;
  temperature?: number;
  temperatureUnit?: string;
  probabilityOfPrecipitation?: { value?: number | null } | null;
  windSpeed?: string | null;
  shortForecast?: string;
};

// ── fetching ─────────────────────────────────────────────────────────

/**
 * In-module cache, deliberately.
 *
 * `/fieldwork/shoots` is force-dynamic, and Next rewrites EVERY fetch on a
 * force-dynamic route to `{ cache: 'no-store', revalidate: 0 }` -- so the
 * obvious `next: { revalidate }` would quietly call NOAA on every single
 * page load. `unstable_cache` is the other escape hatch, but Next 16
 * replaced it with `use cache`, which needs Cache Components turned on for
 * the whole app. So the cache lives here, where nothing can override it: a
 * warm instance serves the same forecast for half an hour, a cold one pays
 * a single ~200ms call, and `inFlight` keeps concurrent renders on one
 * request.
 */
let cached: { at: number; days: DayWeather[] } | null = null;
let inFlight: Promise<DayWeather[]> | null = null;
/** The NWS grid square for FLEET_POINT. Fixed for a fixed point, so it is
 *  looked up once per instance and kept for the life of it. */
let gridUrl: string | null = null;

async function nws(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Belt and braces: this route forces no-store anyway, and the cache
    // that matters is the module-level one above.
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`weather.gov ${res.status}`);
  return res.json();
}

async function fetchForecast(): Promise<DayWeather[]> {
  if (!gridUrl) {
    const point = (await nws(`https://api.weather.gov/points/${FLEET_POINT.lat},${FLEET_POINT.lng}`)) as {
      properties?: { forecast?: string };
    };
    const url = point?.properties?.forecast;
    if (!url) throw new Error('weather.gov: no forecast url for the fleet point');
    gridUrl = url;
  }
  const data = (await nws(gridUrl)) as { properties?: { periods?: NwsPeriod[] } };
  const periods = data?.properties?.periods ?? [];

  const out: DayWeather[] = [];
  const seen = new Set<string>();
  for (const p of periods) {
    // Daytime periods only: nobody films Cape Ann at midnight. The first
    // period of a run can be a part-day ("This Afternoon") -- still today,
    // still the only daylight left, so it counts.
    if (!p.isDaytime || !p.startTime) continue;
    // startTime carries the forecast office's own offset (Boston = ET), the
    // same clock the grid's days are in, so the date slices off directly.
    const date = p.startTime.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(date)) continue;
    seen.add(date);

    const shortForecast = (p.shortForecast ?? '').trim() || 'No forecast';
    const sky = classifySky(shortForecast);
    const precipRaw = p.probabilityOfPrecipitation?.value;
    const precipPct = typeof precipRaw === 'number' ? Math.round(precipRaw) : null;
    const windMph = parseWindMph(p.windSpeed);
    // Only Fahrenheit is read as a temperature; a feed that switches units
    // shows no number rather than a Celsius one labelled degrees.
    const highF = typeof p.temperature === 'number' && (p.temperatureUnit ?? 'F') === 'F' ? p.temperature : null;

    out.push({ date, sky, shortForecast, highF, precipPct, windMph, grade: gradeDay(sky, precipPct, windMph) });
  }
  return out;
}

/**
 * The fleet's forecast by date. Returns an empty map when NOAA is
 * unreachable, slow, or reshapes its payload -- callers render without
 * weather, never with a guess.
 */
export async function loadFleetForecast(): Promise<Map<string, DayWeather>> {
  const fresh = cached && Date.now() - cached.at < FORECAST_TTL_MS ? cached.days : null;
  let days = fresh;
  if (!days) {
    try {
      inFlight ??= fetchForecast().finally(() => {
        inFlight = null;
      });
      days = await inFlight;
      cached = { at: Date.now(), days };
    } catch {
      // Serve a stale forecast over none at all: yesterday's high is worth
      // more to the operator than an empty row, and the row says how old it
      // is nowhere near as loudly as a wrong sky would mislead.
      days = cached?.days ?? [];
      // A failed lookup may mean the grid url moved; re-resolve next time.
      gridUrl = null;
    }
  }
  return new Map(days.map((d) => [d.date, d]));
}
