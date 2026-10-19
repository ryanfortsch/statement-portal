/**
 * Payroll is never a contractor cost.
 *
 * The first W-2 hire was the field contractor. Her Zelle history is real
 * 1099 work and stays Contractors; from 2026-11-01 every dollar paid to her
 * is payroll, her Gusto runs are payroll, the 1099 report skips payroll, and
 * the forecast carries the salary on its own flat line while the per-job
 * field line ends. Each of those is a place a payroll dollar could leak back
 * into "the 1099 bench", so each has a test.
 *
 * The categorizer and the model are dependency-free and run directly; the
 * 1099 report and the ACT builder read Supabase, so those are source guards
 * in the shoot-offer-optin.test.ts style.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  categorizeOverhead,
  canonicalVendor,
  employeePayrollCategory,
  EMPLOYEE_PAYEES,
} from '../overhead-categories.ts';
import {
  calcYear,
  contractorCost,
  onPayroll,
  payrollCost,
  CONTRACTOR_CREATIVE_MONTHLY,
  CONTRACTOR_FIELD_PROP_COUNT,
  CONTRACTOR_MISC_MONTHLY,
  CONTRACTOR_PHOTO_MONTHLY,
  PAYROLL_PLATFORM_MONTHLY,
  PHONE_ALLOWANCE_MONTHLY,
  SALARY_ANNUAL,
  SALARY_EMPLOYER_TAX_RATE,
  SALARY_WORKERS_COMP_RATE,
  SEASON,
} from '../forecast-model.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

// The exact shapes the operating account writes.
const ZELLE = 'Zelle payment to Delaney Jordan JPM99cu66cw3';
const COOPER = 'Basic Online Payroll Payment 11233513351 to #######4113';
const GUSTO_NET = 'ORIG CO NAME:GUSTO                  ORIG ID:9138864001 DESC DATE:260110 CO ENTRY DESCR:NET 2626SEC:CCD    TRACE#:021000029 EED:260112   IND ID:6SEMK8BPUS9                  IND NAME:RISING TIDE STR LLC';
const GUSTO_TAX = GUSTO_NET.replace('DESCR:NET', 'DESCR:TAX');
const GUSTO_FEE = GUSTO_NET.replace('DESCR:NET', 'DESCR:FEE');

const operating = (description: string, txnDate?: string) =>
  categorizeOverhead({ account: 'operating', description, amount: -300, type: 'ACH_DEBIT', txnDate });

describe('a direct payment to someone on payroll', () => {
  test('is a contractor cost before the start date and payroll from it', () => {
    assert.equal(operating(ZELLE, '2026-08-24'), 'Contractors');
    assert.equal(operating(ZELLE, '2026-10-31'), 'Contractors');
    assert.equal(operating(ZELLE, '2026-11-01'), 'Payroll');
    assert.equal(operating(ZELLE, '2027-03-15'), 'Payroll');
    // A timestamp works the same as a date.
    assert.equal(operating(ZELLE, '2026-11-01T14:00:00Z'), 'Payroll');
  });

  test('without a date the row reads as contractor history, as every caller did before', () => {
    assert.equal(operating(ZELLE), 'Contractors');
    assert.equal(employeePayrollCategory('ZELLE PAYMENT TO DELANEY JORDAN'), null);
  });

  test('the Chase payroll rail to the creative contractor is still a contractor cost after the date', () => {
    assert.equal(operating(COOPER, '2026-11-02'), 'Contractors');
  });

  test('the list names the operations manager with her start date', () => {
    const delaney = EMPLOYEE_PAYEES.find((p) => p.needle === 'DELANEY');
    assert.ok(delaney);
    assert.equal(delaney!.from, '2026-11-01');
  });
});

describe('Gusto runs are payroll, all three legs', () => {
  test('NET, TAX and FEE', () => {
    assert.equal(operating(GUSTO_NET, '2026-11-13'), 'Payroll');
    assert.equal(operating(GUSTO_TAX, '2026-11-13'), 'Payroll');
    assert.equal(operating(GUSTO_FEE, '2026-12-04'), 'Payroll');
    assert.equal(operating(GUSTO_NET), 'Payroll');
  });

  test('ADP is matched as a word, so headphones are not payroll', () => {
    assert.equal(categorizeOverhead({ account: 'card', description: 'BEST BUY HEADPHONES', amount: -89, chaseCategory: 'Shopping' }), 'Other');
    assert.equal(categorizeOverhead({ account: 'card', description: 'ADP PAYROLL FEES', amount: -40, chaseCategory: 'Professional Services' }), 'Payroll');
  });

  test('the drill-down names her, so the roster card finds her books total', () => {
    assert.equal(canonicalVendor(ZELLE), 'Delaney Jordan');
    assert.equal(canonicalVendor(GUSTO_NET), 'Gusto (payroll)');
  });
});

describe('the 1099 report skips payroll', () => {
  test('it reads the category and drops Payroll and the card payoff', () => {
    const src = read('src/lib/vendor-1099.ts');
    assert.ok(src.includes("new Set(['Payroll', 'Card payment'])"), 'NOT_VENDOR_PAYMENTS must name both');
    const overhead = src.slice(src.indexOf("from('overhead_expenses')"));
    assert.ok(overhead.includes(".select('description, amount, txn_date, category')"), 'the overhead read must select category');
    assert.ok(overhead.includes('if (r.category && NOT_VENDOR_PAYMENTS.has(r.category)) continue;'), 'and skip the non-vendor rows before adding');
    // The skip sits before the add, not after.
    assert.ok(overhead.indexOf('NOT_VENDOR_PAYMENTS.has(r.category)') < overhead.indexOf("add(name, amt, 'overhead')"));
  });

  test('the upload passes the transaction date so the start-date rule can run', () => {
    const route = read('src/app/api/ingest-overhead/route.ts');
    const call = route.slice(route.indexOf('categorizeOverhead({'), route.indexOf('});', route.indexOf('categorizeOverhead({')));
    assert.ok(call.includes('txnDate: r.txn_date'), 'ingest-overhead must pass txnDate');
  });
});

describe('the forecast carries the salary on its own line', () => {
  test('nothing before November 2026, the full employer cost from it', () => {
    assert.equal(onPayroll(2026, 10), false);
    assert.equal(onPayroll(2026, 11), true);
    assert.equal(onPayroll(2027, 1), true);
    assert.equal(payrollCost(2026, 10), 0);
    const expected =
      (SALARY_ANNUAL / 12) * (1 + SALARY_EMPLOYER_TAX_RATE + SALARY_WORKERS_COMP_RATE) +
      PAYROLL_PLATFORM_MONTHLY +
      PHONE_ALLOWANCE_MONTHLY;
    assert.ok(Math.abs(payrollCost(2026, 11) - expected) < 1e-9);
    assert.ok(Math.abs(payrollCost(2028, 7) - expected) < 1e-9);
    // The number the letter and the costing agreed on: about $6,697 at the
    // $70,000 salary (2026-10-19).
    assert.ok(expected > 6670 && expected < 6720, `monthly all-in ${expected.toFixed(2)}`);
  });

  test('the per-job field line ends the month she joins payroll; creative and misc carry on', () => {
    const fleet = CONTRACTOR_FIELD_PROP_COUNT;
    // Creative, the card-paid photographer (on the bench since 2026-10-15)
    // and the misc blend: everything but the field line.
    const benchOnly = CONTRACTOR_CREATIVE_MONTHLY + CONTRACTOR_PHOTO_MONTHLY + CONTRACTOR_MISC_MONTHLY;
    // October 2026 still pays field labor on the seasonality curve.
    assert.ok(contractorCost(2026, 10, fleet, SEASON.CA[9]) > benchOnly);
    // November does not, in any year after.
    assert.ok(Math.abs(contractorCost(2026, 11, fleet, SEASON.CA[10]) - benchOnly) < 1e-9);
    assert.ok(Math.abs(contractorCost(2027, 7, fleet, SEASON.CA[6]) - benchOnly) < 1e-9);
  });

  test('calcYear foots the salary into every month total, projected and actual', () => {
    const y = calcYear(0, 2026);
    for (const m of y.monthly) {
      const parts =
        m.exp_office + m.exp_software + m.exp_debt + m.exp_insurance + m.exp_accounting +
        m.exp_bank + m.exp_cc_ops + m.exp_contractors + m.exp_payroll +
        m.exp_onboard_presigned + m.exp_onboard_new;
      assert.ok(Math.abs(parts - m.exp_total) < 1e-6, `2026-${m.month} rows do not foot`);
      assert.equal(m.exp_payroll, payrollCost(2026, m.month));
    }
    // An ACT month hands its measured payroll through untouched.
    const actual = {
      month: '2026-11', revenue: 30000, exp_office: 943, exp_software: 2300, exp_debt: 0, exp_insurance: 0,
      exp_accounting: 0, exp_bank: 10, exp_cc_ops: 5000, exp_contractors: 1500, exp_payroll: 6100.5,
      exp_onboard_presigned: 0, exp_onboard_new: 0,
    };
    const actuals = Array.from({ length: 11 }, (_, i) => (i === 10 ? actual : undefined)) as unknown as Parameters<typeof calcYear>[2];
    const withAct = calcYear(0, 2026, actuals, 11);
    const nov = withAct.monthly[10];
    assert.equal(nov.is_actual, true);
    assert.equal(nov.exp_payroll, 6100.5);
    assert.ok(Math.abs(nov.exp_total - (943 + 2300 + 10 + 5000 + 1500 + 6100.5)) < 1e-9);
  });

  test('ACT months route the Payroll category to the salary line, never the bench', () => {
    const src = read('src/lib/forecast-actuals-from-db.ts');
    assert.ok(src.includes("case 'Payroll':         ma.exp_payroll += amt; break;"), 'Payroll rows must land on exp_payroll');
    assert.ok(!src.includes("case 'Payroll':         ma.exp_contractors"), 'and never on exp_contractors');
    assert.ok(src.includes('exp_payroll: round2(ma.exp_payroll)'), 'and be rounded into the month like every other bucket');
  });

  test('the table renders the line, so the rows still foot to the total on screen', () => {
    const ui = read('src/app/forecast/ForecastClient.tsx');
    assert.ok(ui.includes("label: 'Operations manager'") && ui.includes('values: monthly.map((r) => r.exp_payroll)'), 'the Operations manager row must read exp_payroll');
    assert.ok(ui.includes('values: monthly.map((r) => r.exp_contractors)'), 'beside the Contractors row');
    assert.ok(ui.includes('{lineRows(people)}'), 'and the People lines are rendered');
  });
});
