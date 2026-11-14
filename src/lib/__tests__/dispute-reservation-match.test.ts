import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDisputeReservation } from '../dispute-reservation-match.ts';

const stay = { guesty_reservation_id: 'synthetic-reservation', confirmation_code: 'SYNTHETIC', guest_name: 'Pat Guest' };

test('one successful reservation lookup preserves the complete evidence source', () => {
  const before = structuredClone(stay);
  assert.deepEqual(selectDisputeReservation([stay], false), { reservation: stay, issue: null });
  assert.deepEqual(stay, before);
});

test('duplicate reservation IDs or confirmation codes never select the first record', () => {
  for (const other of [{ ...stay, guest_name: 'Other Guest' }, { ...stay, guesty_reservation_id: 'other-reservation' }]) {
    for (const rows of [[stay, other], [other, stay]]) {
      const result = selectDisputeReservation(rows, false);
      assert.equal(result.reservation, null);
      assert.match(result.issue!, /multiple synced records/);
    }
  }
});

test('a failed lookup cannot contribute partial returned data to the packet', () => {
  const result = selectDisputeReservation([stay], true);
  assert.equal(result.reservation, null);
  assert.match(result.issue!, /lookup failed/);
});

test('missing rows and unusable reservation IDs explain why stay evidence is withheld', () => {
  assert.match(selectDisputeReservation([], false).issue!, /no synced Guesty row/);
  for (const id of [null, undefined, '', '  ']) {
    const result = selectDisputeReservation([{ ...stay, guesty_reservation_id: id }], false);
    assert.equal(result.reservation, null);
    assert.match(result.issue!, /no reservation ID/);
  }
});
