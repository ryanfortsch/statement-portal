/**
 * The bench runs at half for January to April 2027.
 *
 * Dotti, 2026-10-21: "reduce the contractor expense by 50% from Jan-Apr of
 * 2027". The ruling covered the whole Contractors line in those four months
 * and nothing else: May 2027 onward is full, 2026 is untouched, and 2028 is
 * untouched because the ask named 2027.
 *
 * Since 2026-11-07 the line is only the misc blend (Cooper is marketing,
 * the listing shoot is onboarding), so the factor is checked on the row it
 * still owns, and Cooper's term is checked NOT to carry it: Dotti dropped
 * the half from his line the same day ("Drop the half").
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  benchSeasonFactor,
  calcYear,
  ccOperatingDetail,
  contractorCost,
  creativeCost,
  listingCost,
  marketingCost,
  CONTRACTOR_FIELD_PROP_COUNT,
  CONTRACTOR_MISC_MONTHLY,
  CONTRACTOR_OFF_SEASON_FACTOR,
  MARKETING_CREATIVE_MONTHLY,
  SEASON,
} from '../forecast-model.ts';

const fleet = CONTRACTOR_FIELD_PROP_COUNT;
const fullBench = CONTRACTOR_MISC_MONTHLY;

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

  test("Cooper's term in marketing runs full every month, off-season included", () => {
    for (const m of [1, 2, 3, 4, 6, 11]) {
      assert.equal(creativeCost(2027, m, fleet), MARKETING_CREATIVE_MONTHLY, `2027-${m}`);
    }
    assert.equal(creativeCost(2028, 2, fleet), MARKETING_CREATIVE_MONTHLY);
    const feb = ccOperatingDetail(fleet, 2027, 2).marketing;
    assert.ok(Math.abs(feb - (marketingCost(2027, 2) + listingCost(2) + MARKETING_CREATIVE_MONTHLY)) < 1e-9);
  });

  test('calcYear carries it into the 2027 rows and foots them', () => {
    const y = calcYear(0, 2027);
    for (const r of y.monthly) {
      const want = CONTRACTOR_MISC_MONTHLY * benchSeasonFactor(2027, r.month);
      assert.ok(Math.abs(r.exp_contractors - want) < 1e-6, `2027-${r.month}: ${r.exp_contractors} vs ${want}`);
      const wantMkt = marketingCost(2027, r.month) + listingCost(r.month) + creativeCost(2027, r.month, r.active_count);
      assert.ok(r.cc_detail, `2027-${r.month} has card detail`);
      assert.ok(Math.abs(r.cc_detail.marketing - wantMkt) < 1e-6, `2027-${r.month} marketing ${r.cc_detail.marketing} vs ${wantMkt}`);
    }
    const janApr = y.monthly.slice(0, 4).reduce((a, r) => a + r.exp_contractors, 0);
    const mayAug = y.monthly.slice(4, 8).reduce((a, r) => a + r.exp_contractors, 0);
    assert.ok(janApr < mayAug * 0.6, 'the off-season third of the year reads well under the summer');
  });
});
