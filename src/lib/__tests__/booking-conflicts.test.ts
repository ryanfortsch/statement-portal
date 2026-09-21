/**
 * What counts as a double-booking. Fixtures are real rows from the
 * `bookings` table on 2026-09-21: the 20 Hammond stay with Guesty's
 * advance-notice block on its last night, the 20 Enon owner stay with its
 * matching manual block, and the 3 Locust Booking.com / VRBO overlap.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findDoubleBookings,
  isStayStatus,
  overlapNights,
  STAY_STATUSES,
  type ConflictRow,
} from '../booking-conflicts.ts';

type Row = ConflictRow & { guest_name: string | null; channel: string };

function row(over: Partial<Row> & { id: string }): Row {
  return {
    property_id: '20_hammond',
    status: 'confirmed',
    check_in: '2026-09-19',
    check_out: '2026-09-22',
    guest_name: null,
    channel: 'airbnb',
    ...over,
  };
}

const pairIds = (rows: Row[]) =>
  findDoubleBookings(rows).map((c) => `${c.property_id}:${c.a.id}+${c.b.id}=${c.overlap_nights}`);

describe('STAY_STATUSES', () => {
  test('matches TURNOVER_STATUSES in operations.ts: confirmed and completed only', () => {
    assert.deepEqual([...STAY_STATUSES], ['confirmed', 'completed']);
    assert.equal(isStayStatus('confirmed'), true);
    assert.equal(isStayStatus('completed'), true);
    for (const s of ['inquiry', 'pending', 'cancelled', 'block', '', null, undefined]) {
      assert.equal(isStayStatus(s), false, `${String(s)} is not a stay`);
    }
  });
});

describe('overlapNights', () => {
  test('counts the nights two ranges share', () => {
    const a = { check_in: '2026-10-13', check_out: '2026-10-18' };
    assert.equal(overlapNights(a, { check_in: '2026-10-16', check_out: '2026-10-19' }), 2);
    assert.equal(overlapNights(a, a), 5);
    // Nested: the inner stay's own length.
    assert.equal(overlapNights(a, { check_in: '2026-10-14', check_out: '2026-10-15' }), 1);
    // Symmetric.
    assert.equal(overlapNights({ check_in: '2026-10-16', check_out: '2026-10-19' }, a), 2);
  });

  test('a same-day turnover shares no night', () => {
    const a = { check_in: '2026-10-13', check_out: '2026-10-18' };
    assert.equal(overlapNights(a, { check_in: '2026-10-18', check_out: '2026-10-20' }), 0);
    assert.equal(overlapNights(a, { check_in: '2026-10-20', check_out: '2026-10-22' }), 0);
  });
});

describe('findDoubleBookings', () => {
  test('two confirmed stays sharing nights on one property are a double-booking, earlier check-in first', () => {
    const rows = [
      row({ id: 'bc', property_id: '3_locust', channel: 'booking_com', check_in: '2026-10-16', check_out: '2026-10-19', guest_name: 'Guest to be announced' }),
      row({ id: 'vrbo', property_id: '3_locust', channel: 'vrbo', check_in: '2026-10-13', check_out: '2026-10-18', guest_name: 'Rachel Lindas' }),
    ];
    const found = findDoubleBookings(rows);
    assert.equal(found.length, 1);
    assert.equal(found[0].property_id, '3_locust');
    assert.equal(found[0].a.id, 'vrbo');
    assert.equal(found[0].b.id, 'bc');
    assert.equal(found[0].overlap_nights, 2);
    // The caller's row type comes back whole.
    assert.equal(found[0].a.guest_name, 'Rachel Lindas');
  });

  test('a block over a confirmed stay is not a double-booking', () => {
    // Guesty's advance-notice artifact: TONIGHT as a one-night block on the
    // stay's last night. The block is the stay.
    const hammond = [
      row({ id: 'ashley', guest_name: 'Ashley Dobransky' }),
      row({ id: 'an-block', status: 'block', channel: 'block', check_in: '2026-09-21', check_out: '2026-09-22' }),
    ];
    assert.deepEqual(pairIds(hammond), []);
    // The owner's own stay, entered as a direct booking, and the manual
    // block placed for the same dates.
    const enon = [
      row({ id: 'snyder', property_id: '20_enon', channel: 'direct', check_in: '2027-05-25', check_out: '2027-06-28', guest_name: 'Kathleen Snyder' }),
      row({ id: 'hold', property_id: '20_enon', status: 'block', channel: 'block', check_in: '2027-05-25', check_out: '2027-06-28' }),
    ];
    assert.deepEqual(pairIds(enon), []);
    // Two blocks are not two guests either.
    assert.deepEqual(pairIds([enon[1], row({ id: 'hold-2', property_id: '20_enon', status: 'block', check_in: '2027-06-01', check_out: '2027-06-03' })]), []);
  });

  test('inquiries and pending requests are not parties, in any combination', () => {
    const rows = [
      row({ id: 'stay', guest_name: 'Ashley Dobransky' }),
      row({ id: 'inq-1', status: 'inquiry', channel: 'direct', check_in: '2026-09-20', check_out: '2026-09-23' }),
      row({ id: 'inq-2', status: 'inquiry', channel: 'direct', check_in: '2026-09-20', check_out: '2026-09-23' }),
      row({ id: 'pend', status: 'pending', channel: 'vrbo', check_in: '2026-09-18', check_out: '2026-09-20' }),
    ];
    assert.deepEqual(pairIds(rows), []);
  });

  test('cancelled rows are gone', () => {
    const rows = [
      row({ id: 'kept', guest_name: 'Ashley Dobransky' }),
      row({ id: 'gone', status: 'cancelled', guest_name: 'Lauren Foy' }),
    ];
    assert.deepEqual(pairIds(rows), []);
  });

  test('a completed stay still counts against a confirmed one', () => {
    const rows = [
      row({ id: 'done', status: 'completed', check_in: '2026-09-15', check_out: '2026-09-20' }),
      row({ id: 'next', check_in: '2026-09-19', check_out: '2026-09-22' }),
    ];
    assert.deepEqual(pairIds(rows), ['20_hammond:done+next=1']);
  });

  test('a same-day turnover is not an overlap', () => {
    const rows = [
      row({ id: 'first', check_in: '2026-09-15', check_out: '2026-09-19' }),
      row({ id: 'second', check_in: '2026-09-19', check_out: '2026-09-22' }),
    ];
    assert.deepEqual(pairIds(rows), []);
  });

  test('stays on different properties never conflict', () => {
    const rows = [
      row({ id: 'hammond' }),
      row({ id: 'horton', property_id: '21_horton' }),
    ];
    assert.deepEqual(pairIds(rows), []);
  });

  test('a row with no nights is not a stay', () => {
    const rows = [
      row({ id: 'stay' }),
      row({ id: 'zero', check_in: '2026-09-20', check_out: '2026-09-20' }),
      row({ id: 'backwards', check_in: '2026-09-21', check_out: '2026-09-20' }),
    ];
    assert.deepEqual(pairIds(rows), []);
  });

  test('three stays on the same nights report every pair', () => {
    const rows = [
      row({ id: 'a', property_id: '53_rocky_neck', check_in: '2026-11-25', check_out: '2026-11-28' }),
      row({ id: 'b', property_id: '53_rocky_neck', check_in: '2026-11-25', check_out: '2026-11-28' }),
      row({ id: 'c', property_id: '53_rocky_neck', check_in: '2026-11-26', check_out: '2026-11-27' }),
    ];
    assert.deepEqual(pairIds(rows), [
      '53_rocky_neck:a+b=3',
      '53_rocky_neck:a+c=1',
      '53_rocky_neck:b+c=1',
    ]);
  });

  test('output does not depend on input order', () => {
    const rows = [
      row({ id: 'h-late', check_in: '2026-09-21', check_out: '2026-09-24' }),
      row({ id: 'h-early' }),
      row({ id: 'l-bc', property_id: '3_locust', check_in: '2026-10-16', check_out: '2026-10-19' }),
      row({ id: 'l-vrbo', property_id: '3_locust', check_in: '2026-10-13', check_out: '2026-10-18' }),
      row({ id: 'l-inq', property_id: '3_locust', status: 'inquiry', check_in: '2026-10-13', check_out: '2026-10-18' }),
    ];
    const expected = ['20_hammond:h-early+h-late=1', '3_locust:l-vrbo+l-bc=2'];
    assert.deepEqual(pairIds(rows), expected);
    assert.deepEqual(pairIds([...rows].reverse()), expected);
    assert.deepEqual(pairIds([rows[2], rows[4], rows[0], rows[3], rows[1]]), expected);
  });
});
