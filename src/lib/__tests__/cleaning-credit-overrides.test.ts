import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCreditOverrides,
  creditOverrideGaps,
  creditOverridesUnavailableGap,
  familyOfSource,
  bankDateToISO,
  isAutoNettedReason,
  overrideIdFromExpectedData,
  AUTO_NETTED_MARKER,
  CREDIT_OVERRIDE_UNAPPLIED,
  CREDIT_OVERRIDE_COLLISION,
  type CreditOverride,
} from '../cleaning-credit-overrides.ts';
import { netVendorCredits, type VendorCharge } from '../vendor-credit-netting.ts';

const charge = (date: string, amount: number, over: Partial<VendorCharge> = {}): VendorCharge =>
  ({ date, amount, description: 'CAPE ANN ELITE', vendor: 'Cape Ann Elite', ...over });
const override = (over: Partial<CreditOverride> = {}): CreditOverride => ({
  id: '11111111-1111-4111-8111-111111111111', family: 'cleaning', charge_date: '2026-08-14', charge_amount: 275,
  credit_amount: 275, reason: 'Duplicate charge', created_at: '2026-08-20T10:00:00Z', ...over,
});
const pools = (cleaning: VendorCharge[], linen: VendorCharge[] = [], laundry: VendorCharge[] = []) => ({ cleaning, linen, laundry });

test('a hand credit re-applies to the rebuilt charge with the same family, date and amount', () => {
  const p = pools([charge('08/07/2026', 275), charge('08/14/2026', 275)]);
  const r = applyCreditOverrides(p, [override()]);
  assert.equal(r.applied.length, 1);
  assert.equal(r.unapplied.length, 0);
  assert.equal(p.cleaning[1].credit_amount, 275);
  assert.equal(p.cleaning[1].credit_reason, 'Duplicate charge');
  assert.equal(p.cleaning[0].credit_amount, undefined, 'the other charge is untouched');
});

test('twins: two overrides on the same identity credit two charges, one each, in bank order', () => {
  const p = pools([charge('08/14/2026', 275), charge('08/14/2026', 275), charge('08/14/2026', 275)]);
  const r = applyCreditOverrides(p, [
    override({ id: 'b', created_at: '2026-08-21T00:00:00Z' }),
    override({ id: 'a', created_at: '2026-08-20T00:00:00Z' }),
  ]);
  assert.equal(r.applied.length, 2);
  assert.equal(p.cleaning[0].credit_amount, 275);
  assert.equal(p.cleaning[1].credit_amount, 275);
  assert.equal(p.cleaning[2].credit_amount, undefined);
  assert.equal(r.applied[0].override.id, 'a', 'creation order decides');
});

test('an override with no such charge is unapplied, never inferred onto a near match', () => {
  const p = pools([charge('08/15/2026', 275), charge('08/14/2026', 250)]);
  const r = applyCreditOverrides(p, [override()]);
  assert.equal(r.applied.length, 0);
  assert.equal(r.unapplied.length, 1);
  assert.equal(p.cleaning[0].credit_amount, undefined);
  assert.equal(p.cleaning[1].credit_amount, undefined);
});

test('a charge carries one credit: an override whose only twin already carries a netted refund is a collision, not stacked', () => {
  const p = pools([charge('08/14/2026', 275)]);
  // The auto-netter runs first, as in both rebuild paths.
  const unmatched = netVendorCredits(p, [{ kind: 'cleaning', vendor: 'Cape Ann Elite', date: '08/20/2026', amount: 275, description: 'refund' }], 'ingest');
  assert.equal(unmatched.length, 0);
  assert.ok(isAutoNettedReason(p.cleaning[0].credit_reason));
  const r = applyCreditOverrides(p, [override()]);
  assert.equal(r.applied.length, 0);
  assert.equal(r.collisions.length, 1);
  assert.equal(p.cleaning[0].credit_amount, 275, 'the netted refund stands alone');
  assert.ok(isAutoNettedReason(p.cleaning[0].credit_reason));
});

