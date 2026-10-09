/**
 * Which owner blocks still need the operator's "clean after?" answer.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { holdNights, ownerHoldQuestions, pendingOwnerHoldQuestions } from '../owner-hold-questions-core.ts';
import type { OwnerHoldCheckout } from '../owner-hold-checkouts.ts';

function hold(propertyId: string, checkIn: string, checkOut: string): OwnerHoldCheckout {
  return { propertyId, checkIn, checkOut, blockType: 'm', reason: 'Owner block', note: 'Owner use' };
}

const today = '2026-10-08';

describe('ownerHoldQuestions', () => {
  test('an upcoming hold with no answer is pending; it stays on the schedule meanwhile', () => {
    const qs = ownerHoldQuestions([hold('225_washington', '2026-10-05', '2026-10-09')], [], [], today);
    assert.equal(qs.length, 1);
    assert.equal(qs[0].status, 'pending');
    assert.equal(qs[0].answeredVia, null);
  });

  test('a hold that already checked out is never asked about', () => {
    const qs = ownerHoldQuestions([hold('21_horton', '2026-10-03', '2026-10-05')], [], [], today);
    assert.deepEqual(qs, []);
  });

  test('a hold checking out TODAY is still asked (the crew has not gone yet)', () => {
    const qs = ownerHoldQuestions([hold('21_horton', '2026-10-06', '2026-10-08')], [], [], today);
    assert.equal(qs.length, 1);
  });

  test('an answer on the card is reported as given', () => {
    const qs = ownerHoldQuestions(
      [hold('225_washington', '2026-10-05', '2026-10-09')],
      [{ property_id: '225_washington', stay_check_in: '2026-10-05', decision: 'clean', decided_by: 'dotti@risingtidestr.com' }],
      [],
      today,
    );
    assert.equal(qs[0].status, 'clean');
    assert.equal(qs[0].decidedBy, 'dotti@risingtidestr.com');
    assert.equal(qs[0].answeredVia, 'decision');
    assert.deepEqual(pendingOwnerHoldQuestions(qs), []);
  });

  test('"No cleaning needed" on the schedule page counts as the answer, so she is not asked twice', () => {
    const qs = ownerHoldQuestions(
      [hold('3_south_st', '2026-10-10', '2026-10-12')],
      [],
      [{ property_id: '3_south_st', stay_check_in: '2026-10-10', created_by: 'ryan@risingtidestr.com' }],
      today,
    );
    assert.equal(qs[0].status, 'no_clean');
    assert.equal(qs[0].answeredVia, 'skip');
    assert.equal(qs[0].decidedBy, 'ryan@risingtidestr.com');
  });

  test('a live skip outranks a stale "clean" answer: the schedule honours the skip', () => {
    const qs = ownerHoldQuestions(
      [hold('3_south_st', '2026-10-10', '2026-10-12')],
      [{ property_id: '3_south_st', stay_check_in: '2026-10-10', decision: 'clean' }],
      [{ property_id: '3_south_st', stay_check_in: '2026-10-10' }],
      today,
    );
    assert.equal(qs[0].status, 'no_clean');
  });

  test('an answer keyed on the stay survives the block being extended', () => {
    // Answered when the hold ended 10-09; Guesty then extended it to 10-11.
    const qs = ownerHoldQuestions(
      [hold('225_washington', '2026-10-05', '2026-10-11')],
      [{ property_id: '225_washington', stay_check_in: '2026-10-05', decision: 'clean' }],
      [],
      today,
    );
    assert.equal(qs[0].status, 'clean');
  });

  test('sorted soonest checkout first', () => {
    const qs = ownerHoldQuestions(
      [hold('36_granite', '2026-10-06', '2026-10-12'), hold('225_washington', '2026-10-05', '2026-10-09')],
      [],
      [],
      today,
    );
    assert.deepEqual(qs.map((q) => q.propertyId), ['225_washington', '36_granite']);
  });
});

describe('holdNights', () => {
  test('counts the nights between check-in and checkout', () => {
    assert.equal(holdNights('2026-10-05', '2026-10-09'), 4);
    assert.equal(holdNights('2026-10-03', '2026-10-04'), 1);
    assert.equal(holdNights('2026-10-05', '2026-10-05'), 0);
  });
});
