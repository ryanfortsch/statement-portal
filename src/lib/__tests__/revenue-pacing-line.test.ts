import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pacingFactsLine, pacingMonthLabel, pacingToggleState } from '../revenue-pacing-line.ts';
import type { PacingInfo } from '../revenue-snapshot.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

const base: PacingInfo = {
  pacingPct: 48.2,
  historicalAvgPct: 61.4,
  targetPct: 55.1,
  captureRatio: 0.9,
  projectedFinalPct: 50,
  pickupShare: 0.72,
  benchmarkPct: 55.1,
  targetSource: 'benchmark',
  multiplier: 1.14,
  month: '2026-10',
  openNightMarketRate: 412.4,
  fleetRateIndex: 1.12,
};

test('the month reads as words', () => {
  assert.equal(pacingMonthLabel('2026-10'), 'October 2026');
  assert.equal(pacingMonthLabel('junk'), 'junk');
});

test('a month behind target: the facts, then booked so far or projected', () => {
  assert.equal(
    pacingFactsLine(base, { view: 'actuals', basis: 'checkout' }),
    'October 2026: pacing 48% · Gloucester 61% · target 55% · booked so far',
  );
  assert.equal(
    pacingFactsLine(base, { view: 'pacing', basis: 'checkout' }),
    'October 2026: pacing 48% · Gloucester 61% · target 55% · projected, open nights at about $412 × 1.12',
  );
});

test('a target set by the booking curve says on pace for, with the pickup share', () => {
  assert.equal(
    pacingFactsLine({ ...base, targetSource: 'pickup', targetPct: 66.6 }, { view: 'actuals', basis: 'checkout' }),
    'October 2026: pacing 48% · Gloucester 61% · on pace for 67% (72% of nights usually booked by now) · booked so far',
  );
});

test('at or past target prints the benchmark and no projection', () => {
  assert.equal(
    pacingFactsLine({ ...base, multiplier: 1, pacingPct: 70, benchmarkPct: 55.1 }, { view: 'actuals', basis: 'checkout' }),
    'October 2026: pacing 70% · Gloucester 61% · target 55% · at target, booked so far',
  );
  assert.equal(
    pacingFactsLine({ ...base, multiplier: 1, pacingPct: 0 }, { view: 'actuals', basis: 'nights' }),
    'October 2026: nothing booked yet · Gloucester 61% · no projection · by nights stayed, will not tie to a statement',
  );
});

test('no month to pace: nothing, unless counting by nights', () => {
  assert.equal(pacingFactsLine(null, { view: 'actuals', basis: 'checkout' }), null);
  assert.equal(pacingFactsLine(null, { view: 'actuals', basis: 'nights' }), 'Counted by nights stayed, so these will not tie to a statement');
});

test('the Pacing toggle is always there; disabled says why', () => {
  assert.deepEqual(pacingToggleState(base, 'actuals'), { enabled: true, note: null });
  assert.deepEqual(pacingToggleState({ ...base, multiplier: 1 }, 'actuals'), { enabled: false, note: 'at target' });
  assert.deepEqual(pacingToggleState({ ...base, multiplier: 1, pacingPct: 0 }, 'actuals'), { enabled: false, note: 'nothing booked yet' });
  assert.deepEqual(pacingToggleState(null, 'actuals'), { enabled: false, note: 'nothing to project' });
  assert.deepEqual(pacingToggleState(null, 'pacing'), { enabled: true, note: null }, 'a link asking for Pacing can switch back');
});

test('the Revenue page uses the line and never hides the toggle', () => {
  const page = read('src/app/revenue/page.tsx');
  assert.ok(page.includes('pacingFactsLine(pacing'), 'the facts line replaces the paragraphs');
  assert.ok(page.includes('<ViewToggle value={view} disabledNote='), 'the toggle renders unconditionally');
  assert.ok(!page.includes('pacing.multiplier > 1) || view === \'pacing\') && ('), 'no self-hiding gate');
  assert.ok(!page.includes('label="Rising Tide"') && !page.includes('label="Portfolio Rev"'), 'the headline names the thing');
  assert.ok(page.includes('label="Mgmt fee"'));
  assert.ok(page.includes('sub="after channel and card fees"'));
});
