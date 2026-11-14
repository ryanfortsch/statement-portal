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

// --- stay evidence (2026-11-06) ---------------------------------------------

import {
  agreementCancellationWords,
  stayEvidence,
  stayHintsFromDescription,
  type StayEvidenceInput,
} from '../dispute-packet-core.ts';

test('a charge description names its stay by confirmation code or by date range', () => {
  assert.deepEqual(stayHintsFromDescription('HA-Ou0mq08'), { confirmationCode: 'HA-Ou0mq08', checkIn: null, checkOut: null });
  assert.deepEqual(stayHintsFromDescription('Stay at Rocky Neck - 2026-08-28 to 2026-09-04'), {
    confirmationCode: null,
    checkIn: '2026-08-28',
    checkOut: '2026-09-04',
  });
  assert.equal(stayHintsFromDescription('HMABCD1234 reservation').confirmationCode, 'HMABCD1234');
  assert.deepEqual(stayHintsFromDescription(null), { confirmationCode: null, checkIn: null, checkOut: null });
  assert.equal(stayHintsFromDescription('Pet fee').confirmationCode, null);
});

test('flagThread marks a complaint only on the guest side', () => {
  const lines = [
    { at: '2026-09-01T10:00:00Z', who: 'Guest A', body: 'The shower is broken and the kitchen is dirty' },
    { at: '2026-09-01T10:05:00Z', who: 'Rising Tide', body: 'So sorry it is broken, a plumber is on the way' },
    { at: '2026-09-01T11:00:00Z', who: 'Guest A', body: 'Lovely house, thank you!' },
  ];
  const f = flagThread(lines, { item: 'stay', amountsCents: [], guestWho: 'Guest A' });
  assert.deepEqual(
    f.map((l) => l.complaint),
    [true, false, false],
  );
});

const base: StayEvidenceInput = {
  kind: 'credit_not_processed',
  checkIn: '2026-08-28',
  checkOut: '2026-09-04',
  bookedAt: '2026-05-01T14:00:00Z',
  reservationStatus: 'confirmed',
  housePolicy: 'Full refund up to 30 days before arrival.',
  agreement: null,
  review: null,
  cardholderName: 'Pat Guest',
  guestName: 'Pat Guest',
  complaints: 0,
  threadComplete: true,
};

const signed = {
  signedAt: '2026-05-02T12:00:00Z',
  signedName: 'Pat Guest',
  countersignedAt: '2026-05-03T12:00:00Z',
  cancelCutoffDays: 30,
  cancelRefundPct: 50,
  voided: false,
  driveUrl: null,
};

test('a cancellation dispute leans on the signed agreement, and still asks for the cancel date', () => {
  const ev = stayEvidence({ ...base, agreement: signed });
  assert.ok(ev.forBank.some((s) => s.includes('signed our rental agreement on 2026-05-02')));
  assert.ok(ev.forBank.some((s) => s.includes('50% refund when cancelled more than 30 days')));
  assert.ok(ev.gaps.some((g) => g.includes('day the guest cancelled')));
  assert.ok(ev.rows.some((r) => r.label === 'Booked' && r.value.includes('119 days before check-in')));
});

test('with no agreement, the house policy shows but the bank sentence is a gap', () => {
  const ev = stayEvidence(base);
  assert.equal(ev.forBank.length, 0);
  assert.ok(ev.rows.some((r) => r.label === "The home's cancellation policy"));
  assert.ok(ev.gaps.some((g) => g.includes('No signed agreement')));
});

test('a voided agreement is never cited', () => {
  const ev = stayEvidence({ ...base, agreement: { ...signed, voided: true } });
  assert.equal(ev.forBank.length, 0);
  assert.ok(ev.rows.some((r) => r.label === 'Rental agreement' && r.value === 'Voided'));
});

test('strict no-refund agreements read as such', () => {
  assert.equal(agreementCancellationWords({ ...signed, cancelCutoffDays: null }), 'no refund on cancellation');
});

test('not as described: a full stay and a good review go to the bank; complaints are gaps', () => {
  const good = stayEvidence({ ...base, kind: 'not_as_described', review: { rating: 5, at: '2026-09-06', text: null } });
  assert.ok(good.forBank.some((s) => s.includes('confirmed for its full dates')));
  assert.ok(!good.forBank.some((s) => /stayed the full|leaving early/.test(s)), 'Helm never claims what it cannot see');
  assert.ok(good.gaps.some((g) => g.includes('Confirm the guest stayed')));
  assert.ok(good.forBank.some((s) => s.includes('5 of 5')));
  assert.ok(good.forBank.some((s) => s.includes('raised no complaint')));

  const bad = stayEvidence({ ...base, kind: 'not_as_described', review: { rating: 2, at: null, text: null }, complaints: 3 });
  assert.ok(!bad.forBank.some((s) => s.includes('raised no complaint')));
  assert.ok(bad.gaps.some((g) => g.includes('3 guest messages raise a complaint')));
  assert.ok(bad.gaps.some((g) => g.includes('rates the stay 2 of 5')));
});

test('a cancelled reservation never claims the stay was provided', () => {
  const ev = stayEvidence({ ...base, kind: 'not_received', reservationStatus: 'canceled' });
  assert.equal(ev.forBank.length, 0);
  assert.ok(ev.gaps.some((g) => g.includes('cancelled')));
});

test('fraud: the cardholder is the guest, or the mismatch is a gap', () => {
  const same = stayEvidence({ ...base, kind: 'fraud' });
  assert.ok(same.forBank.some((s) => s.includes('is the guest named on the booking')));
  const other = stayEvidence({ ...base, kind: 'fraud', cardholderName: 'Someone Else' });
  assert.equal(other.forBank.length, 0);
  assert.ok(other.gaps.some((g) => g.includes('not the booking guest')));
});

