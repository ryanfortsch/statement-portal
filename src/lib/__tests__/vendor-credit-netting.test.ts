import test from 'node:test';
import assert from 'node:assert/strict';
import {
  netVendorCredits,
  vendorChargeNet,
  vendorCreditFields,
  reapplyPreservedCredits,
  unappliedRefundGap,
  orphanedCreditGap,
  type VendorCharge,
  type VendorCredit,
  type PreservedCleaningCredit,
  type CreditableInsert,
} from '../vendor-credit-netting.ts';

const charge = (date: string, amount: number, vendor = 'Cape Ann Elite'): VendorCharge =>
  ({ date, amount, description: `${vendor} ACH`, vendor });
const credit = (kind: VendorCredit['kind'], date: string, amount: number, vendor = 'Cape Ann Elite'): VendorCredit =>
  ({ kind, vendor, date, amount, description: `${vendor} refund` });

const pools = (cleaning: VendorCharge[] = [], linen: VendorCharge[] = [], laundry: VendorCharge[] = []) =>
  ({ cleaning, linen, laundry });

test('an exact same-kind refund nets the charge and bills the net', () => {
  const ch = charge('07/03/2026', 47.4, 'Laundry Plus');
  const unmatched = netVendorCredits(pools([], [], [ch]), [credit('laundry', '07/10/2026', 47.4, 'Laundry Plus')], 'ingest');
  assert.deepEqual(unmatched, []);
  assert.equal(ch.credit_amount, 47.4);
  assert.equal(ch.credit_reason, 'Laundry Plus refund posted 07/10/2026 (auto-netted at ingest)');
  assert.equal(vendorChargeNet(ch), 0);
  assert.deepEqual(vendorCreditFields(ch), { credit_amount: 47.4, credit_reason: ch.credit_reason });
});

test('among several same-amount charges the nearest bank date wins', () => {
  const far = charge('07/01/2026', 250);
  const near = charge('07/20/2026', 250);
  const later = charge('07/28/2026', 250);
  netVendorCredits(pools([far, near, later]), [credit('cleaning', '07/22/2026', 250)], 'ingest');
  assert.equal(near.credit_amount, 250);
  assert.equal(far.credit_amount, undefined);
  assert.equal(later.credit_amount, undefined);
});

test('a charge absorbs at most one credit; the second finds the next charge or nothing', () => {
  const a = charge('07/05/2026', 250);
  const b = charge('07/12/2026', 250);
  const unmatched = netVendorCredits(
    pools([a, b]),
    [credit('cleaning', '07/06/2026', 250), credit('cleaning', '07/07/2026', 250), credit('cleaning', '07/08/2026', 250)],
    'ingest',
  );
  assert.equal(a.credit_amount, 250);
  assert.equal(b.credit_amount, 250);
  assert.equal(unmatched.length, 1);
});

test('a partial refund is never guessed at: it comes back unmatched, the charge untouched', () => {
  const ch = charge('07/05/2026', 250);
  const unmatched = netVendorCredits(pools([ch]), [credit('cleaning', '07/09/2026', 125)], 'ingest');
  assert.equal(unmatched.length, 1);
  assert.equal(ch.credit_amount, undefined);
  assert.equal(vendorChargeNet(ch), 250);
  assert.deepEqual(vendorCreditFields(ch), {});
});

test('kinds do not cross: a linen refund never nets a cleaning charge', () => {
  const cleaning = charge('07/05/2026', 95);
  const unmatched = netVendorCredits(pools([cleaning]), [credit('linen', '07/09/2026', 95, "Nor'East")], 'ingest');
  assert.equal(unmatched.length, 1);
  assert.equal(cleaning.credit_amount, undefined);
});

test('a maintenance-vendor refund is always returned unmatched (repair_events has no credit columns)', () => {
  const unmatched = netVendorCredits(pools([charge('07/05/2026', 300)]), [credit('repair', '07/09/2026', 300, 'Handyman')], 'ingest');
  assert.equal(unmatched.length, 1);
});

test('the cent tolerance is half a cent, not a dollar', () => {
  const ch = charge('07/05/2026', 250.0);
  assert.equal(netVendorCredits(pools([ch]), [credit('cleaning', '07/09/2026', 250.004)], 'ingest').length, 0);
  const ch2 = charge('07/05/2026', 250.0);
  assert.equal(netVendorCredits(pools([ch2]), [credit('cleaning', '07/09/2026', 250.01)], 'ingest').length, 1);
});

test('the stored reason names the pipeline that netted it', () => {
  const ch = charge('07/05/2026', 250);
  netVendorCredits(pools([ch]), [credit('cleaning', '07/09/2026', 250)], 'bank re-upload');
  assert.match(ch.credit_reason || '', /\(auto-netted at bank re-upload\)$/);
});

