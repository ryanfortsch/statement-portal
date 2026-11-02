import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { bundleCleaningTurnovers, itemizationTiesToTotal } from '../cleaning-turnovers.ts';
import { deriveCleaningTotal } from '../statement-totals.ts';

// 16 Waterman, October 2026: the month the Grubers asked for the list. Seven
// turnovers, one with two laundry deliveries, one with none, and the Sept 30
// checkout billed in October because the bank was charged Oct 2.
const waterman = [
  { checkout_date: null, bank_charge_date: '2026-10-02', guest_name: null, source: 'bank-laundry', amount: '47.00', credit_amount: '0' },
  { checkout_date: null, bank_charge_date: '2026-10-02', guest_name: null, source: 'corroborated', amount: '280.00', credit_amount: '0' },
  { checkout_date: '2026-10-05', bank_charge_date: '2026-10-07', guest_name: 'Brittney Dahlen', source: 'bank-laundry', amount: '64.60', credit_amount: '0' },
  { checkout_date: '2026-10-05', bank_charge_date: '2026-10-07', guest_name: 'Brittney Dahlen', source: 'corroborated', amount: '235.00', credit_amount: '0' },
  { checkout_date: '2026-10-09', bank_charge_date: '2026-10-13', guest_name: 'Joella Boyd', source: 'bank-laundry', amount: '41.50', credit_amount: '0' },
  { checkout_date: '2026-10-09', bank_charge_date: '2026-10-13', guest_name: 'Joella Boyd', source: 'corroborated', amount: '280.00', credit_amount: '0' },
  { checkout_date: '2026-10-12', bank_charge_date: '2026-10-14', guest_name: 'Mandy Goetz', source: 'bank-laundry', amount: '75.50', credit_amount: '0' },
  { checkout_date: '2026-10-12', bank_charge_date: '2026-10-14', guest_name: 'Mandy Goetz', source: 'corroborated', amount: '280.00', credit_amount: '0' },
  { checkout_date: '2026-10-19', bank_charge_date: '2026-10-21', guest_name: 'Cassondra Hammerstrom', source: 'bank-laundry', amount: '69.40', credit_amount: '0' },
  { checkout_date: '2026-10-19', bank_charge_date: '2026-10-21', guest_name: 'Cassondra Hammerstrom', source: 'corroborated', amount: '235.00', credit_amount: '0' },
  { checkout_date: '2026-10-23', bank_charge_date: '2026-10-28', guest_name: 'Julie Stults', source: 'corroborated', amount: '235.00', credit_amount: '0' },
  { checkout_date: '2026-10-26', bank_charge_date: '2026-10-26', guest_name: 'Linda C Gundersen', source: 'bank-laundry', amount: '60.00', credit_amount: '0' },
  { checkout_date: '2026-10-26', bank_charge_date: '2026-10-28', guest_name: 'Linda C Gundersen', source: 'bank-laundry', amount: '36.10', credit_amount: '0' },
  { checkout_date: '2026-10-26', bank_charge_date: '2026-10-28', guest_name: 'Linda C Gundersen', source: 'corroborated', amount: '190.00', credit_amount: '0' },
];

test('one row per checkout, housekeeping and its laundry bundled, oldest first', () => {
  const { rows, total } = bundleCleaningTurnovers(waterman);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map(r => r.date), [
    '2026-10-02', '2026-10-05', '2026-10-09', '2026-10-12', '2026-10-19', '2026-10-23', '2026-10-26',
  ]);
  const dahlen = rows[1];
  assert.equal(dahlen.guest, 'Brittney Dahlen');
  assert.equal(dahlen.housekeeping, 235);
  assert.equal(dahlen.laundry, 64.6);
  assert.equal(dahlen.total, 299.6);
  // Two deliveries on one turnover add up.
  const gundersen = rows[6];
  assert.equal(gundersen.laundry, 96.1);
  assert.equal(gundersen.total, 286.1);
  // No laundry is zero, not missing.
  assert.equal(rows[5].laundry, 0);
  assert.equal(rows[5].total, 235);
  assert.equal(total, 2129.1);
});

test('rows ingest could not place keep their own line, dated by the bank charge', () => {
  const { rows } = bundleCleaningTurnovers(waterman);
  const sept30 = rows[0];
  // The Oct 2 cleaning and the Oct 2 delivery were never placed on a checkout
  // (the stay closed in September), so they stand together on the bank date,
  // unnamed: the owner reads "Turnover · Oct 2", never a wrong guest.
  assert.equal(sept30.date, '2026-10-02');
  assert.equal(sept30.guest, null);
  assert.equal(sept30.housekeeping, 280);
  assert.equal(sept30.laundry, 47);
});

test('the block ties to the Cleaning line exactly as deriveCleaningTotal bills it', () => {
  const itemization = bundleCleaningTurnovers(waterman);
  const billed = deriveCleaningTotal(waterman.map(e => ({ amount: Number(e.amount), credit_amount: Number(e.credit_amount), source: e.source })));
  assert.equal(itemization.total, billed);
  assert.equal(itemizationTiesToTotal(itemization, String(billed)), true);
  assert.equal(itemizationTiesToTotal(itemization, billed + 0.01), false);
  assert.equal(itemizationTiesToTotal({ rows: [], total: 0 }, 0), false);
});

test('invoice-only rows never itemize and a vendor credit nets its charge', () => {
  const { rows, total } = bundleCleaningTurnovers([
    { checkout_date: '2026-10-05', bank_charge_date: null, guest_name: 'Someone', source: 'invoice', amount: '135.00', credit_amount: '0' },
    { checkout_date: '2026-10-05', bank_charge_date: '2026-10-07', guest_name: 'Someone', source: 'corroborated', amount: '135.00', credit_amount: '25.00' },
    { checkout_date: null, bank_charge_date: null, guest_name: null, source: 'bank-laundry', amount: '30.00', credit_amount: '0' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].housekeeping, 110);
  assert.equal(total, 110);
});

test('the render page prints the block only for an opted-in home whose rows tie to the line', () => {
  const source = readFileSync(new URL('../../app/statements/render/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /statement_cleaning_detail/);
  assert.match(source, /itemizationTiesToTotal\(/);
  // The money columns never read the flag: the block is presentation only.
  for (const file of ['../statement-totals.ts', '../statement-totals-write.ts', '../statement-addons.ts']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /statement_cleaning_detail/, file);
  }
});
