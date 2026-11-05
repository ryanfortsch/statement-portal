import test from 'node:test';
import assert from 'node:assert/strict';
import {
  disputeKind,
  flagThread,
  folioLines,
  itemWords,
  money,
  parseOtherPayments,
  PLAYBOOK,
  reconcileOtherMeans,
  type ReconcileInput,
} from '../dispute-packet-core.ts';

test('disputeKind tells paid-by-other-means from a true duplicate by the network code', () => {
  assert.equal(disputeKind('duplicate', '12.6.2'), 'paid_by_other_means');
  assert.equal(disputeKind('duplicate', '12.6.1'), 'duplicate');
  assert.equal(disputeKind('duplicate', null), 'duplicate');
  assert.equal(disputeKind('credit_not_processed', 'C18'), 'credit_not_processed');
  assert.equal(disputeKind('product_unacceptable', 'C31'), 'not_as_described');
  assert.equal(disputeKind('product_not_received', '13.1'), 'not_received');
  assert.equal(disputeKind('fraudulent', '10.4'), 'fraud');
  assert.equal(disputeKind('unrecognized', null), 'fraud');
  assert.equal(disputeKind('general', null), 'general');
  assert.equal(disputeKind(null, null), 'general');
});

test('every playbook says what the bank asks and what to send', () => {
  for (const [kind, p] of Object.entries(PLAYBOOK)) {
    assert.equal(p.kind, kind);
    assert.ok(p.bankAsks.length > 10, kind);
    assert.ok(p.items.length >= 2, kind);
    assert.ok(p.items.every((i) => !i.proves.includes('—')), `${kind}: no em dashes`);
  }
  assert.ok(PLAYBOOK.paid_by_other_means.items.some((i) => i.key === 'reconciliation'));
});

// The shape of the 2026 dock fee dispute, every figure made up: a cashier's
// check that paid the stay, and a separate dock fee charged by card, with
// the tax a link added to a tax-inclusive price refunded.
const dockFee = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
  folio: [
    { label: 'Lodging', cents: 1_000_000 },
    { label: 'Cleaning', cents: 40_000 },
    { label: 'Occupancy tax', cents: 200_000 },
  ],
  payments: [{ method: 'cashiers_check', cents: 1_240_000, date: '2026-07-08', reference: null }],
  disputed: {
    amountCents: 71_488,
    disputedCents: 64_000,
    refunds: [{ cents: 7_488, date: '2026-09-06', note: 'Correction of payment-link calculation error' }],
    chargedOn: '2026-09-01',
    item: 'Boat docking fee',
    isAddOn: true,
  },
  ...over,
});

