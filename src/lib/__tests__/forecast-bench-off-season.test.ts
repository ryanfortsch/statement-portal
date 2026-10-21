/**
 * The bench runs at half for January to April 2027.
 *
 * Dotti, 2026-10-21: "reduce the contractor expense by 50% from Jan-Apr of
 * 2027". The ruling covers the whole Contractors line in those four months
 * (creative, photography, the misc blend) and nothing else: May 2027 onward
 * is full, 2026 is untouched, and 2028 is untouched because the ask named
 * 2027.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  benchSeasonFactor,
  calcYear,
  contractorCost,
  photoCost,
  CONTRACTOR_CREATIVE_MONTHLY,
  CONTRACTOR_FIELD_PROP_COUNT,
  CONTRACTOR_MISC_MONTHLY,
  CONTRACTOR_OFF_SEASON_FACTOR,
  CONTRACTOR_PHOTO_MONTHLY,
  SEASON,
} from '../forecast-model.ts';

const fleet = CONTRACTOR_FIELD_PROP_COUNT;
const fullBench = CONTRACTOR_CREATIVE_MONTHLY + CONTRACTOR_PHOTO_MONTHLY + CONTRACTOR_MISC_MONTHLY;

describe('the 2027 off-season bench', () => {
  test('January to April 2027 carry half, May onward is full', () => {
    assert.equal(CONTRACTOR_OFF_SEASON_FACTOR, 0.5);
    for (const m of [1, 2, 3, 4]) {
      assert.equal(benchSeasonFactor(2027, m), 0.5, `2027-${m}`);
      assert.ok(Math.abs(contractorCost(2027, m, fleet, SEASON.CA[m - 1]) - fullBench * 0.5) < 1e-9, `2027-${m}`);
    }
    for (const m of [5, 8, 12]) {
      assert.equal(benchSeasonFactor(2027, m), 1, `2027-${m}`);
      assert.ok(Math.abs(contractorCost(2027, m, fleet, SEASON.CA[m - 1]) - fullBench) < 1e-9, `2027-${m}`);
    }
  });

  test('2026 and 2028 are untouched', () => {
    for (const m of [1, 2, 3, 4]) {
      assert.equal(benchSeasonFactor(2026, m), 1);
      assert.equal(benchSeasonFactor(2028, m), 1);
      assert.ok(Math.abs(contractorCost(2028, m, fleet, SEASON.CA[m - 1]) - fullBench) < 1e-9, `2028-${m}`);
    }
    // 2026's bench is the measured ramp year: July still carries field labor.
    assert.ok(contractorCost(2026, 7, fleet, SEASON.CA[6]) > fullBench);
  });

  test('the photography part carries the factor itself, so a card-only month nets the right operating bench', () => {
    assert.equal(photoCost(2027, 2, fleet), CONTRACTOR_PHOTO_MONTHLY * 0.5);
    assert.equal(photoCost(2027, 6, fleet), CONTRACTOR_PHOTO_MONTHLY);
    const operatingBench = contractorCost(2027, 2, fleet, SEASON.CA[1]) - photoCost(2027, 2, fleet);
    assert.ok(Math.abs(operatingBench - (CONTRACTOR_CREATIVE_MONTHLY + CONTRACTOR_MISC_MONTHLY) * 0.5) < 1e-9);
  });

  test('calcYear carries it into the 2027 rows and foots them', () => {
    const y = calcYear(0, 2027);
    for (const r of y.monthly) {
      const scale = r.active_count / CONTRACTOR_FIELD_PROP_COUNT;
      const want = ((CONTRACTOR_CREATIVE_MONTHLY + CONTRACTOR_PHOTO_MONTHLY) * scale + CONTRACTOR_MISC_MONTHLY) * benchSeasonFactor(2027, r.month);
      assert.ok(Math.abs(r.exp_contractors - want) < 1e-6, `2027-${r.month}: ${r.exp_contractors} vs ${want}`);
    }
    const janApr = y.monthly.slice(0, 4).reduce((a, r) => a + r.exp_contractors, 0);
    const mayAug = y.monthly.slice(4, 8).reduce((a, r) => a + r.exp_contractors, 0);
    assert.ok(janApr < mayAug * 0.6, 'the off-season third of the year reads well under the summer');
  });
});