// --- preserved operator credits across a rebuild ---

const insert = (date: string | null, amount: number, source: string): CreditableInsert =>
  ({ bank_charge_date: date, bank_charge_amount: amount, amount, source });
const preserved = (over: Partial<PreservedCleaningCredit>): PreservedCleaningCredit => ({
  bank_charge_date: '2026-07-05', bank_charge_amount: 250, source: 'matched', vendor: 'Cape Ann Elite',
  credit_amount: 250, credit_reason: 'Duplicate charge', ...over,
});

test('a hand-applied credit lands back on the same charge after a rebuild', () => {
  const rows = [insert('2026-07-05', 250, 'bank'), insert('2026-07-12', 250, 'matched')];
  const orphans = reapplyPreservedCredits(rows, [preserved({ source: 'matched' })]);
  assert.deepEqual(orphans, []);
  assert.equal(rows[0].credit_amount, 250);
  assert.equal(rows[0].credit_reason, 'Duplicate charge');
  assert.equal(rows[1].credit_amount, undefined);
});

test("'matched' and 'bank' are the same charge: a changed checkout match does not orphan the credit", () => {
  const rows = [insert('2026-07-05', 250, 'bank')];
  assert.deepEqual(reapplyPreservedCredits(rows, [preserved({ source: 'matched' })]), []);
  assert.equal(rows[0].credit_amount, 250);
});

test('a credit whose charge did not come back is returned as orphaned, nothing else touched', () => {
  const rows = [insert('2026-07-19', 250, 'bank')];
  const orphans = reapplyPreservedCredits(rows, [preserved({ bank_charge_date: '2026-07-05' })]);
  assert.equal(orphans.length, 1);
  assert.equal(rows[0].credit_amount, undefined);
});

test('auto-netted credits are not re-applied (the netting pass recomputes them)', () => {
  const rows = [insert('2026-07-05', 250, 'bank')];
  const orphans = reapplyPreservedCredits(rows, [preserved({ credit_reason: 'Cape Ann Elite refund posted 07/09/2026 (auto-netted at ingest)' })]);
  assert.deepEqual(orphans, []);
  assert.equal(rows[0].credit_amount, undefined);
});

test('a charge already carrying a credit is never credited twice, and is not an orphan', () => {
  const rows = [{ ...insert('2026-07-05', 250, 'bank'), credit_amount: 250, credit_reason: 'auto' }];
  const orphans = reapplyPreservedCredits(rows, [preserved({})]);
  assert.deepEqual(orphans, []);
  assert.equal(rows[0].credit_amount, 250);
  assert.equal(rows[0].credit_reason, 'auto');
});

test('linen and laundry credits stay in their own family', () => {
  const rows = [insert('2026-07-05', 95, 'bank-linen'), insert('2026-07-05', 95, 'bank-laundry')];
  reapplyPreservedCredits(rows, [preserved({ bank_charge_amount: 95, credit_amount: 95, source: 'bank-laundry', vendor: 'Laundry Plus' })]);
  assert.equal(rows[0].credit_amount, undefined);
  assert.equal(rows[1].credit_amount, 95);
});

test('the re-applied credit is capped at the charge', () => {
  const rows = [insert('2026-07-05', 250, 'bank')];
  reapplyPreservedCredits(rows, [preserved({ credit_amount: 400 })]);
  assert.equal(rows[0].credit_amount, 250);
});

test('gap builders: unapplied refund is critical and says whether it was parked', () => {
  const c = credit('laundry', '07/10/2026', 47.4, 'Laundry Plus');
  const parked = unappliedRefundGap(c, { parkedInQueue: true });
  const notParked = unappliedRefundGap(c, { parkedInQueue: false });
  assert.equal(parked.gap_type, 'vendor_refund_unapplied');
  assert.equal(parked.severity, 'critical');
  assert.match(parked.description, /\$47\.40 credit on 07\/10\/2026/);
  assert.match(parked.description, /parked in the bank review queue/);
  assert.doesNotMatch(notParked.description, /parked/);
});

test('gap builders: an orphaned credit names the charge and the credit it lost', () => {
  const g = orphanedCreditGap(preserved({ credit_amount: 125, credit_reason: 'Duplicate charge' }));
  assert.equal(g.gap_type, 'cleaning_credit_orphaned');
  assert.equal(g.severity, 'critical');
  assert.match(g.description, /\$125\.00 credit/);
  assert.match(g.description, /Cape Ann Elite charge of \$250\.00 on 2026-07-05/);
  assert.match(g.description, /"Duplicate charge"/);
});
