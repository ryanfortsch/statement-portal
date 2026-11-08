import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ageDays, closeMonthFor, closeTile, hasClearNote, isWinter, ratingTile, recordsTile, scheduleTile, seesScorecard, winterTile, workTile,
} from '../ops-scorecard.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

describe("the operations scorecard reads the offer letter's standards", () => {
  test('rating: 4.98 is met, 4.979 is not, and it never rounds up', () => {
    assert.equal(ratingTile({ avg: 4.98, total: 40 }).state, 'met');
    const near = ratingTile({ avg: 4.979, total: 40 });
    assert.equal(near.value, '4.97');
    assert.equal(near.state, 'off');
    assert.equal(ratingTile(null).state, 'unknown', 'a failed read is never met');
    assert.equal(ratingTile({ avg: null, total: 0 }).state, 'idle');
  });

  test('work: under 120 open, oldest 60 days or less, every close with a note', () => {
    assert.equal(workTile({ open: 119, oldestDays: 60, closed: 4, closedWithNote: 4 }).state, 'met');
    assert.equal(workTile({ open: 120, oldestDays: 10, closed: 0, closedWithNote: 0 }).state, 'off', '120 is not under 120');
    assert.equal(workTile({ open: 50, oldestDays: 61, closed: 0, closedWithNote: 0 }).state, 'off');
    assert.equal(workTile({ open: 50, oldestDays: 5, closed: 3, closedWithNote: 2 }).state, 'off');
    assert.equal(workTile({ open: 346, oldestDays: 74, closed: 9, closedWithNote: 6 }).detail, 'oldest 74 days · 6 of 9 closed with a note');
  });

  test('cleaner schedule: every day with cleanings sent', () => {
    assert.equal(scheduleTile({ days: 5, sent: 5 }).state, 'met');
    assert.equal(scheduleTile({ days: 5, sent: 4 }).state, 'off');
    assert.equal(scheduleTile({ days: 0, sent: 0 }).state, 'idle');
  });

  test('statement close: open before the due date waits, after it is late; a send after the due date is late', () => {
    const c = { month: '2026-11', monthName: 'November', due: '2026-11-27', dueLabel: 'Fri, Nov 27', today: '2026-11-20', open: 3, sent: 0, lastSentDay: null };
    assert.equal(closeTile(c).state, 'idle');
    assert.equal(closeTile({ ...c, today: '2026-11-28' }).state, 'off');
    assert.equal(closeTile({ ...c, open: 0, sent: 3, lastSentDay: '2026-11-26' }).value, 'On time');
    assert.equal(closeTile({ ...c, open: 0, sent: 3, lastSentDay: '2026-11-28' }).state, 'off');
    assert.equal(closeMonthFor('2026-12-05', 10), '2026-11', 'early December still follows November');
    assert.equal(closeMonthFor('2026-12-11', 10), '2026-12');
    assert.equal(closeMonthFor('2027-01-03', 10), '2026-12');
  });

  test('home records and winter care', () => {
    assert.equal(recordsTile({ homes: 20, complete: 20 }).state, 'met');
    assert.equal(recordsTile({ homes: 20, complete: 9 }).value, '9 of 20');
    assert.equal(isWinter('2026-11-30'), false);
    assert.equal(isWinter('2026-12-01'), true);
    assert.equal(isWinter('2027-04-30'), true);
    assert.equal(isWinter('2027-05-01'), false);
    assert.equal(winterTile('2026-11-08', null).value, 'Starts Dec 1', 'outside winter it never reads as a failure');
    assert.equal(winterTile('2026-12-08', { empty: 6, checked: 5 }).state, 'off');
    assert.equal(winterTile('2026-12-08', null).state, 'unknown');
  });

  test('small helpers', () => {
    assert.equal(ageDays('2026-09-10T15:00:00Z', '2026-11-08'), 59);
    assert.equal(hasClearNote('done'), false);
    assert.equal(hasClearNote('Replaced the bathroom fan motor'), true);
    assert.equal(seesScorecard({ teamRole: 'operations', ownerLogin: false }), true);
    assert.equal(seesScorecard({ teamRole: null, ownerLogin: false }), false, 'other staff do not see her goals');
    assert.equal(seesScorecard({ teamRole: null, ownerLogin: true }), true);
  });
});

test('the band sits at the top of the For Me home, and holds no money', () => {
  const page = read('src/app/(home)/page.tsx');
  assert.ok(page.includes('<OpsScorecard />'), 'the scorecard left the home');
  assert.ok(page.indexOf('<OpsScorecard />') < page.indexOf('<ForMeFeed />'), 'the scorecard is not above the feed');
  const server = read('src/lib/ops-scorecard-server.ts');
  for (const money of ['owner_payout', 'property_statements', 'management_fee', 'revenue']) {
    assert.ok(!server.includes(money), `the scorecard reads ${money}`);
  }
});
