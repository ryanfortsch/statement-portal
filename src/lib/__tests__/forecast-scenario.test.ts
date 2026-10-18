import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SCENARIO,
  describeMeasured,
  parseScenario,
  scenarioQuery,
} from '../forecast-scenario.ts';

// The slider's own range: seven start months in 2026, twelve after.
const maxNew = (y: number) => (y === 2026 ? 7 : 12);

test('a bare /forecast is the default scenario, so old links keep their numbers', () => {
  assert.deepEqual(parseScenario({}, maxNew), DEFAULT_SCENARIO);
  assert.deepEqual(DEFAULT_SCENARIO, { year: 2026, numNew: [3, 3, 3] });
  assert.equal(scenarioQuery(DEFAULT_SCENARIO), '');
});

test('year and sliders round-trip through the link', () => {
  const s = parseScenario({ year: '2027', new: '3,2,0' }, maxNew);
  assert.deepEqual(s, { year: 2027, numNew: [3, 2, 0] });
  assert.equal(scenarioQuery(s), '?year=2027&new=3,2,0');
  assert.equal(scenarioQuery({ year: 2028, numNew: [3, 3, 3] }), '?year=2028');
  assert.equal(scenarioQuery({ year: 2026, numNew: [0, 3, 3] }), '?new=0,3,3');
});

test('an unreadable or out-of-range value falls back or clamps to the slider range', () => {
  assert.deepEqual(parseScenario({ year: '2031', new: '99,x,-1' }, maxNew), { year: 2026, numNew: [7, 3, 3] });
  assert.deepEqual(parseScenario({ year: ['2028', '2027'], new: '1' }, maxNew), { year: 2028, numNew: [1, 3, 3] });
  assert.deepEqual(parseScenario({ new: '1.5,,12' }, maxNew), { year: 2026, numNew: [3, 3, 12] });
});

const flags = (actual: number, cardOnlyFrom?: number) =>
  Array.from({ length: 12 }, (_, i) => ({
    is_actual: i < actual,
    actual_card_only: cardOnlyFrom != null && i >= cardOnlyFrom && i < actual,
  }));

test('the as-of line names the measured and projected months, card-only months in brackets', () => {
  assert.deepEqual(describeMeasured(flags(9, 8)), {
    line: 'Jan to Sep measured (Sep card only), Oct to Dec projected',
    ruleBefore: [9],
  });
  assert.deepEqual(describeMeasured(flags(0)), { line: 'Jan to Dec projected', ruleBefore: [] });
  assert.deepEqual(describeMeasured(flags(12)), { line: 'Jan to Dec measured', ruleBefore: [] });
  assert.equal(describeMeasured(flags(9, 7)).line, 'Jan to Sep measured (Aug to Sep card only), Oct to Dec projected');
  assert.equal(describeMeasured(flags(1)).line, 'Jan measured, Feb to Dec projected');
});

test('a measured month after a projected one opens its own run and its own rule', () => {
  const m = flags(9);
  m[10] = { is_actual: true, actual_card_only: false };
  assert.deepEqual(describeMeasured(m), {
    line: 'Jan to Sep measured, Oct projected, Nov measured, Dec projected',
    ruleBefore: [9, 10, 11],
  });
});

test('the Forecast page reads and writes the scenario through the link', () => {
  const page = readFileSync(new URL('../../app/forecast/page.tsx', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../../app/forecast/ForecastClient.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('parseScenario('), 'the server reads ?year= and ?new= for the first paint');
  assert.ok(client.includes('window.history.replaceState(null, \'\''), 'the client writes the URL without a server round trip');
  assert.ok(!client.includes('router.replace') && !client.includes('router.push'), 'never the router: it would re-run the whole page');
  assert.ok(!/beyond 9 current/.test(client), 'the 2026 caption reads the live count');
});
