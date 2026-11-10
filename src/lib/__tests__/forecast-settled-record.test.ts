/**
 * A settled home's year is its record (2026-11-09). From four closed full
 * months the forward pace no longer raises the annual gross: two winter months
 * of bookings had 53 Rocky Neck at $38,335 of fee a year against $31,997 on
 * its six closed statements.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { annualGrossFor, isSettled, statementFloor } from '../forecast-statement-floor.ts';
import { annualBasisFor } from '../forecast-shared-inventory.ts';

// The Gloucester revenue curve to two decimals (forecast-occupancy.ts).
const CURVE = [3.95, 4.56, 5.16, 5.87, 7.17, 10.64, 15.46, 15.73, 9.5, 11.83, 5.45, 4.68].map((v) => v / 100);

// 53 Rocky Neck's closed 2026 statements as fee base (management_fee / 25%).
const ROCKY_NECK_53 = new Map(
  Object.entries({
    '2026-05': 2118.41,
    '2026-06': 3528.22,
    '2026-07': 4997.11,
    '2026-08': 5481.16,
    '2026-09': 2417.7,
    '2026-10': 3784.94,
  }).map(([ym, fee]) => [ym, fee / 0.25]),
);

describe('a settled home is projected on its record', () => {
  const floor = statementFloor({ grossByMonth: ROCKY_NECK_53, revenueShare: CURVE });

  test('53 Rocky Neck: six closed months is settled, and its record is about $32K of fee', () => {
    assert.equal(isSettled(floor), true);
    const fee = floor.annual * 0.25;
    assert.ok(Math.abs(fee - 31997) < 50, `${fee}`);
  });
  test('its forward pace ($38,335 of fee) no longer raises the year', () => {
    const pace = 38335 / 0.25;
    assert.equal(annualGrossFor(pace, floor), floor.annual);
    assert.equal(
      annualBasisFor({ floorAnnual: floor.annual, paceAnnual: pace, ownAnnual: pace, sharesInventory: false, settled: true }),
      'statements',
    );
  });
  test('nor does the portfolio average for a settled home with nothing booked', () => {
    const portfolio = 31533 / 0.25;
    assert.equal(annualGrossFor(portfolio, floor), floor.annual);
    assert.equal(
      annualBasisFor({ floorAnnual: floor.annual, paceAnnual: portfolio, ownAnnual: 0, sharesInventory: false, settled: true }),
      'statements',
    );
  });
  test('a pace below the record still loses to the record', () => {
    assert.equal(annualGrossFor(floor.annual / 2, floor), floor.annual);
  });
});

describe('a home still ramping keeps the larger of pace and floor', () => {
  const three = new Map([...ROCKY_NECK_53].filter(([ym]) => ym >= '2026-08'));
  const floor = statementFloor({ grossByMonth: three, revenueShare: CURVE });

  test('three closed months is not settled', () => {
    assert.equal(isSettled(floor), false);
    assert.ok(floor.annual > 0);
  });
  test('a bigger pace wins, a smaller one is floored', () => {
    assert.equal(annualGrossFor(floor.annual * 2, floor), floor.annual * 2);
    assert.equal(annualGrossFor(floor.annual / 2, floor), floor.annual);
  });
  test('no statements at all: the pace alone', () => {
    const none = statementFloor({ grossByMonth: new Map(), revenueShare: CURVE });
    assert.equal(isSettled(none), false);
    assert.equal(annualGrossFor(120000, none), 120000);
  });
});

describe('the smart forecast uses the rule', () => {
  const src = readFileSync(new URL('../forecast-smart.ts', import.meta.url), 'utf8');
  test('annual gross comes from annualGrossFor, not a bare max', () => {
    assert.match(src, /const annualGross = annualGrossFor\(paceAnnual, floor\);/);
    assert.doesNotMatch(src, /const annualGross = Math\.max\(paceAnnual, floor\.annual\)/);
    assert.match(src, /settled: isSettled\(floor\)/);
  });
});
