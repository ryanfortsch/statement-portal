import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDisputeAgreement, AGREEMENT_CANDIDATE_LIMIT } from '../dispute-agreement-match.ts';
import { stayEvidence } from '../dispute-packet-core.ts';
const stay = { propertyId: 'synthetic-home', guestName: 'Pat Guest', checkIn: '2027-06-01', checkOut: '2027-06-05' };
const original = { property_id: stay.propertyId, guest_name: 'Pat Guest', guest_signed_name: 'Pat Guest', guest_signed_at: '2026-11-13T00:00:00Z', voided_at: null, stay_start: stay.checkIn, stay_end: stay.checkOut };
test('one signed candidate matches without changing the source; harmless name spacing is accepted', () => {
  const candidate = { ...original, guest_name: ' PAT  Guest ' }; const before = structuredClone(candidate);
  assert.equal(selectDisputeAgreement([candidate], stay).agreement, candidate); assert.deepEqual(candidate, before);
});
test('another guest, signer, property or departure cannot supply the agreement', () => {
  for (const patch of [{ guest_name: 'Other Guest' }, { guest_signed_name: 'Other Guest' }, { property_id: 'other-home' }, { stay_end: '2027-06-06' }, { stay_start: '2027-06-02' }]) {
    assert.equal(selectDisputeAgreement([{ ...original, ...patch }], stay).agreement, null);
  }
});
test('newer unrelated signatures do not displace the matching candidate', () => {
  assert.equal(selectDisputeAgreement([{ ...original, guest_name: 'Someone Else' }, original], stay).agreement, original);
});
test('ambiguous and truncated results are withheld', () => {
  assert.equal(selectDisputeAgreement([original, { ...original }], stay).agreement, null);
  assert.equal(selectDisputeAgreement(Array(AGREEMENT_CANDIDATE_LIMIT).fill(original), stay).agreement, null);
});
test('draft, voided, invalid signature dates and missing stay identity are not accepted', () => {
  for (const patch of [{ guest_signed_at: null }, { guest_signed_at: 'invalid' }, { voided_at: '2026-11-13' }, { guest_signed_name: null }]) {
    assert.equal(selectDisputeAgreement([{ ...original, ...patch }], stay).agreement, null);
  }
  for (const patch of [{ guestName: null }, { checkIn: null }, { checkOut: null }]) assert.equal(selectDisputeAgreement([original], { ...stay, ...patch }).agreement, null);
});
test('a name/date candidate carries an explicit manual-verification gap in the packet', () => {
  const result = stayEvidence({ kind: 'credit_not_processed', checkIn: stay.checkIn, checkOut: stay.checkOut, bookedAt: null, reservationStatus: 'confirmed', housePolicy: null, review: null, cardholderName: null, guestName: stay.guestName, complaints: 0, threadComplete: true,
    agreement: { matchNeedsReview: true, signedAt: original.guest_signed_at, signedName: 'Pat Guest', countersignedAt: null, cancelCutoffDays: 30, cancelRefundPct: 50, voided: false, driveUrl: null } });
  assert.ok(result.gaps.some(gap => gap.includes('not a reservation link')));
});
