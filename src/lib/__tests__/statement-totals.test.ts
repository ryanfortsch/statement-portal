/**
 * Pins THE formula. If any of these fail, a payout has moved.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStatementTotals, deriveCleaningTotal, round2,
  CLEANING_MONEY_SOURCES, type StatementInputs,
} from '../statement-totals.ts';

const base = (over: Partial<StatementInputs> = {}): StatementInputs => ({
  month: '2026-08',
  managementFeePct: 25,
  reservations: [
    { adjusted_revenue: 1000, nights: 4, check_out: '2026-08-10' },
    { adjusted_revenue: 500.5, nights: 2, check_out: '2026-08-20' },
  ],
  cleaningEvents: [
    { amount: 150, credit_amount: null, source: 'bank' },
    { amount: 150, credit_amount: null, source: 'matched' },
  ],
  addOns: { addOnsRevenue: 0, addOnsMgmtBase: 0, attributedDebits: 0 },
  repairsTotal: 0,
  reserveHoldback: 0,
  ...over,
});

describe('the canonical formula', () => {
  test('zero add-ons reproduces the pre-add-on formula exactly', () => {
    const t = computeStatementTotals(base());
    assert.equal(t.rental_revenue, 1500.5);
    assert.equal(t.management_fee, round2(1500.5 * 0.25));   // 375.13
    assert.equal(t.cleaning_total, 300);
    assert.equal(t.owner_payout, round2(1500.5 - 375.13 - 300)); // 825.37
    assert.equal(t.add_ons_revenue, 0);
    assert.equal(t.attributed_debits_total, 0);
  });

  test('add-ons enter revenue and the fee base only when apply_mgmt_fee; debits subtract', () => {
    const t = computeStatementTotals(base({
      addOns: { addOnsRevenue: 200, addOnsMgmtBase: 120, attributedDebits: 275 },
    }));
    // fee_base = 1500.5 + 120 = 1620.5 ; fee = 405.13
    assert.equal(t.management_fee, round2(1620.5 * 0.25));
    // payout = 1500.5 + 200 - 405.13 - 300 - 0 - 275 - 0
    assert.equal(t.owner_payout, round2(1500.5 + 200 - 405.13 - 300 - 275));
    assert.equal(t.attributed_debits_total, 275);
  });

  test('the #1348 regression: an attributed DEBIT must subtract, never add', () => {
    const asDebit = computeStatementTotals(base({ addOns: { addOnsRevenue: 0, addOnsMgmtBase: 0, attributedDebits: 275 } }));
    const asAddOn = computeStatementTotals(base({ addOns: { addOnsRevenue: 275, addOnsMgmtBase: 275, attributedDebits: 0 } }));
    // On a $275 debit at 25%: mis-signing overpays by 481.25 and under-charges the fee by 68.75.
    assert.equal(round2(asAddOn.owner_payout - asDebit.owner_payout), 481.25);
    assert.equal(round2(asDebit.management_fee - asAddOn.management_fee), -68.75);
  });

  test('reserve holdback and repairs come straight off the payout, never off the fee base', () => {
    const t = computeStatementTotals(base({ repairsTotal: 120, reserveHoldback: 2000 }));
    assert.equal(t.management_fee, round2(1500.5 * 0.25));
    assert.equal(t.owner_payout, round2(1500.5 - 375.13 - 300 - 120 - 2000));
    assert.equal(t.repairs_total, 120);
    assert.equal(t.reserve_holdback, 2000);
  });

  test('management_fee_pct is a whole number (25 means 25%)', () => {
    assert.equal(computeStatementTotals(base({ managementFeePct: 22 })).management_fee, round2(1500.5 * 0.22));
    assert.equal(computeStatementTotals(base({ managementFeePct: 0 })).management_fee, 0);
  });

  test('rounding: the fee is rounded to cents BEFORE it enters the payout', () => {
    // 333.34 * .25 = 83.335. Rounded first -> 83.34 -> payout 250.00.
    // Unrounded, 333.34 - 83.335 = 250.005 -> 250.01. This fixture is
    // chosen because the two orders DISAGREE; the previous fixture
    // (333.333) passed under either order, which pinned nothing.
    const t = computeStatementTotals(base({
      reservations: [{ adjusted_revenue: 333.34, nights: 1, check_out: '2026-08-01' }],
      cleaningEvents: [],
    }));
    assert.equal(t.rental_revenue, 333.34);
    assert.equal(t.management_fee, 83.34);
    assert.equal(t.owner_payout, 250);
  });

  test('the fee base is rounded ONCE: single round2((rental + base) * pct), not ingest\'s old double round', () => {
    // 0.29 + 0.37 = 0.6599999999999999 in doubles. Single round of the
    // product: 0.16. Ingest used to round the base to 0.66 first, giving
    // 0.17. The canonical rule is the single round; this pins it.
    const t = computeStatementTotals(base({
      reservations: [{ adjusted_revenue: 0.29, nights: 1, check_out: '2026-08-01' }],
      cleaningEvents: [],
      addOns: { addOnsRevenue: 0.37, addOnsMgmtBase: 0.37, attributedDebits: 0 },
    }));
    assert.equal(t.management_fee, 0.16);
  });

  test('nulls and undefined in any input read as zero, never NaN', () => {
    const t = computeStatementTotals(base({
      reservations: [{ adjusted_revenue: null, nights: null, check_out: null }],
      cleaningEvents: [{ amount: null, credit_amount: null, source: 'bank' }],
      addOns: { addOnsRevenue: null as unknown as number, addOnsMgmtBase: 0, attributedDebits: 0 },
    }));
    for (const v of Object.values(t)) assert.ok(Number.isFinite(v), `non-finite: ${JSON.stringify(t)}`);
    assert.equal(t.owner_payout, 0);
  });
});

describe('num_stays and nights_booked', () => {
  test('a stay counts once, in its checkout month, only with revenue', () => {
    const t = computeStatementTotals(base({
      reservations: [
        { adjusted_revenue: 900, nights: 3, check_out: '2026-08-05' },   // counts
        { adjusted_revenue: 0,   nights: 2, check_out: '2026-08-06' },   // homeowner: nights yes, stay no
        { adjusted_revenue: 400, nights: 9, check_out: '2026-09-02' },   // installment slice: money+nights, not a stay here
      ],
    }));
    assert.equal(t.num_stays, 1);
    assert.equal(t.nights_booked, 14);
    assert.equal(t.rental_revenue, 1300);
  });
});

describe('cleaning_total derivation (bank is the source of truth)', () => {
  test('only bank-family sources bill; an invoice-only row is attribution, not money', () => {
    const total = deriveCleaningTotal([
      { amount: 150, credit_amount: null, source: 'bank' },
      { amount: 150, credit_amount: null, source: 'matched' },
      { amount: 150, credit_amount: null, source: 'corroborated' },
      { amount: 40,  credit_amount: null, source: 'bank-linen' },
      { amount: 25,  credit_amount: null, source: 'bank-laundry' },
      { amount: 999, credit_amount: null, source: 'invoice' },   // the #11 critical: must NOT bill
      { amount: 999, credit_amount: null, source: null },
    ]);
    assert.equal(total, 515);
  });

  test('a credit nets against its charge; the charge stays on file', () => {
    assert.equal(deriveCleaningTotal([
      { amount: 150, credit_amount: 150, source: 'bank' },   // full refund: bills 0
      { amount: 150, credit_amount: 50,  source: 'matched' },
    ]), 100);
  });

  test('the money-source set is exactly the five bank-family kinds', () => {
    assert.deepEqual([...CLEANING_MONEY_SOURCES].sort(), ['bank', 'bank-laundry', 'bank-linen', 'corroborated', 'matched']);
  });
});
