import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { calcYear, itemizedSoftwareCost, type ActualsByMonth, type ForecastYear } from '../forecast-model.ts';

const budgets: Record<ForecastYear, number[]> = {
  2026: [2700, 2700, 2700, 2700, 2700, 2700, 2700, 2700, 2700, 2700, 2707.06, 2659.88],
  2027: [2409.88, 2109.88, 1709.88, 1190.46, 1247.74, 1190.46, 1190.46, 1190.46, 1190.46, 1190.46, 1190.46, 1190.46],
  2028: [1190.46, 1190.46, 1190.46, 1190.46, 1247.74, 1190.46, 1190.46, 1190.46, 1190.46, 1190.46, 1190.46, 1190.46],
};

describe('Guesty exit software budget', () => {
  test('itemizes the steady budget without deducting cancellations twice, and renews annual software once', () => {
    assert.equal(itemizedSoftwareCost(4), 1190.46);
    assert.equal(itemizedSoftwareCost(5), 1247.74);
    assert.equal(itemizedSoftwareCost(6), 1190.46);
  });
  test('uses the approved monthly totals through 2028 independently of the new-home slider', () => {
    for (const year of [2026, 2027, 2028] as const) {
      for (const newHomes of [0, 3, 8]) {
        assert.deepEqual(calcYear(newHomes, year).monthly.map(row => row.exp_software), budgets[year]);
      }
    }
    assert.ok(Math.abs(calcYear(0, 2027).monthly.reduce((sum, row) => sum + row.exp_software, 0) - 17001.06) < 1e-6);
    assert.ok(Math.abs(calcYear(0, 2028).monthly.reduce((sum, row) => sum + row.exp_software, 0) - 14342.80) < 1e-6);
  });

  test('keeps measured software spending in covered and card-only months, including zero spend', () => {
    for (const [year, month] of [[2026, 11], [2027, 1], [2027, 4], [2028, 1]] as const) {
      for (const operating_covered of [true, false]) {
        for (const measured of [0, 2925.43]) {
          const actuals: ActualsByMonth[number][] = [];
          actuals[month - 1] = {
            month: `${year}-${String(month).padStart(2, '0')}`, revenue: 20000,
            exp_office: 750, exp_software: measured, exp_debt: 0, exp_insurance: 0,
            exp_accounting: 0, exp_bank: 10, exp_contractors: 250, exp_payroll: 6400,
            exp_onboard_presigned: 0, exp_onboard_new: 0, exp_cc_ops: 3000,
            operating_covered,
          };
          const result = calcYear(0, year, actuals, month);
          const row = result.monthly[month - 1];
          assert.equal(row.is_actual, true);
          assert.equal(row.actual_card_only, !operating_covered);
          assert.equal(row.exp_software, measured);
          assert.equal(result.monthly[month].exp_software, budgets[year][month], 'next month still uses the plan');

          const zeroActuals = actuals.slice();
          zeroActuals[month - 1] = { ...actuals[month - 1], exp_software: 0 };
          const zero = calcYear(0, year, zeroActuals, month);
          assert.ok(Math.abs(result.totals.exp_total - zero.totals.exp_total - measured) < 1e-6);
          assert.ok(Math.abs(result.totals.net_business - zero.totals.net_business + measured) < 1e-6);
          assert.ok(Math.abs(result.cumulative[11] - zero.cumulative[11] + measured) < 1e-6);
        }
      }
    }
  });

  test('still budgets expenses when only statement revenue is measured', () => {
    const result = calcYear(0, 2027, undefined, undefined, undefined, undefined, undefined,
      undefined, new Map([[1, 20000], [4, 30000]]));
    for (const month of [1, 4]) {
      const row = result.monthly[month - 1];
      assert.equal(row.is_actual, true);
      assert.equal(row.exp_software, budgets[2027][month - 1]);
      assert.ok(Math.abs(row.net_business - (row.rev_total - row.exp_total)) < 1e-6);
    }
  });
});