test('a check that pays the folio to the cent makes a separate add-on strong', () => {
  const r = reconcileOtherMeans(dockFee());
  assert.equal(r.folioCents, 1_240_000);
  assert.equal(r.otherPaidCents, 1_240_000);
  assert.equal(r.stayOwedCents, 0);
  assert.equal(r.chargeNetCents, 64_000);
  assert.equal(r.strength, 'strong');
  assert.match(r.forBank[0], /\$12,400\.00/);
  assert.match(r.forBank[0], /cashier's check on 2026-07-08/);
  assert.match(r.forBank[1], /Boat docking fee, which is not a line on the folio/);
  assert.equal(r.rows.at(-1)?.cents, 64_000);
});

test('a refund on the disputed charge is explained to the bank and flagged to the operator', () => {
  const r = reconcileOtherMeans(dockFee());
  assert.ok(r.forBank.some((s) => /\$74\.88 on 2026-09-06/.test(s) && /not a partial payment/.test(s)));
  assert.ok(r.gaps.some((g) => /reads to a bank as a refund we promised/.test(g)));
  // The dispute amount matches the charge net of the refund, so no mismatch gap.
  assert.ok(!r.gaps.some((g) => /Check which amount/.test(g)));
});

test('a stay the other payments did not cover is weak: the charge reads as the balance', () => {
  const r = reconcileOtherMeans(dockFee({ payments: [{ method: 'check', cents: 1_200_000, date: '2026-07-08' }] }));
  assert.equal(r.stayOwedCents, 40_000);
  assert.equal(r.strength, 'weak');
  assert.ok(r.gaps.some((g) => /fall \$400\.00 short/.test(g)));
});

test('a guest who paid more than the folio by other means may really be owed a refund', () => {
  const r = reconcileOtherMeans(dockFee({ payments: [{ method: 'wire', cents: 1_400_000, date: '2026-07-08' }] }));
  assert.equal(r.strength, 'weak');
  assert.ok(r.gaps.some((g) => /a refund is owed and the dispute should be accepted/.test(g)));
});

test('a charge Helm did not mint as an add-on is arguable, not strong', () => {
  const r = reconcileOtherMeans(dockFee({ disputed: { ...dockFee().disputed, isAddOn: false } }));
  assert.equal(r.strength, 'arguable');
  assert.ok(r.gaps.some((g) => /not marked as an add-on/.test(g)));
});

test('no folio or no other payment is named as the gap, never guessed', () => {
  const r = reconcileOtherMeans(dockFee({ folio: [], payments: [] }));
  assert.equal(r.strength, 'weak');
  assert.ok(r.gaps.some((g) => /No folio found/.test(g)));
  assert.ok(r.gaps.some((g) => /No other payment recorded/.test(g)));
});

test('money formats cents with grouping', () => {
  assert.equal(money(1_240_000), '$12,400.00');
  assert.equal(money(7_488), '$74.88');
  assert.equal(money(-500), '-$5.00');
});

test('folioLines reads Guesty invoice items in cents and names a nameless tax line', () => {
  const lines = folioLines([
    { title: 'Accommodation fare', amount: 13000, type: 'ACCOMMODATION_FARE' },
    { title: 'Cleaning fee', amount: '500.00', type: 'CLEANING_FEE' },
    { amount: 1755.5, type: 'TAX' },
    { title: 'Zero line', amount: 0 },
    { title: 'Junk', amount: 'n/a' },
  ]);
  assert.deepEqual(lines, [
    { label: 'Accommodation fare', cents: 1_300_000 },
    { label: 'Cleaning fee', cents: 50_000 },
    { label: 'Tax', cents: 175_550 },
  ]);
  assert.deepEqual(folioLines(null), []);
});

test("parseOtherPayments reads typed lines and reports the ones it cannot", () => {
  const { payments, errors } = parseOtherPayments(
    "Cashier's check, $12,400.00, 2026-07-08, First Bank #1001\nwire, 200, , ref 9\nvenmo, 50, 2026-07-01\ncheck, abc, 2026-07-01\n\n",
  );
  assert.deepEqual(payments, [
    { method: 'cashiers_check', cents: 1_240_000, date: '2026-07-08', reference: 'First Bank #1001' },
    { method: 'wire', cents: 20_000, date: null, reference: 'ref 9' },
  ]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /venmo/);
  assert.match(errors[1], /not a number/);
});

test('itemWords keeps what the charge was for and drops the guest and filler', () => {
  const w = itemWords('Boat docking fee - Pat Guest - Stay at Example Cove - $640.00 + $74.88 occupancy tax (11.7%)', 'Pat Guest');
  assert.deepEqual(w.sort(), ['boat', 'dock', 'docking']);
});

test('flagThread marks the written agreement and every refund mention', () => {
  const flagged = flagThread(
    [
      { at: '2026-08-30T15:00:00Z', who: 'host', body: 'Docks are $40/day, so $640.00 total including tax.' },
      { at: '2026-08-30T16:00:00Z', who: 'guest', body: 'Sounds good, thanks for the price agreement for the docks' },
      { at: '2026-09-02T10:00:00Z', who: 'guest', body: 'The link charged 714.88, can you refund the extra?' },
      { at: '2026-09-03T10:00:00Z', who: 'guest', body: 'Towels please' },
      { at: '2026-09-03T11:00:00Z', who: 'host', body: 'Room 6401 is ready' },
    ],
    { item: 'Boat docking fee - Pat Guest', guestName: 'Pat Guest', amountsCents: [64_000, 71_488] },
  );
  assert.deepEqual(flagged.map((f) => f.aboutCharge), [true, true, true, false, false]);
  assert.deepEqual(flagged.map((f) => f.mentionsRefund), [false, false, true, false, false]);
});

test('an unread dispute raises no amount gap against a figure nobody has seen', () => {
  const base = dockFee();
  const r = reconcileOtherMeans({ ...base, disputed: { ...base.disputed, disputedCents: null } });
  assert.ok(!r.gaps.some((g) => g.includes('The bank is disputing')));
  const read = reconcileOtherMeans({ ...base, disputed: { ...base.disputed, disputedCents: 71_488 } });
  assert.ok(read.gaps.some((g) => g.includes('The bank is disputing $714.88')));
});
