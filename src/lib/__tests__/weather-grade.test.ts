/**
 * The filming forecast: sky vocabulary, wind, and the go / maybe / no grade.
 *
 * Fixtures are real National Weather Service phrases off the Gloucester
 * forecast (grid BOX 83,115), including the compound ones that made the
 * first cut of this classifier wrong:
 *   - "Partly Cloudy" contains the word "cloudy", so an overcast-first test
 *     graded every bright broken-cloud day as flat grey, which is the good
 *     half of a New England week.
 *   - "Slight Chance Rain Showers then Mostly Sunny" has to read as RAIN. A
 *     day that can be lost is not a day to promise a contributor.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no network)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifySky, parseWindMph, gradeDay, weatherLine, type DayWeather, type Sky } from '../weather-types.ts';

describe('classifySky', () => {
  test('reads the clear end of the scale', () => {
    assert.equal(classifySky('Sunny'), 'clear');
    assert.equal(classifySky('Mostly Sunny'), 'clear');
    assert.equal(classifySky('Clear'), 'clear');
  });

  test('broken cloud is not overcast', () => {
    // "Partly Cloudy" contains "cloudy"; testing overcast first got this wrong.
    assert.equal(classifySky('Partly Cloudy'), 'partly');
    assert.equal(classifySky('Partly Sunny'), 'partly');
    assert.equal(classifySky('Mostly Cloudy'), 'cloudy');
    assert.equal(classifySky('Cloudy'), 'cloudy');
  });

  test('the worst condition in a compound phrase wins', () => {
    assert.equal(classifySky('Slight Chance Rain Showers then Mostly Sunny'), 'rain');
    assert.equal(classifySky('Mostly Sunny then Chance Showers'), 'rain');
    assert.equal(classifySky('Chance Rain And Snow'), 'snow');
    // Thunder outranks the rain named in the same breath: one is a wet day,
    // the other is a day nobody stands in a field holding a tripod.
    assert.equal(classifySky('Chance Rain Showers And Thunderstorms'), 'storm');
  });

  test('names the weather events', () => {
    assert.equal(classifySky('Chance Rain Showers'), 'rain');
    assert.equal(classifySky('Rain Showers Likely'), 'rain');
    assert.equal(classifySky('Light Snow'), 'snow');
    assert.equal(classifySky('Wintry Mix'), 'snow');
    assert.equal(classifySky('Light Drizzle'), 'rain');
    assert.equal(classifySky('Patchy Fog'), 'fog');
    assert.equal(classifySky('Areas Of Haze'), 'fog');
    assert.equal(classifySky('Scattered Thunderstorms'), 'storm');
  });

  test('an unknown phrase falls back to cloudy, never to sun', () => {
    // Fail toward the duller reading: inventing sunshine sends a crew out
    // for nothing, inventing cloud only costs a second look at the sky.
    assert.equal(classifySky('Areas Of Blowing Dust'), 'cloudy');
    assert.equal(classifySky(''), 'cloudy');
  });
});

describe('parseWindMph', () => {
  test('takes the top of the range, which is what the shoot must survive', () => {
    assert.equal(parseWindMph('12 to 16 mph'), 16);
    assert.equal(parseWindMph('6 mph'), 6);
  });

  test('gusts count, because the gust is what moves the drone', () => {
    assert.equal(parseWindMph('10 to 15 mph, with gusts as high as 30 mph'), 30);
  });

  test('no number means no reading', () => {
    assert.equal(parseWindMph('Calm'), null);
    assert.equal(parseWindMph(''), null);
    assert.equal(parseWindMph(null), null);
    assert.equal(parseWindMph(undefined), null);
  });
});

describe('gradeDay', () => {
  test('sun, dry and calm is a good day', () => {
    assert.equal(gradeDay('clear', 0, 8), 'good');
    assert.equal(gradeDay('partly', 10, 10), 'good');
  });

  test('flat light is workable, not good', () => {
    assert.equal(gradeDay('cloudy', 0, 5), 'fair');
    assert.equal(gradeDay('fog', 0, 5), 'fair');
  });

  test('wet or blowing turns a sunny forecast down', () => {
    assert.equal(gradeDay('clear', 30, 5), 'fair');
    assert.equal(gradeDay('clear', 0, 28), 'fair');
  });

  test('rain in any form is poor, however low the odds read', () => {
    assert.equal(gradeDay('rain', 20, 5), 'poor');
    assert.equal(gradeDay('storm', 0, 5), 'poor');
    assert.equal(gradeDay('snow', 0, 5), 'poor');
    assert.equal(gradeDay('clear', 60, 5), 'poor');
  });

  test('a missing number never invents a verdict; the sky still decides', () => {
    assert.equal(gradeDay('clear', null, null), 'good');
    assert.equal(gradeDay('rain', null, null), 'poor');
    assert.equal(gradeDay('cloudy', null, null), 'fair');
  });

  test('the thresholds, stated so a later edit has to mean it', () => {
    assert.equal(gradeDay('clear', 24, 0), 'good');
    assert.equal(gradeDay('clear', 25, 0), 'fair');
    assert.equal(gradeDay('clear', 49, 0), 'fair');
    assert.equal(gradeDay('clear', 50, 0), 'poor');
    assert.equal(gradeDay('clear', 0, 24), 'good');
    assert.equal(gradeDay('clear', 0, 25), 'fair');
  });

  test('every sky has a verdict, so a new one cannot fall through to good', () => {
    // gradeDay ends in `return 'good'`. A sky added to the union without a
    // rule above that line would quietly become a green day on the grid and
    // send a camera out in it. This is the tripwire for that.
    const skies: Sky[] = ['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow', 'storm'];
    const wet: Sky[] = ['rain', 'snow', 'storm'];
    for (const sky of skies) {
      const verdict = gradeDay(sky, 0, 0);
      assert.ok(['good', 'fair', 'poor'].includes(verdict), `${sky} graded ${verdict}`);
      // Dry-and-calm is the kindest input there is, so anything that still
      // grades 'poor' here is genuinely unshootable weather, and nothing wet
      // may grade anything else.
      if (wet.includes(sky)) assert.equal(verdict, 'poor', `${sky} must be poor even when dry and calm`);
    }
  });
});

describe('weatherLine', () => {
  const day = (over: Partial<DayWeather>): DayWeather => ({
    date: '2026-09-25',
    sky: 'clear',
    shortForecast: 'Sunny',
    highF: 68,
    precipPct: 0,
    windMph: 8,
    grade: 'good',
    ...over,
  });

  test('a quiet day says only the sky and the temperature', () => {
    assert.equal(weatherLine(day({})), 'Sunny · 68°');
  });

  test('rain and real wind earn their place; a breeze does not', () => {
    assert.equal(weatherLine(day({ precipPct: 40 })), 'Sunny · 68° · 40% rain');
    assert.equal(weatherLine(day({ windMph: 22 })), 'Sunny · 68° · wind to 22 mph');
    assert.equal(weatherLine(day({ windMph: 14 })), 'Sunny · 68°');
    // The exact edge, so moving it is a decision rather than a slip.
    assert.equal(weatherLine(day({ windMph: 15 })), 'Sunny · 68° · wind to 15 mph');
  });

  test('a bad day says all of it, in one line', () => {
    assert.equal(
      weatherLine(day({ shortForecast: 'Rain Showers Likely', sky: 'rain', grade: 'poor', precipPct: 60, windMph: 30 })),
      'Rain Showers Likely · 68° · 60% rain · wind to 30 mph',
    );
  });

  test('a missing temperature is simply absent, never a zero', () => {
    assert.equal(weatherLine(day({ highF: null })), 'Sunny');
  });
});
