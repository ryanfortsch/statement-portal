import test from 'node:test';
import assert from 'node:assert/strict';
import {
  netVendorCredits,
  vendorChargeNet,
  vendorCreditFields,
  unappliedRefundGap,
  type VendorCharge,
  type VendorCredit,
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

test('the refund notice is identified by vendor, amount AND date', () => {
  // Fill Gap uses expected_data as the notice's identity when deciding
  // whether a refund is already filed. Keyed on vendor and amount alone,
  // two separate refunds of the same amount collapse and the second is
  // never raised, leaving the owner billed gross with nothing on the card.
  const a = unappliedRefundGap(credit('laundry', '07/05/2026', 47.4, 'Laundry Plus'), { parkedInQueue: false });
  const b = unappliedRefundGap(credit('laundry', '07/19/2026', 47.4, 'Laundry Plus'), { parkedInQueue: false });
  assert.notEqual(a.expected_data, b.expected_data);
  assert.match(a.expected_data, /refund 07\/05\/2026/);
  // Same refund seen twice must still collapse.
  const again = unappliedRefundGap(credit('laundry', '07/05/2026', 47.4, 'Laundry Plus'), { parkedInQueue: false });
  assert.equal(a.expected_data, again.expected_data);
});
