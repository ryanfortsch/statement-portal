/**
 * How a Guesty reservation status reaches `bookings` through the backfill.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mapGuestyStatus } from '../guesty-legacy-status.ts';

const today = '2026-09-21';

describe('mapGuestyStatus', () => {
  test('closed before arrival is a cancellation', () => {
    // The 3 Locust Booking.com placeholder booked 2025-08-28 for 10-16 to
    // 10-19, closed, with Rachel Lindas confirmed over its nights.
    assert.equal(mapGuestyStatus('closed', { checkIn: '2026-10-16', today }), 'cancelled');
    assert.equal(mapGuestyStatus('closed', { checkIn: '2026-09-22', today }), 'cancelled');
    assert.equal(mapGuestyStatus('Closed', { checkIn: '2027-06-30', today }), 'cancelled');
  });

  test('closed on or after the check-in date is not read either way', () => {
    assert.equal(mapGuestyStatus('closed', { checkIn: '2026-09-21', today }), null);
    // Robin Tellier's superseded codes and Carola Raggl's placeholders: real
    // stays retired as closed after the fact.
    assert.equal(mapGuestyStatus('closed', { checkIn: '2026-08-08', today }), null);
    assert.equal(mapGuestyStatus('closed', { checkIn: '2026-09-02', today }), null);
  });

  test('the other statuses do not depend on the date', () => {
    for (const checkIn of ['2026-08-18', '2026-09-21', '2026-10-16']) {
      const at = { checkIn, today };
      assert.equal(mapGuestyStatus('canceled', at), 'cancelled');
      assert.equal(mapGuestyStatus('cancelled', at), 'cancelled');
      assert.equal(mapGuestyStatus('declined', at), 'cancelled');
      assert.equal(mapGuestyStatus('expired', at), 'cancelled');
      assert.equal(mapGuestyStatus('inquiry', at), 'inquiry');
      assert.equal(mapGuestyStatus('pending', at), 'pending');
      assert.equal(mapGuestyStatus('completed', at), 'completed');
      assert.equal(mapGuestyStatus('reserved', at), 'confirmed');
      assert.equal(mapGuestyStatus('confirmed', at), 'confirmed');
      assert.equal(mapGuestyStatus('checked_in', at), null, 'unrecognised: Guesty did not tell us');
      assert.equal(mapGuestyStatus('', at), null);
      assert.equal(mapGuestyStatus(null, at), null);
    }
  });
});
