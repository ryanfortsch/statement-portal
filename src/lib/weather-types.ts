/**
 * The filming forecast, in the parts that are pure arithmetic on a
 * forecast: what the sky is doing, how hard the wind blows, and whether
 * that adds up to a day worth sending a camera to.
 *
 * Split out of weather.ts so the planner grid can import it. weather.ts is
 * `server-only` (it calls NOAA); a client component importing from it
 * builds clean under tsc and then fails `next build`. Same split, and the
 * same reason, as calendar-holds.ts against maintenance-runs.ts -- and it
 * makes these rules unit-testable without a network.
 *
 * Nothing here decides anything on its own: see weather.ts for why the
 * forecast is advisory and never gates a send.
 */

export type Sky = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

/** How the day looks for a shoot. See gradeDay for the rules. */
export type ShootGrade = 'good' | 'fair' | 'poor';

export type DayWeather = {
  /** YYYY-MM-DD in the fleet's own clock (ET), matching the grid's days. */
  date: string;
  sky: Sky;
  /** The forecaster's own words ("Mostly Sunny", "Chance Rain Showers"). */
  shortForecast: string;
  /** Daytime high, Fahrenheit. */
  highF: number | null;
  /** Chance of precipitation, percent. Null when the feed omits it. */
  precipPct: number | null;
  /** Top of the forecast wind range, mph — the number that decides whether
   *  a drone flies and whether the water looks angry. */
  windMph: number | null;
  grade: ShootGrade;
};

/**
 * NWS writes a controlled little vocabulary ("Mostly Sunny", "Chance Rain
 * Showers", "Slight Chance Rain Showers then Mostly Sunny"). Two rules:
 *
 *   Worst condition wins. A day that starts with showers and clears is a
 *   day you can lose, so it reads as rain, not as sun.
 *
 *   Broken cloud is tested BEFORE overcast. "Partly Cloudy" contains the
 *   word "cloudy", so an overcast-first test quietly graded every bright
 *   broken-cloud day as flat grey -- the good half of a New England week.
 */
export function classifySky(shortForecast: string): Sky {
  const t = shortForecast.toLowerCase();
  if (/thunder|t-storm|tstm/.test(t)) return 'storm';
  if (/snow|sleet|flurr|winter mix|freezing|wintry/.test(t)) return 'snow';
  if (/rain|shower|drizzle/.test(t)) return 'rain';
  if (/fog|haze|mist|smoke/.test(t)) return 'fog';
  if (/partly sunny|partly cloudy|few clouds|scattered clouds/.test(t)) return 'partly';
  if (/mostly cloudy|cloudy|overcast/.test(t)) return 'cloudy';
  if (/sunny|clear|fair/.test(t)) return 'clear';
  return 'cloudy';
}

/** "12 to 16 mph" -> 16; "6 mph" -> 6. The top of the range, because that's
 *  the wind the shoot actually has to survive. */
export function parseWindMph(windSpeed: string | null | undefined): number | null {
  if (!windSpeed) return null;
  const nums = windSpeed.match(/\d+/g);
  if (!nums?.length) return null;
  return Math.max(...nums.map(Number));
}

/**
 * Is this a day to send someone with a camera?
 *
 *   poor  rain, snow or storms, or a coin-flip chance of precipitation.
 *         The shoot gets rained out or the footage is unusable.
 *   fair  shootable, but the sky is flat or the wind is up: a solid
 *         overcast, a real chance of showers, or 25+ mph (a drone stays
 *         in the bag and the water looks rough).
 *   good  sun or broken cloud, dry, calm enough. What the listings want.
 *
 * Deliberately three buckets, not a score: the operator needs go / maybe /
 * no, and a number invites false precision about a 7-day forecast.
 */
export function gradeDay(sky: Sky, precipPct: number | null, windMph: number | null): ShootGrade {
  if (sky === 'rain' || sky === 'snow' || sky === 'storm') return 'poor';
  if ((precipPct ?? 0) >= 50) return 'poor';
  if ((precipPct ?? 0) >= 25) return 'fair';
  if (sky === 'cloudy' || sky === 'fog') return 'fair';
  if ((windMph ?? 0) >= 25) return 'fair';
  return 'good';
}

/** The forecast in one line, for a tooltip or a send bar. */
export function weatherLine(w: DayWeather): string {
  const bits = [w.shortForecast];
  if (w.highF != null) bits.push(`${w.highF}°`);
  if (w.precipPct != null && w.precipPct > 0) bits.push(`${w.precipPct}% rain`);
  if (w.windMph != null && w.windMph >= 15) bits.push(`wind to ${w.windMph} mph`);
  return bits.join(' · ');
}
