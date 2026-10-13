import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeAutomationTime, fireAtFor } from '../automations-core.ts';

const now = new Date('2026-10-08T12:00:00Z');
const events = {
  confirmationAt: new Date('2026-10-08T08:00:00-04:00'),
  checkinAt: new Date('2026-10-09T16:00:00-04:00'),
};
function at(anchor: 'confirmation' | 'checkin', offsetMinutes: number, input = events) {
  const result = relativeAutomationTime({ anchor, offsetMinutes }, input, now);
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') throw new Error('Expected ready time');
  return result.fireAt.toISOString();
}

test('confirmation delay is measured from confirmation, not a later planning run', () => {
  assert.equal(at('confirmation', 30), '2026-10-08T12:30:00.000Z');
  const late = relativeAutomationTime({ anchor: 'confirmation', offsetMinutes: 30 }, events,
    new Date('2026-10-08T13:00:00Z'));
  assert.deepEqual(late, { status: 'needs-review', reason: 'overdue' });
});

test('door and cleaner reminders track actual check-in time, including changed arrivals', () => {
  assert.equal(at('checkin', -60), '2026-10-09T19:00:00.000Z');
  assert.equal(at('checkin', -420), '2026-10-09T13:00:00.000Z');
  assert.equal(at('checkin', -60, { ...events, checkinAt: new Date('2026-10-09T18:00:00-04:00') }),
    '2026-10-09T21:00:00.000Z');
});

test('normalized instants retain correct elapsed offsets across DST and midnight', () => {
  assert.equal(at('checkin', -60, { ...events, checkinAt: new Date('2026-11-01T01:30:00-05:00') }),
    '2026-11-01T05:30:00.000Z');
  assert.equal(at('checkin', -420, { ...events, checkinAt: new Date('2026-11-02T04:00:00-05:00') }),
    '2026-11-02T02:00:00.000Z');
});

test('unknown confirmation and invalid offsets cannot fabricate a send time', () => {
  assert.deepEqual(relativeAutomationTime({ anchor: 'confirmation', offsetMinutes: 30 },
    { ...events, confirmationAt: null }, now), { status: 'needs-review', reason: 'missing-anchor' });
  for (const offsetMinutes of [NaN, Infinity, 0.5, 1e10]) {
    assert.deepEqual(relativeAutomationTime({ anchor: 'checkin', offsetMinutes }, events, now),
      { status: 'needs-review', reason: 'invalid-timing' });
  }
});

test('due now is eligible for further checks; legacy confirmation behavior stays unchanged', () => {
  const due = relativeAutomationTime({ anchor: 'confirmation', offsetMinutes: 30 }, events,
    new Date('2026-10-08T12:30:00Z'));
  assert.equal(due.status, 'ready');
  assert.equal(fireAtFor({ trigger: 'booking_confirmed', offset_days: 0, at_local: null,
    timezone: 'America/New_York' }, { check_in: '2026-10-09', check_out: '2026-10-11' },
    null, null, now)?.toISOString(), now.toISOString());
});
