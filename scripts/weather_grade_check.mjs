/**
 * The filming forecast: sky vocabulary, wind, and the go/maybe/no grade.
 *
 * Pure, no network. It imports the real rules from src/lib/weather-types.ts
 * rather than mirroring them, so this check cannot drift from the code it
 * is guarding. (weather.ts, which calls NOAA, is `server-only` and cannot
 * be imported here; the pure half was split out precisely so it could be.)
 *
 * Fixtures are real National Weather Service phrases off the Gloucester
 * forecast (grid BOX 83,115), including the two compound cases that make
 * this classifier easy to get wrong:
 *
 *   - "Partly Cloudy" contains the word "cloudy". An overcast-first test
 *     grades every bright broken-cloud day as flat grey, which is the good
 *     half of a New England week thrown away. Broken cloud must be tested
 *     BEFORE overcast, and this check fails if that order is reversed.
 *   - "Slight Chance Rain Showers then Mostly Sunny" must read as RAIN. A
 *     day that can be lost is not a day to promise a contributor.
 *
 * Run:
 *   node --experimental-strip-types scripts/weather_grade_check.mjs
 */

import { classifySky, parseWindMph, gradeDay, weatherLine } from '../src/lib/weather-types.ts';

let failures = 0;
const eq = (label, got, want) => {
  if (got === want) return;
  failures++;
  console.log(`FAIL  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

/* ── sky, in the forecaster's own words ───────────────────────────── */
eq('Sunny', classifySky('Sunny'), 'clear');
eq('Mostly Sunny', classifySky('Mostly Sunny'), 'clear');
eq('Clear', classifySky('Clear'), 'clear');
eq('Partly Sunny', classifySky('Partly Sunny'), 'partly');
eq('Partly Cloudy is broken cloud, not overcast', classifySky('Partly Cloudy'), 'partly');
eq('Mostly Cloudy', classifySky('Mostly Cloudy'), 'cloudy');
eq('Cloudy', classifySky('Cloudy'), 'cloudy');
eq('Chance Rain Showers', classifySky('Chance Rain Showers'), 'rain');
eq('Rain Showers Likely', classifySky('Rain Showers Likely'), 'rain');
eq('Light Drizzle', classifySky('Light Drizzle'), 'rain');
eq('worst wins: showers then sun', classifySky('Slight Chance Rain Showers then Mostly Sunny'), 'rain');
eq('worst wins: sun then showers', classifySky('Mostly Sunny then Chance Showers'), 'rain');
eq('Patchy Fog', classifySky('Patchy Fog'), 'fog');
eq('Areas Of Haze', classifySky('Areas Of Haze'), 'fog');
eq('Scattered Thunderstorms', classifySky('Scattered Thunderstorms'), 'storm');
eq('worst wins: storms outrank the rain in the same phrase', classifySky('Chance Rain Showers And Thunderstorms'), 'storm');
eq('rain and snow reads as snow', classifySky('Chance Rain And Snow'), 'snow');
eq('Light Snow', classifySky('Light Snow'), 'snow');
eq('Wintry Mix', classifySky('Wintry Mix'), 'snow');
/* An unknown phrase must fall back to something that never reads as a
   promise of sun. Cloudy grades 'fair', which is the honest hedge. */
eq('unknown phrase falls back to cloudy', classifySky('Areas Of Blowing Dust'), 'cloudy');
eq('empty phrase falls back to cloudy', classifySky(''), 'cloudy');

/* ── wind: the top of the range is what the shoot has to survive ──── */
eq('range takes the top', parseWindMph('12 to 16 mph'), 16);
eq('single value', parseWindMph('6 mph'), 6);
eq('gusts counted', parseWindMph('10 to 15 mph, with gusts as high as 30 mph'), 30);
eq('null', parseWindMph(null), null);
eq('undefined', parseWindMph(undefined), null);
eq('empty', parseWindMph(''), null);
eq('Calm has no number', parseWindMph('Calm'), null);

/* ── the grade ────────────────────────────────────────────────────── */
eq('sun, dry, calm', gradeDay('clear', 0, 8), 'good');
eq('broken cloud, dry', gradeDay('partly', 10, 10), 'good');
eq('flat overcast is only fair', gradeDay('cloudy', 0, 5), 'fair');
eq('fog is only fair', gradeDay('fog', 0, 5), 'fair');
eq('sun but a real chance of showers', gradeDay('clear', 30, 5), 'fair');
eq('sun but 28 mph', gradeDay('clear', 0, 28), 'fair');
eq('coin-flip precipitation is poor', gradeDay('clear', 50, 5), 'poor');
eq('rain is poor however low the odds read', gradeDay('rain', 20, 5), 'poor');
eq('storm', gradeDay('storm', 0, 5), 'poor');
eq('snow', gradeDay('snow', 0, 5), 'poor');
/* A feed that omits precipitation or wind must not invent a bad day, and
   must not launder a bad sky into a good one either. */
eq('missing numbers, clear sky', gradeDay('clear', null, null), 'good');
eq('missing numbers, rain', gradeDay('rain', null, null), 'poor');
eq('missing numbers, overcast', gradeDay('cloudy', null, null), 'fair');
/* Boundaries, stated out loud so a later edit has to mean it. */
eq('24% stays good', gradeDay('clear', 24, 0), 'good');
eq('25% turns fair', gradeDay('clear', 25, 0), 'fair');
eq('49% is still fair', gradeDay('clear', 49, 0), 'fair');
eq('50% turns poor', gradeDay('clear', 50, 0), 'poor');
eq('24 mph is calm enough', gradeDay('clear', 0, 24), 'good');
eq('25 mph turns fair', gradeDay('clear', 0, 25), 'fair');

/* Every sky the classifier can return must grade to something. A new sky
   state added without a rule in gradeDay would otherwise fall through
   silently to 'good' and put a camera out in it. */
const ALL_SKIES = ['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow', 'storm'];
const GRADES = ['good', 'fair', 'poor'];
for (const sky of ALL_SKIES) {
  const g = gradeDay(sky, 0, 0);
  if (!GRADES.includes(g)) {
    failures++;
    console.log(`FAIL  gradeDay('${sky}') returned ${JSON.stringify(g)}, which is not a grade`);
  }
}
/* And every sky the vocabulary produces must be one this list knows, or
   the loop above is testing less than it looks. */
const PHRASES = ['Sunny', 'Partly Cloudy', 'Mostly Cloudy', 'Patchy Fog', 'Chance Rain Showers', 'Light Snow', 'Scattered Thunderstorms', 'Areas Of Blowing Dust'];
for (const p of PHRASES) {
  const sky = classifySky(p);
  if (!ALL_SKIES.includes(sky)) {
    failures++;
    console.log(`FAIL  classifySky(${JSON.stringify(p)}) returned ${JSON.stringify(sky)}, which is not a known sky`);
  }
}

/* ── the one-line summary ─────────────────────────────────────────── */
const base = { date: '2026-09-25', sky: 'clear', shortForecast: 'Sunny', highF: 68, precipPct: 0, windMph: 8, grade: 'good' };
const line = (over) => weatherLine({ ...base, ...over });
eq('a quiet day says sky and temp only', line({}), 'Sunny · 68°');
eq('rain chance shows once there is one', line({ precipPct: 40 }), 'Sunny · 68° · 40% rain');
eq('a breeze under 15 stays quiet', line({ windMph: 14 }), 'Sunny · 68°');
eq('wind shows from 15 up', line({ windMph: 15 }), 'Sunny · 68° · wind to 15 mph');
eq('missing temp is simply absent', line({ highF: null }), 'Sunny');
eq('everything at once', line({ precipPct: 60, windMph: 30 }), 'Sunny · 68° · 60% rain · wind to 30 mph');

console.log(failures === 0 ? 'PASS  weather grade check' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
