import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcYear,
  ccOperatingDetail,
  type ActualsByMonth,
} from '../forecast-model.ts';

type ActualsMonth = ActualsByMonth[number];
const winterMonths = [[2026, 11], [2026, 12], [2027, 1], [2027, 2], [2027, 3], [2027, 4]] as const;
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} vs ${expected}`);

describe('November 2026 to April 2027 supplies budget', () => {
  test('reduces only supplies by 25%, including fractional expected home counts', () => {
    for (const count of [0, 13.74, 17, 24]) {
      for (const [year, month] of winterMonths) {
        const baseline = ccOperatingDetail(count, 2028, month);
        const reduced = ccOperatingDetail(count, year, month);
        close(reduced.supplies, baseline.supplies * 0.75);
        assert.deepEqual({ ...reduced, supplies: baseline.supplies }, baseline);
      }
    }
  });

  test('leaves the seasonal budget intact outside the requested winter', () => {
    for (const year of [2026, 2027, 2028]) {
      for (let month = 1; month <= 12; month++) {
        if (winterMonths.some(([y, m]) => y === year && m === month)) continue;
        close(ccOperatingDetail(17, year, month).supplies, ccOperatingDetail(17, 2028, month).supplies);
      }
    }
  });

  test('flows through card totals, expenses and net income while onboarding stays separate', () => {
    for (const year of [2026, 2027] as const) {
      const result = calcYear(3, year);
      for (const row of result.monthly) {
        assert.ok(row.cc_detail);
        const baseline = ccOperatingDetail(row.active_count, 2028, row.month);
        const inWindow = winterMonths.some(([y, m]) => y === year && m === row.month);
        close(row.cc_detail.supplies, baseline.supplies * (inWindow ? 0.75 : 1));
        close(row.exp_cc_ops, Object.values(row.cc_detail).reduce((sum, cost) => sum + cost, 0));
        close(row.exp_total,
          row.exp_cc_ops + row.exp_office + row.exp_software + row.exp_debt +
          row.exp_insurance + row.exp_accounting + row.exp_bank + row.exp_contractors +
          row.exp_payroll + row.exp_onboard_presigned + row.exp_onboard_new);
        close(row.net_business, row.rev_total - row.exp_total);
      }
      close(result.totals.exp_total, result.monthly.reduce((sum, row) => sum + row.exp_total, 0));
    }
    assert.equal(calcYear(3, 2027).monthly[2].exp_onboard_new, 3400);
  });

  test('preserves measured supplies in covered and card-only months', () => {
    const detail = { supplies: 2400, repairs: 350, marketing: 225, vehicle_insurance: 519, travel_other: 360, telecom: 114 };
    for (const operating_covered of [true, false]) {
      const actual: ActualsMonth = {
        month: '2026-11', revenue: 20000,
        exp_office: 750, exp_software: 2700, exp_debt: 0, exp_insurance: 0,
        exp_accounting: 0, exp_bank: 10, exp_contractors: 250, exp_payroll: 6400,
        exp_onboard_presigned: 0, exp_onboard_new: 400,
        exp_cc_ops: Object.values(detail).reduce((sum, cost) => sum + cost, 0),
        cc_detail: detail, operating_covered,
      };
      const actuals = [] as ActualsMonth[];
      actuals[10] = actual;
      const november = calcYear(0, 2026, actuals, 11).monthly[10];
      assert.equal(november.is_actual, true);
      assert.equal(november.cc_detail?.supplies, 2400);
      assert.equal(november.cc_detail?.repairs, 350);
      assert.equal(november.exp_onboard_new, 400);
    }
  });
});
