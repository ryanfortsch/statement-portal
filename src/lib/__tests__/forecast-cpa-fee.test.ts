/**
 * The CPA's year-end fee is budgeted from 2027.
 *
 * MS Consultants (April 2026) was ruled a one-off on 2026-09-02, which left
 * 2027 and later with no accountant at all. Jim Keefe (Lee & Crowley) now
 * does the three LLC returns, the 1099s and the tax projection, and Dotti
 * asked on 2026-11-09 for his fee to be budgeted: one April charge a year.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountingCost,
  ACCOUNTING_ANNUAL,
  CPA_ANNUAL,
  CPA_MONTH,
} from '../forecast-model.ts';

describe('accountingCost', () => {
  test('2026 keeps the MS Consultants April charge and nothing else', () => {
    for (let m = 1; m <= 12; m++) {
      assert.equal(accountingCost(2026, m), m === 4 ? ACCOUNTING_ANNUAL : 0);
    }
  });

  test('2027 and 2028 carry one CPA charge, in April', () => {
    for (const year of [2027, 2028]) {
      let total = 0;
      for (let m = 1; m <= 12; m++) {
        const cost = accountingCost(year, m);
        assert.equal(cost, m === CPA_MONTH ? CPA_ANNUAL : 0);
        total += cost;
      }
      assert.equal(total, CPA_ANNUAL);
      assert.ok(CPA_ANNUAL > 0);
    }
  });
});
