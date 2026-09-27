import test from 'node:test';
import assert from 'node:assert/strict';

import {
  indexStaysByPhone,
  stayWhen,
  guestStayLabel,
  type StayRow,
} from '../unknown-number-guests.ts';

const TODAY = '2026-09-27';

function stay(over: Partial<StayRow> = {}): StayRow {
  return {
    id: 'b1',
    property_id: '17_beach_rd',
    guest_name: 'Beth Dowling',
    guest_phone: '+15132373314',
    check_in: '2026-09-27',
    check_out: '2026-10-01',
    status: 'confirmed',
    duplicate_of: null,
    ...over,
  };
}

test('a guest arriving today is found by any phone spelling', () => {
  for (const spelling of ['+15132373314', '(513) 237-3314', '513-237-3314', '5132373314']) {
    const idx = indexStaysByPhone([stay({ guest_phone: spelling })], TODAY);
    assert.equal(idx['5132373314']?.guestName, 'Beth Dowling');
    assert.equal(idx['5132373314']?.when, 'arriving');
  }
});

test('a guest leaving today still counts as in-house', () => {
  assert.equal(stayWhen({ check_in: '2026-09-22', check_out: TODAY }, TODAY), 'in-house');
  assert.equal(stayWhen({ check_in: '2026-09-22', check_out: '2026-09-26' }, TODAY), 'departed');
  assert.equal(stayWhen({ check_in: '2026-10-04', check_out: '2026-10-08' }, TODAY), 'upcoming');
});

test('duplicate, cancelled and placeholder-named rows never name a card', () => {
  // bookings holds one row per source by design; only the canonical row counts.
  assert.deepEqual(indexStaysByPhone([stay({ duplicate_of: 'b0' })], TODAY), {});
  assert.deepEqual(indexStaysByPhone([stay({ status: 'cancelled' })], TODAY), {});
  assert.deepEqual(indexStaysByPhone([stay({ guest_name: 'Reservation HMEFDNMS4Z' })], TODAY), {});
  assert.deepEqual(indexStaysByPhone([stay({ guest_name: null })], TODAY), {});
  assert.deepEqual(indexStaysByPhone([stay({ guest_phone: null })], TODAY), {});
});

test('the stay they are in beats a future one, which beats a past one', () => {
  const past = stay({ id: 'past', check_in: '2026-09-10', check_out: '2026-09-14' });
  const future = stay({ id: 'future', check_in: '2026-10-20', check_out: '2026-10-24' });
  const now = stay({ id: 'now', check_in: '2026-09-25', check_out: '2026-09-29' });

  assert.equal(indexStaysByPhone([past, future, now], TODAY)['5132373314'].bookingId, 'now');
  assert.equal(indexStaysByPhone([past, future], TODAY)['5132373314'].bookingId, 'future');
  assert.equal(indexStaysByPhone([past], TODAY)['5132373314'].bookingId, 'past');
});

test('within a tier the stay nearest today wins', () => {
  const soon = stay({ id: 'soon', check_in: '2026-09-30', check_out: '2026-10-02' });
  const later = stay({ id: 'later', check_in: '2026-11-15', check_out: '2026-11-18' });
  assert.equal(indexStaysByPhone([later, soon], TODAY)['5132373314'].bookingId, 'soon');
});

test('two guests keep their own numbers', () => {
  const other = stay({ id: 'b2', guest_name: 'Sam Reyes', guest_phone: '(978) 555-0101' });
  const idx = indexStaysByPhone([stay(), other], TODAY);
  assert.equal(idx['5132373314'].guestName, 'Beth Dowling');
  assert.equal(idx['9785550101'].guestName, 'Sam Reyes');
});

test('the badge names the guest, the property and when', () => {
  const idx = indexStaysByPhone([stay()], TODAY);
  assert.equal(guestStayLabel(idx['5132373314'], '17 Beach'), 'Beth Dowling · 17 Beach · arriving today');
  // An unmapped property degrades to the name alone rather than printing an id.
  assert.equal(guestStayLabel(idx['5132373314'], null), 'Beth Dowling · arriving today');
});
