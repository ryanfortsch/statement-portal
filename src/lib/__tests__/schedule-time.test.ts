import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  horizonYmd,
  isoFromDateTime,
  nextQuarterHour,
  SCHEDULE_HORIZON_DAYS,
  todayYmd,
  toYmd,
} from '../schedule-time.ts';

// The picker hands isoFromDateTime a local wall-clock date + time and gets a
// UTC instant back. These assert the round trip lands on the instant the
// operator meant, because every failure mode here is silent: the card just
// fires on the wrong day.

test('a picked date and time round-trips to the same local wall clock', () => {
  const iso = isoFromDateTime('2026-10-03', '14:30');
  const back = new Date(iso);
  assert.equal(back.getFullYear(), 2026);
  assert.equal(back.getMonth(), 9); // October
  assert.equal(back.getDate(), 3);
  assert.equal(back.getHours(), 14);
  assert.equal(back.getMinutes(), 30);
});

test('a pick made on the 31st does not roll the month over', () => {
  // The old helper mutated today's Date, so setDate(+1) on the 31st of a
  // month followed by a short month landed in the wrong month entirely.
  // Building from the parts cannot do that.
  const back = new Date(isoFromDateTime('2026-11-30', '09:00'));
  assert.equal(back.getMonth(), 10); // November, not December
  assert.equal(back.getDate(), 30);
});

test('a date past the DST boundary keeps the wall-clock time', () => {
  // US DST ends 2026-11-01. A 2:30 PM pick on either side is 2:30 PM local
  // to the operator even though the UTC offset differs.
  assert.equal(new Date(isoFromDateTime('2026-10-30', '14:30')).getHours(), 14);
  assert.equal(new Date(isoFromDateTime('2026-11-06', '14:30')).getHours(), 14);
});

test('an empty or malformed date returns empty, never a RangeError', () => {
  // The date input can be cleared. new Date(NaN).toISOString() THROWS, which
  // in a click handler is an unhandled error instead of "Pick a time to
  // schedule" — the message the server action already produces for ''.
  assert.equal(isoFromDateTime('', '14:30'), '');
  assert.equal(isoFromDateTime('not-a-date', '14:30'), '');
  assert.doesNotThrow(() => isoFromDateTime('', ''));
});

test('a missing time is taken as midnight, not as a failure', () => {
  const back = new Date(isoFromDateTime('2026-10-03', ''));
  assert.equal(back.getHours(), 0);
  assert.equal(back.getMinutes(), 0);
});

test('toYmd reads the LOCAL day, not the UTC one', () => {
  // 2026-10-03 21:00 local is already 2026-10-04 in UTC anywhere west of
  // Greenwich. Using toISOString().slice(0,10) for the input's value would
  // default the picker to tomorrow every evening.
  const evening = new Date(2026, 9, 3, 21, 0, 0, 0);
  assert.equal(toYmd(evening), '2026-10-03');
});

test('the horizon is SCHEDULE_HORIZON_DAYS past today', () => {
  const from = new Date(2026, 8, 26, 12, 0, 0, 0);
  assert.equal(todayYmd(from), '2026-09-26');
  assert.equal(horizonYmd(from), '2026-10-26');
  assert.equal(SCHEDULE_HORIZON_DAYS, 30);
});

test('the default time is the next quarter hour', () => {
  assert.equal(nextQuarterHour(new Date(2026, 8, 26, 14, 22, 0, 0)), '14:30');
  assert.equal(nextQuarterHour(new Date(2026, 8, 26, 14, 0, 0, 0)), '14:15');
  // Rolling past the hour still formats as a valid HH:MM.
  assert.equal(nextQuarterHour(new Date(2026, 8, 26, 14, 52, 0, 0)), '15:00');
});
