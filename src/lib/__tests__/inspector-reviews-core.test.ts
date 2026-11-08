/**
 * An inspector's guest rating, the rules (docs/cleaning-reviews.md): which
 * stay a walk prepped, and one review per stay however many walks touched it.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { collectInspectorReviews, matchWalksToStays, summarizeRatings, NEXT_STAY_DAYS, type StayLite } from '../inspector-reviews-core.ts';

const stays: StayLite[] = [
  { id: 'b1', property_id: '21_horton', check_in: '2026-11-01', external_booking_id: 'r1' },
  { id: 'b2', property_id: '21_horton', check_in: '2026-11-07', external_booking_id: 'r2' },
  { id: 'b3', property_id: '21_horton', check_in: '2026-11-30', external_booking_id: 'r3' },
  { id: 'b4', property_id: '3_south', check_in: '2026-11-06', external_booking_id: null },
];

describe('which stay a walk prepped', () => {
  test('the packet stop\'s booking wins where the walk was a Field stop', () => {
    const m = matchWalksToStays(
      [{ id: 'w1', property_id: '21_horton', completed_at: '2026-11-06T18:00:00Z', walkDate: '2026-11-06' }],
      new Map([['w1', 'b1']]),
      stays,
    );
    assert.equal(m.get('w1'), 'b1');
  });

  test('else the next check-in at the home on or after the walk day', () => {
    const m = matchWalksToStays(
      [{ id: 'w1', property_id: '21_horton', completed_at: '2026-11-06T18:00:00Z', walkDate: '2026-11-06' }],
      new Map(),
      stays,
    );
    assert.equal(m.get('w1'), 'b2');
  });

  test('a check-in past the window is not the stay this walk prepped', () => {
    const m = matchWalksToStays(
      [{ id: 'w1', property_id: '21_horton', completed_at: '2026-11-10T18:00:00Z', walkDate: '2026-11-10' }],
      new Map(),
      stays,
    );
    assert.equal(m.has('w1'), false, `b3 is ${NEXT_STAY_DAYS}+ days out`);
  });

  test('a walk the same day as the check-in counts; another home\'s stay never does', () => {
    const m = matchWalksToStays(
      [
        { id: 'w1', property_id: '21_horton', completed_at: '2026-11-07T14:00:00Z', walkDate: '2026-11-07' },
        { id: 'w2', property_id: '17_beach', completed_at: '2026-11-07T14:00:00Z', walkDate: '2026-11-07' },
      ],
      new Map(),
      stays,
    );
    assert.equal(m.get('w1'), 'b2');
    assert.equal(m.has('w2'), false);
  });
});

describe('one review per stay', () => {
  const bookings = new Map(stays.map((s) => [s.id, s]));
  const reviews = [
    { reservation_id: 'r1', overall_rating: 5, review_created_at: '2026-11-05T00:00:00Z' },
    { reservation_id: 'r2', overall_rating: 4, review_created_at: '2026-11-12T00:00:00Z' },
    { reservation_id: 'r2', overall_rating: 3, review_created_at: '2026-11-11T00:00:00Z' },
  ];

  test('two walks on one stay count its review once; the latest review wins', () => {
    const walkToBooking = new Map([
      ['w1', 'b2'],
      ['w2', 'b2'],
      ['w3', 'b1'],
      ['w4', 'b4'],
    ]);
    const out = collectInspectorReviews(walkToBooking, bookings, reviews);
    assert.deepEqual(
      out.map((r) => [r.reservationId, r.rating]),
      [
        ['r2', 4],
        ['r1', 5],
      ],
    );
  });

  test('a stay with no Guesty id or no review adds nothing', () => {
    const out = collectInspectorReviews(new Map([['w4', 'b4'], ['w5', 'b3']]), bookings, reviews);
    assert.equal(out.length, 0);
  });

  test('the summary', () => {
    assert.deepEqual(summarizeRatings([{ rating: 5 }, { rating: 4 }, { rating: 5 }]), { count: 3, avg: 4.67, fiveStar: 2 });
    assert.deepEqual(summarizeRatings([]), { count: 0, avg: null, fiveStar: 0 });
  });
});
