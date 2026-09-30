import test from 'node:test';
import assert from 'node:assert/strict';
import { computeProjection, type PayoutBreakdown } from '../projections-model.ts';
import type { ProjectionRow } from '../projections-types.ts';

// Synthetic economics only; the calculation does not use owner identity.
function inputs(overrides: Partial<ProjectionRow> = {}): ProjectionRow {
  return {
    market: 'Rockport', bedrooms: 3, home_value: 1_000_000,
    mgmt_fee_pct: 0.25, base_cleaning: 200, addl_cleaning_per_br: 50,
    turnovers_per_year: 40, year2_growth_pct: 0.1,
    revenue_override_low: null, revenue_override_high: null,
    hero_low_override: null, hero_high_override: null,
    apply_ramp: false, start_month: 9,
    ...overrides,
  } as ProjectionRow;
}

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

const moneyFields: (keyof PayoutBreakdown)[] = [
  'grossRevenue', 'managementFee', 'cleaningExpense', 'netPayout',
];

for (const market of ['Rockport', 'Gloucester'] as const) {
  test(`${market}: typical homes allocate 40% to July/August at every bedroom size`, () => {
    for (const bedrooms of [1, 2, 3, 4, 5, 6]) {
      for (const home_value of [500_000, 1_000_000, 1_500_000]) {
        const c = computeProjection(inputs({ market, bedrooms, home_value }));
        close(c.seasonality[6] + c.seasonality[7], 0.4);
        close(c.seasonality.reduce((a, b) => a + b, 0), 1);
        assert.ok(c.seasonality.every(w => Number.isFinite(w) && w >= 0));
        for (const [rows, annual] of [
          [c.monthlyYear1, c.year1.mid], [c.monthlyYear2, c.year2],
        ] as const) {
          for (const field of moneyFields) {
            close(rows.reduce((sum, row) => sum + row[field], 0), annual[field]);
          }
          close((rows[6].grossRevenue + rows[7].grossRevenue) / annual.grossRevenue, 0.4);
        }
        assert.deepEqual(c.monthlyYear1Ramped, c.monthlyYear1);
      }
    }
  });

  test(`${market}: premium transition remains gradual and reaches the existing 50% curve`, () => {
    for (const [home_value, share] of [[1_500_000, 0.4], [2_000_000, 0.45], [2_500_000, 0.5], [3_000_000, 0.5]]) {
      const c = computeProjection(inputs({ market, home_value }));
      close(c.seasonality[6] + c.seasonality[7], share);
    }
    assert.deepEqual(computeProjection(inputs({ market, home_value: 2_500_000 })).seasonality,
      [0.015, 0.015, 0.02, 0.025, 0.04, 0.1, 0.25, 0.25, 0.11, 0.08, 0.04, 0.055]);
  });
}

test('annual economics keep the pre-calibration baseline', () => {
  const c = computeProjection(inputs());
  close(c.airdna3YrAvg, 58_150.96);
  close(c.year1.mid.grossRevenue, 99_075.48);
  close(c.year1.mid.managementFee, 24_768.87);
  close(c.year1.mid.cleaningExpense, 10_000);
  close(c.year1.mid.netPayout, 64_306.61);
  close(c.year2.netPayout, 70_737.271);
  close(c.heroLow, 56_875.949);
  close(c.heroHigh, 71_737.271);
});

test('calibration preserves the relative AirDNA shape within each group', () => {
  const c = computeProjection(inputs());
  // Independently recorded pre-calibration Rockport weights.
  const july = 0.12380366038281827;
  const august = 0.15350149298547208;
  close(c.seasonality[6] / c.seasonality[7], july / august);
  close(c.seasonality[0] / c.seasonality[11], 0.04218859287402118 / 0.06551696347424081);
  assert.ok(c.seasonality[7] > c.seasonality[6]);
});

test('Beverly keeps its distinct market curve', () => {
  const c = computeProjection(inputs({ market: 'Beverly' }));
  close(c.seasonality[6] + c.seasonality[7], 0.23109121499726076);
  close(c.seasonality[9], 0.160685, 0.000001);
  assert.equal(c.seasonality.indexOf(Math.max(...c.seasonality)), 9);
});

test('revenue and cover overrides survive calibration', () => {
  const c = computeProjection(inputs({
    revenue_override_low: 80_000, revenue_override_high: 120_000,
    hero_low_override: 50_000, hero_high_override: 90_000,
  }));
  close(c.year1.low.grossRevenue, 80_000);
  close(c.year1.mid.grossRevenue, 100_000);
  close(c.year1.high.grossRevenue, 120_000);
  close(c.monthlyYear1[6].grossRevenue + c.monthlyYear1[7].grossRevenue, 40_000);
  assert.equal(c.heroLow, 50_000);
  assert.equal(c.heroHigh, 90_000);
});

test('launch ramps apply after calibration and still reconcile to the launch-year total', () => {
  for (const start_month of [1, 7, 9, 12]) {
    const c = computeProjection(inputs({ apply_ramp: true, start_month }));
    for (const [month, row] of c.monthlyYear1Ramped.entries()) {
      const sinceLaunch = month - (start_month - 1);
      const expectedRamp = sinceLaunch < 0 ? 0 : sinceLaunch === 0 ? 0.2 : sinceLaunch === 1 ? 0.5 : 1;
      assert.equal(row.rampMultiplier, expectedRamp);
      for (const field of moneyFields) close(row[field], c.monthlyYear1[month][field] * expectedRamp);
    }
    for (const field of moneyFields) {
      close(c.monthlyYear1Ramped.reduce((sum, row) => sum + row[field], 0), c.year1Ramped[field]);
    }
    close((c.monthlyYear2[6].grossRevenue + c.monthlyYear2[7].grossRevenue) / c.year2.grossRevenue, 0.4);
  }
});
