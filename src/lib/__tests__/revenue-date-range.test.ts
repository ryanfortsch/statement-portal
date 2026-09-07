import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDateRange,
  easternDateStr,
  firstOfMonth,
  lastOfMonth,
  shiftDays,
  formatRangeLabel,
} from '../revenue-date-range.ts';

/**
 * The bug these pin: Vercel runs in UTC, so from 8pm ET the server has already
 * rolled to tomorrow. At a month boundary that switched "This Month" to the
 * next one four or five hours early, during the evening someone closes a month.
 */

// 2026-08-31, 10pm in Gloucester. The server clock already reads September 1st.
const AUG_31_10PM_ET = new Date('2026-09-01T02:00:00Z');
// 2026-09-01, 12:30am in Gloucester. Genuinely September.
const SEP_1_1230AM_ET = new Date('2026-09-01T04:30:00Z');
// Winter, when the offset is five hours rather than four.
const DEC_31_11PM_ET = new Date('2027-01-01T04:00:00Z');

test('an evening instant is still yesterday in Gloucester, whatever the server thinks', () => {
  assert.equal(AUG_31_10PM_ET.toISOString().slice(0, 10), '2026-09-01', 'server date');
  assert.equal(easternDateStr(AUG_31_10PM_ET), '2026-08-31', 'Gloucester date');
});

test('the offset is followed across DST, not hardcoded at four hours', () => {
  assert.equal(easternDateStr(DEC_31_11PM_ET), '2026-12-31');
  // Same wall-clock hour in summer, when the offset is four.
  assert.equal(easternDateStr(new Date('2026-07-01T03:00:00Z')), '2026-06-30');
});

test('This Month at 10pm on the 31st is still August, which is the whole point', () => {
  const r = computeDateRange('this_month', undefined, undefined, AUG_31_10PM_ET);
  assert.deepEqual(r, { rangeStart: '2026-08-01', rangeEnd: '2026-08-31' });
});

test('and it does roll over once Gloucester actually reaches the 1st', () => {
  const r = computeDateRange('this_month', undefined, undefined, SEP_1_1230AM_ET);
  assert.deepEqual(r, { rangeStart: '2026-09-01', rangeEnd: '2026-09-30' });
});

test('Last Month follows the same clock', () => {
  assert.deepEqual(
    computeDateRange('last_month', undefined, undefined, AUG_31_10PM_ET),
    { rangeStart: '2026-07-01', rangeEnd: '2026-07-31' },
  );
  assert.deepEqual(
    computeDateRange('last_month', undefined, undefined, SEP_1_1230AM_ET),
    { rangeStart: '2026-08-01', rangeEnd: '2026-08-31' },
  );
});

test('a year boundary at 11pm on New Year Eve stays in the old year', () => {
  assert.deepEqual(
    computeDateRange('full_year', undefined, undefined, DEC_31_11PM_ET),
    { rangeStart: '2026-01-01', rangeEnd: '2026-12-31' },
  );
  assert.deepEqual(
    computeDateRange('ytd', undefined, undefined, DEC_31_11PM_ET),
    { rangeStart: '2026-01-01', rangeEnd: '2026-12-31' },
  );
});

test('month-to-date ends today in Gloucester, not tomorrow on the server', () => {
  assert.deepEqual(
    computeDateRange('mtd', undefined, undefined, AUG_31_10PM_ET),
    { rangeStart: '2026-08-01', rangeEnd: '2026-08-31' },
  );
});

test('rolling windows count from the Gloucester date', () => {
  assert.deepEqual(
    computeDateRange('last_30', undefined, undefined, AUG_31_10PM_ET),
    { rangeStart: '2026-08-01', rangeEnd: '2026-08-31' },
  );
  assert.deepEqual(
    computeDateRange('next_90', undefined, undefined, AUG_31_10PM_ET),
    { rangeStart: '2026-08-31', rangeEnd: '2026-11-29' },
  );
});

test('next month wraps the year correctly', () => {
  assert.deepEqual(
    computeDateRange('next_month', undefined, undefined, DEC_31_11PM_ET),
    { rangeStart: '2027-01-01', rangeEnd: '2027-01-31' },
  );
});

test('calendar helpers are UTC-anchored, including a leap February', () => {
  assert.equal(firstOfMonth(2026, 0), '2026-01-01');
  assert.equal(lastOfMonth(2026, 1), '2026-02-28');
  assert.equal(lastOfMonth(2028, 1), '2028-02-29');
  assert.equal(lastOfMonth(2026, 11), '2026-12-31');
});

test('shifting days cannot drift across a DST boundary', () => {
  // US DST ends 2026-11-01. A local-time shift here loses or gains an hour and
  // can land on the wrong calendar day.
  assert.equal(shiftDays('2026-10-31', 2), '2026-11-02');
  assert.equal(shiftDays('2026-11-02', -2), '2026-10-31');
  assert.equal(shiftDays('2026-12-31', 1), '2027-01-01');
});

test('the range label prints the dates it was given, not a zone-shifted pair', () => {
  assert.equal(formatRangeLabel('2026-09-01', '2026-09-30'), 'Sep 1, 2026 to Sep 30, 2026');
});

test('an explicit custom month is untouched by the clock', () => {
  assert.deepEqual(
    computeDateRange('custom_month', { year: 2026, month: 3 }, undefined, AUG_31_10PM_ET),
    { rangeStart: '2026-04-01', rangeEnd: '2026-04-30' },
  );
});