test('a guest asking for a refund over safety is a complaint, so "no complaint" is never claimed', () => {
  const msg =
    'I found the exterior window in the garage unsecure and could not latch it. I am uncomfortable lodging here. I am requesting a full refund.';
  const [f] = flagThread([{ at: '2026-10-09T21:12:00Z', who: 'G', body: msg }], { item: 'HA-x', amountsCents: [], guestWho: 'G' });
  assert.equal(f.complaint, true);
  for (const body of ['The door won\'t lock', 'Can we get our money back?', 'This is not secure']) {
    assert.equal(flagThread([{ at: 'x', who: 'G', body }], { item: 'x', amountsCents: [], guestWho: 'G' })[0].complaint, true, body);
  }
});

test('an incomplete thread never yields "no complaint"', () => {
  const ev = stayEvidence({ ...base, kind: 'not_as_described', threadComplete: false });
  assert.ok(!ev.forBank.some((s) => s.includes('raised no complaint')));
  assert.ok(ev.gaps.some((g) => g.includes('not complete')));
});

// --- proof the stay happened (2026-11-06) -----------------------------------

import { codeFitsGuest, guestEntriesForStay, stayProofEvidence, type StayProof } from '../dispute-packet-core.ts';

const proof = (over: Partial<StayProof> = {}): StayProof => ({
  monitored: true,
  guestName: 'Pat Guest',
  entries: [
    // 8:12 PM ET on Oct 9 is Oct 10 in UTC: still the 9th for the stay.
    { at: '2026-10-10T00:12:00Z', codeName: 'October Guest Code' },
    { at: '2026-10-11T14:00:00Z', codeName: 'Pat Guest' },
    // another guest's leftover code, inside the dates: never counted
    { at: '2026-10-11T15:00:00Z', codeName: 'Robin Other' },
    // the stay before: outside the dates
    { at: '2026-10-05T15:00:00Z', codeName: 'Guest' },
  ],
  cleaning: { enteredAt: '2026-10-13T15:05:00Z', entrySource: 'seam_lock', finishedAt: '2026-10-13T18:00:00Z', finishSource: 'estimate' },
  ...over,
});

test('a guest code fits a generic guest code or the guest by name, never another guest', () => {
  assert.ok(codeFitsGuest('November Guest Code', 'Pat Guest'));
  assert.ok(codeFitsGuest(null, 'Pat Guest'));
  assert.ok(codeFitsGuest('Pat', 'Pat Guest'));
  assert.ok(!codeFitsGuest('Robin Other', 'Pat Guest'));
});

test("the stay's entries are read on Eastern dates, oldest first", () => {
  const p = proof();
  const mine = guestEntriesForStay(p.entries, '2026-10-09', '2026-10-13', p.guestName);
  assert.deepEqual(mine.map((e) => e.at), ['2026-10-10T00:12:00Z', '2026-10-11T14:00:00Z']);
});

test('door use and the turnover entry go to the bank; an estimated finish never does', () => {
  const ev = stayProofEvidence(proof(), '2026-10-09', '2026-10-13');
  assert.ok(ev.guestUsedCode);
  assert.ok(ev.forBank.some((s) => s.includes('used 2 times, first on Oct 9 at 8:12 PM and last on Oct 11 at 10:00 AM')));
  assert.ok(ev.forBank.some((s) => s.includes("cleaner's code opened the door on Oct 13 at 11:05 AM")));
  assert.ok(!ev.forBank.some((s) => /left|departed|checked out at/.test(s)), 'a last code use is not a departure');
  const est = stayProofEvidence(proof({ cleaning: { enteredAt: null, entrySource: null, finishedAt: '2026-10-13T18:00:00Z', finishSource: 'estimate' } }), '2026-10-09', '2026-10-13');
  assert.ok(!est.rows.some((r) => r.label === 'Turnover after checkout'));
});

test('no lock, or no guest entry, is a gap and never a claim', () => {
  const none = stayProofEvidence(proof({ monitored: false, entries: [] }), '2026-10-09', '2026-10-13');
  assert.equal(none.guestUsedCode, false);
  assert.ok(none.gaps.some((g) => g.includes('no smart lock')));
  const quiet = stayProofEvidence(proof({ entries: [] }), '2026-10-09', '2026-10-13');
  assert.ok(quiet.gaps.some((g) => g.includes('no entry with this guest')));
  assert.ok(!quiet.forBank.some((s) => s.includes('door code')));
});

test('stay evidence swaps the "confirm the guest stayed" gap for the lock record', () => {
  const ev = stayEvidence({ ...base, kind: 'not_received', checkIn: '2026-10-09', checkOut: '2026-10-13', proof: proof() });
  assert.ok(ev.forBank.some((s) => s.includes("guest's door code")));
  assert.ok(!ev.gaps.some((g) => g.includes('Attach arrival proof')));
  assert.ok(ev.rows.some((r) => r.label === 'Guest door code'));
  const without = stayEvidence({ ...base, kind: 'not_received' });
  assert.ok(without.gaps.some((g) => g.includes('Attach arrival proof')));
});


test('a signature cannot establish refund entitlement without the cancellation timeline', () => {
  for (const reservationStatus of ['confirmed', 'cancelled']) {
    const ev = stayEvidence({ ...base, reservationStatus, agreement: signed });
    assert.ok(ev.forBank.some((sentence) => sentence.includes('50% refund')));
    assert.ok(ev.forBank.every((sentence) => !sentence.includes('is not owed')));
    assert.ok(ev.gaps.some((gap) => gap.includes('refund promise') && gap.includes('refunds already processed')));
  }
});
