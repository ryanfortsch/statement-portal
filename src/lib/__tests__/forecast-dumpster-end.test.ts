/**
 * The office dumpster ends 2026-11-30.
 *
 * Rising Tide sent Republic Services written notice on 2026-10-05 (CSA
 * A913211849) and the operator confirmed on 2026-10-14 that the cancellation
 * stands. The forecast used to project the dumpster indefinitely. Now
 * November 2026 is the last projected month, December 2026 onward is rent
 * alone, and the actuals classification is untouched so the final Republic
 * invoice still files under Rent & office and rides the Office line.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcYear,
  dumpsterCost,
  hasDumpster,
  officeCost,
  rentCost,
  type ActualsByMonth,
  DUMPSTER_LAST_MONTH,
  DUMPSTER_LAST_YEAR,
  DUMPSTER_MONTHLY,
  OFFICE_RENT_MONTHLY,
  OFFICE_START_MONTH,
} from '../forecast-model.ts';
import { routeCardRow } from '../forecast-card-detail.ts';
import { categorizeOverhead } from '../overhead-categories.ts';

describe('the dumpster projection ends after November 2026', () => {
  test('the cutoff is 2026-11', () => {
    assert.equal(DUMPSTER_LAST_YEAR, 2026);
    assert.equal(DUMPSTER_LAST_MONTH, 11);
    assert.ok(DUMPSTER_MONTHLY > 0, 'the projected figure is still a real number for the months it runs');
  });

  test('a month before the cutoff carries the dumpster, a month after does not', () => {
    assert.equal(hasDumpster(2026, 4), true);
    assert.equal(hasDumpster(2026, 11), true);
    assert.equal(hasDumpster(2026, 12), false);
    assert.equal(hasDumpster(2027, 1), false);
    assert.equal(hasDumpster(2028, 6), false);

    assert.equal(dumpsterCost(2026, 11), DUMPSTER_MONTHLY);
    assert.equal(dumpsterCost(2026, 12), 0);
    assert.equal(dumpsterCost(2027, 1), 0);
  });

  test('the Office line is rent plus dumpster through November, rent alone from December', () => {
    assert.equal(officeCost(2026, 2, OFFICE_START_MONTH), 0, 'nothing before the lease');
    assert.equal(officeCost(2026, 11, OFFICE_START_MONTH), OFFICE_RENT_MONTHLY + DUMPSTER_MONTHLY);
    assert.equal(officeCost(2026, 12, OFFICE_START_MONTH), OFFICE_RENT_MONTHLY);
    assert.equal(officeCost(2027, 1, 1), OFFICE_RENT_MONTHLY);
    assert.equal(officeCost(2028, 12, 1), OFFICE_RENT_MONTHLY);
  });

  test('calcYear carries the cutoff into the rows: 2026-11 has it, 2026-12 and all of 2027 do not', () => {
    const y2026 = calcYear(0, 2026);
    const nov = y2026.monthly[10];
    const dec = y2026.monthly[11];
    assert.equal(nov.month, 11);
    assert.equal(nov.exp_office, OFFICE_RENT_MONTHLY + DUMPSTER_MONTHLY);
    assert.equal(dec.month, 12);
    assert.equal(dec.exp_office, OFFICE_RENT_MONTHLY);

    const y2027 = calcYear(0, 2027);
    assert.equal(y2027.monthly.length, 12);
    for (const m of y2027.monthly) {
      assert.equal(m.exp_office, OFFICE_RENT_MONTHLY, `2027-${m.month} should project rent only`);
    }
  });

  test('actuals are untouched: a Republic invoice still files under Rent & office and rides the Office line', () => {
    assert.equal(
      categorizeOverhead({ account: 'card', description: 'REPUBLIC SERVICES TRASH', amount: -471, chaseCategory: 'Home' }),
      'Rent & office',
    );
    assert.equal(routeCardRow('Rent & office', 'REPUBLIC SERVICES TRASH'), 'office');
  });
});


describe('the second office lease is included from July 2026', () => {
  test('dates the partial month and ongoing rent without changing earlier months', () => {
    assert.equal(rentCost(2026, 2, 3), 0);
    assert.equal(rentCost(2026, 3, 3), 750);
    assert.equal(rentCost(2026, 6, 3), 750);
    assert.equal(rentCost(2026, 7, 3), 830);
    assert.equal(rentCost(2026, 8, 3), 1000);
    assert.equal(calcYear(0, 2027).monthly.reduce((sum, row) => sum + row.exp_office, 0), 12000);
  });

  test('card-only months add dated projected rent; covered operating months preserve measured rent', () => {
    for (const [month, expectedRent] of [[6, 750], [7, 830], [8, 1000], [12, 1000]]) {
      const actuals: ActualsByMonth[number][] = [];
      actuals[month - 1] = {
        month: `2026-${String(month).padStart(2, '0')}`, revenue: 20000,
        exp_office: 75, exp_software: 500, exp_debt: 0, exp_insurance: 0,
        exp_accounting: 0, exp_bank: 0, exp_contractors: 0, exp_payroll: 0,
        exp_onboard_presigned: 0, exp_onboard_new: 0, exp_cc_ops: 0,
        operating_covered: false,
      };
      const projected = calcYear(0, 2026, actuals, month).monthly[month - 1];
      assert.equal(projected.exp_office, 75 + expectedRent);
      actuals[month - 1] = { ...actuals[month - 1], operating_covered: true };
      const measured = calcYear(0, 2026, actuals, month).monthly[month - 1];
      assert.equal(measured.exp_office, 75);
    }
  });
});
