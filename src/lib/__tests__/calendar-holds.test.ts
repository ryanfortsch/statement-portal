import test from 'node:test';
import assert from 'node:assert/strict';
import { heldNightReason, isGuestyRuleArtifactUid, isRealHoldType } from '../calendar-holds.ts';

// Real uids from prod on 2026-09-15.
const AN_UID = '67a1355216416a00122e976f_an_2026-09-15_2026-09-15@guesty.com_dSFmAqMbOo6DOKnIrBELDssxIVs=';
const BD_UID = '668c635d25b8180012fd30b7_bd_2026-10-01_2028-09-15@guesty.com_3UYyl/HMwkjDuLv53sNEF58Dv58=';
const MANUAL_UID = '6aa80c13c5085e20b616f0e1@guesty.com_uMWAhN87Bx3COjWrPC6TUMVBKjA=';
const MANUAL_UID_DOUBLED = '6aa30eaa1aed6583692c8e12@guesty.com@guesty.com_uMWAhN87Bx3COjWrPC6TUMVBKjA=';

test('advance-notice and booking-window uids are rule artifacts', () => {
  assert.equal(isGuestyRuleArtifactUid(AN_UID), true);
  assert.equal(isGuestyRuleArtifactUid(BD_UID), true);
  assert.equal(isGuestyRuleArtifactUid('abc123_bw_2026-10-01_2028-09-15@guesty.com_x'), true);
});

test('a manual block uid carries no tag and is not an artifact', () => {
  assert.equal(isGuestyRuleArtifactUid(MANUAL_UID), false);
  assert.equal(isGuestyRuleArtifactUid(MANUAL_UID_DOUBLED), false);
});

test('no uid, an unknown tag, or a non-Guesty feed all fail closed (not an artifact)', () => {
  assert.equal(isGuestyRuleArtifactUid(null), false);
  assert.equal(isGuestyRuleArtifactUid(''), false);
  assert.equal(isGuestyRuleArtifactUid('abc123_zz_2026-09-15_2026-09-15@guesty.com_x'), false);
  assert.equal(isGuestyRuleArtifactUid('abc123_m_2026-09-15_2026-09-15@guesty.com_x'), false);
  assert.equal(isGuestyRuleArtifactUid('1234abcd@airbnb.com'), false);
});

test('real hold types are the deliberate ones only', () => {
  for (const t of ['m', 'o', 'sr', 'abl', 'pt']) assert.equal(isRealHoldType(t), true, t);
  for (const t of ['an', 'bw', 'bd', 'b', 'a', '', null, undefined]) assert.equal(isRealHoldType(t), false, String(t));
});

test('21 Horton 2026-09-15: advance-notice block + mirror unavailable with no ref is NOT held', () => {
  assert.equal(heldNightReason({ status: 'unavailable', block_type: null }, [{ ical_uid: AN_UID }]), null);
});

test('an open mirror day with no block rows is not held', () => {
  assert.equal(heldNightReason({ status: 'available', block_type: null }, []), null);
  assert.equal(heldNightReason({ status: 'available', block_type: null }, [{ ical_uid: BD_UID }]), null);
});

test('a manual hold in the mirror is held, and carries the typed note', () => {
  assert.equal(
    heldNightReason({ status: 'unavailable', block_type: 'm', block_note: 'Carpet Cleaning' }, []),
    'the calendar is blocked that night (Carpet Cleaning)',
  );
  assert.equal(heldNightReason({ status: 'unavailable', block_type: 'm', block_note: null }, []), 'the calendar is blocked that night');
});

test('an owner hold reads as the owner', () => {
  assert.equal(heldNightReason({ status: 'unavailable', block_type: 'o' }, []), 'the owner has the home that night');
});

test('a booked mirror day with no bookings row is held (a reservation the table missed)', () => {
  assert.equal(heldNightReason({ status: 'booked', block_type: null }, []), 'the Guesty calendar shows the night as booked');
});

test('an unknown mirror status fails closed', () => {
  assert.equal(heldNightReason({ status: 'reserved', block_type: null }, []), 'the Guesty calendar shows the night as reserved');
});

test('an untagged iCal block holds the night even when the mirror lags behind it', () => {
  assert.equal(heldNightReason({ status: 'available', block_type: null }, [{ ical_uid: MANUAL_UID }]), 'the calendar is blocked that night');
  assert.equal(heldNightReason({ status: 'unavailable', block_type: null }, [{ ical_uid: AN_UID }, { ical_uid: MANUAL_UID }]), 'the calendar is blocked that night');
});

test('no mirror row: the iCal rows decide, artifacts discounted', () => {
  assert.equal(heldNightReason(null, [{ ical_uid: AN_UID }]), null);
  assert.equal(heldNightReason(undefined, [{ ical_uid: BD_UID }]), null);
  assert.equal(heldNightReason(null, []), null);
  assert.equal(heldNightReason(null, [{ ical_uid: MANUAL_UID }]), 'the calendar is blocked that night');
  assert.equal(heldNightReason(null, [{ ical_uid: null }]), 'the calendar is blocked that night');
});
