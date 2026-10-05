import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  CLEANER_HORIZON_DAYS,
  cleanerWindow,
  parseScheduleDate,
} from '../cleaner-schedule-window.ts';

const TODAY = '2026-10-05';

test('no date: the first week, no way back, a way forward', () => {
  const w = cleanerWindow(TODAY, undefined);
  assert.equal(w.start, TODAY);
  assert.equal(w.requested, null);
  assert.equal(w.prevStart, null);
  assert.equal(w.nextStart, '2026-10-12');
});

test('a date inside the first week selects it without moving the week', () => {
  const w = cleanerWindow(TODAY, '2026-10-09');
  assert.equal(w.start, TODAY);
  assert.equal(w.requested, '2026-10-09');
});

test('a date past the first week opens the week that holds it', () => {
  // The bug: anything after day 7 snapped back to today.
  const w = cleanerWindow(TODAY, '2026-10-20');
  assert.equal(w.start, '2026-10-19');
  assert.equal(w.requested, '2026-10-20');
  assert.equal(w.prevStart, '2026-10-12');
  assert.equal(w.nextStart, '2026-10-26');
});

test('weeks stay anchored on today across a month and a DST change', () => {
  const w = cleanerWindow(TODAY, '2026-11-02');
  assert.equal(w.start, '2026-11-02');
  assert.equal(cleanerWindow(TODAY, '2026-11-08').start, '2026-11-02');
  assert.equal(cleanerWindow(TODAY, '2026-11-09').start, '2026-11-09');
});

test('past dates and dates beyond the horizon fall back to the first week', () => {
  assert.equal(cleanerWindow(TODAY, '2026-10-01').start, TODAY);
  assert.equal(cleanerWindow(TODAY, '2026-10-01').requested, null);
  assert.equal(cleanerWindow(TODAY, '2028-01-01').start, TODAY);
});

test('the last reachable week has no next link', () => {
  let w = cleanerWindow(TODAY, undefined);
  let steps = 0;
  while (w.nextStart) {
    w = cleanerWindow(TODAY, w.nextStart);
    steps++;
    assert.ok(steps < 100, 'paging must terminate');
  }
  assert.equal(steps, Math.floor(CLEANER_HORIZON_DAYS / 7));
});

test('garbage and impossible dates are rejected', () => {
  assert.equal(parseScheduleDate('2026-02-31'), null);
  assert.equal(parseScheduleDate('tomorrow'), null);
  assert.equal(parseScheduleDate('2026-10-05T00:00'), null);
  assert.equal(parseScheduleDate('2026-10-05'), '2026-10-05');
});