test('with a netted twin and a free twin, the override takes the free one', () => {
  const p = pools([charge('08/14/2026', 275), charge('08/14/2026', 275)]);
  netVendorCredits(p, [{ kind: 'cleaning', vendor: 'Cape Ann Elite', date: '08/14/2026', amount: 275, description: 'refund' }], 'ingest');
  const r = applyCreditOverrides(p, [override()]);
  assert.equal(r.applied.length, 1);
  assert.equal(r.collisions.length, 0);
  assert.ok(p.cleaning.every(c => c.credit_amount === 275));
});

test('a partial credit is kept partial and never exceeds the charge', () => {
  const p = pools([charge('08/14/2026', 275)]);
  applyCreditOverrides(p, [override({ credit_amount: 100 })]);
  assert.equal(p.cleaning[0].credit_amount, 100);
  const q = pools([charge('08/14/2026', 275)]);
  applyCreditOverrides(q, [override({ credit_amount: 999 })]);
  assert.equal(q.cleaning[0].credit_amount, 275);
});

test('families do not cross: a laundry override never lands on a cleaning charge of the same date and amount', () => {
  const p = pools([charge('07/10/2026', 47.4)], [], [charge('07/10/2026', 47.4, { vendor: 'Laundry Plus' })]);
  const r = applyCreditOverrides(p, [override({ family: 'laundry', charge_date: '2026-07-10', charge_amount: 47.4, credit_amount: 47.4 })]);
  assert.equal(r.applied.length, 1);
  assert.equal(p.cleaning[0].credit_amount, undefined);
  assert.equal(p.laundry[0].credit_amount, 47.4);
});

test('the gaps name the override for the Remove action, and the read-failure notice is critical', () => {
  const p = pools([charge('08/14/2026', 275)]);
  netVendorCredits(p, [{ kind: 'cleaning', vendor: 'Cape Ann Elite', date: '08/14/2026', amount: 275, description: 'refund' }], 'ingest');
  const r = applyCreditOverrides(p, [override(), override({ id: '22222222-2222-4222-8222-222222222222', charge_date: '2026-08-15' })]);
  const gaps = creditOverrideGaps(r);
  assert.equal(gaps.length, 2);
  const types = gaps.map(g => g.gap_type).sort();
  assert.deepEqual(types, [CREDIT_OVERRIDE_COLLISION, CREDIT_OVERRIDE_UNAPPLIED]);
  for (const g of gaps) {
    assert.equal(g.severity, 'warning');
    assert.ok(overrideIdFromExpectedData(g.expected_data));
  }
  assert.equal(creditOverridesUnavailableGap('boom').severity, 'critical');
});

test('the auto-netted marker matches what vendor-credit-netting actually writes', () => {
  const p = pools([charge('08/14/2026', 275)]);
  netVendorCredits(p, [{ kind: 'cleaning', vendor: 'Cape Ann Elite', date: '08/14/2026', amount: 275, description: 'refund' }], 'bank re-upload');
  assert.ok(p.cleaning[0].credit_reason!.includes(AUTO_NETTED_MARKER));
  assert.ok(isAutoNettedReason(p.cleaning[0].credit_reason));
  assert.ok(!isAutoNettedReason('Duplicate charge'));
  assert.ok(!isAutoNettedReason(null));
});

test('source to family, bank dates, and the expected_data parser', () => {
  assert.equal(familyOfSource('matched'), 'cleaning');
  assert.equal(familyOfSource('bank'), 'cleaning');
  assert.equal(familyOfSource('corroborated'), 'cleaning');
  assert.equal(familyOfSource('bank-linen'), 'linen');
  assert.equal(familyOfSource('bank-laundry'), 'laundry');
  assert.equal(familyOfSource('invoice'), null);
  assert.equal(familyOfSource(null), null);
  assert.equal(bankDateToISO('8/7/2026'), '2026-08-07');
  assert.equal(bankDateToISO('nonsense'), '');
  assert.equal(overrideIdFromExpectedData('override:11111111-1111-4111-8111-111111111111'), '11111111-1111-4111-8111-111111111111');
  assert.equal(overrideIdFromExpectedData('reservation:HM123'), null);
});
