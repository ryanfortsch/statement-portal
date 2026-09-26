/**
 * Which disappeared iCal rows the sync may cancel this run.
 *
 * The cron runs every 30 minutes. A row missing from one run and seen 20
 * minutes ago is deferred; missing and last seen 56 minutes ago (two runs)
 * is cancelled. A past stay rolling off the feed cancels at once, a hold the
 * old sync stored as confirmed is reclassified at once, and too many
 * upcoming stays vanishing together trips the guard.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  planCancelPass,
  massCancelThreshold,
  CANCEL_AFTER_MISSING_MS,
  MASS_CANCEL_MIN,
  MASS_CANCEL_SHARE,
  type CancelCandidate,
} from '../ical-cancel-policy.ts';
import { isBlockSummary } from '../ical.ts';

const NOW = new Date('2026-09-26T15:00:00Z');
const TODAY = '2026-09-26';
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

type Row = CancelCandidate & { ical_uid: string };

function row(over: Partial<Row> & { id: string }): Row {
  return {
    ical_uid: `uid-${over.id}`,
    status: 'confirmed',
    check_in: '2026-10-10',
    check_out: '2026-10-14',
    last_seen_at: minutesAgo(30),
    raw_summary: 'Reserved',
    ...over,
  };
}

function plan(existing: Row[], seenIds: string[]) {
  return planCancelPass({
    existing,
    incomingUids: new Set(seenIds.map((id) => `uid-${id}`)),
    now: NOW,
    todayIso: TODAY,
    isBlockSummary,
  });
}

describe('the two-consecutive-runs rule', () => {
  test('a row seen this run is left to the upsert', () => {
    const p = plan([row({ id: 'a', last_seen_at: minutesAgo(90) })], ['a']);
    assert.deepEqual(p.cancelNow, []);
    assert.deepEqual(p.deferred, []);
    assert.deepEqual(p.reclassified, []);
    assert.equal(p.guard, null);
  });

  test('missing but seen 20 minutes ago is deferred', () => {
    const p = plan([row({ id: 'a', last_seen_at: minutesAgo(20) })], []);
    assert.deepEqual(p.cancelNow, []);
    assert.deepEqual(p.deferred, ['a']);
  });

  test('missing and seen 30 minutes ago (one cron beat) is still deferred', () => {
    const p = plan([row({ id: 'a', last_seen_at: minutesAgo(30) })], []);
    assert.deepEqual(p.deferred, ['a']);
  });

  test('missing and seen 56 minutes ago (two cron beats) cancels', () => {
    const p = plan([row({ id: 'a', last_seen_at: minutesAgo(56) })], []);
    assert.deepEqual(p.cancelNow, ['a']);
    assert.deepEqual(p.deferred, []);
  });

  test('the grace period is strictly more than one beat and less than two', () => {
    assert.equal(CANCEL_AFTER_MISSING_MS, 55 * 60_000);
    assert.ok(CANCEL_AFTER_MISSING_MS > 30 * 60_000);
    assert.ok(CANCEL_AFTER_MISSING_MS < 60 * 60_000);
  });

  test('an already-cancelled row is never touched', () => {
    const p = plan([row({ id: 'a', status: 'cancelled', last_seen_at: minutesAgo(500) })], []);
    assert.deepEqual(p.cancelNow, []);
    assert.deepEqual(p.deferred, []);
    assert.deepEqual(p.reclassified, []);
  });
});

describe('rolled-off past rows cancel immediately, as before', () => {
  test('check_out before today cancels whatever last_seen_at says', () => {
    const p = plan(
      [row({ id: 'past', check_in: '2026-09-20', check_out: '2026-09-24', last_seen_at: minutesAgo(10) })],
      [],
    );
    assert.deepEqual(p.cancelNow, ['past']);
    assert.deepEqual(p.deferred, []);
  });

  test('a stay checking out today is still upcoming and gets the grace period', () => {
    const p = plan([row({ id: 'today', check_in: '2026-09-22', check_out: TODAY, last_seen_at: minutesAgo(10) })], []);
    assert.deepEqual(p.deferred, ['today']);
  });

  test('past roll-offs never count against the guard', () => {
    const past = Array.from({ length: 12 }, (_, i) =>
      row({ id: `p${i}`, check_in: '2026-08-01', check_out: '2026-08-05', last_seen_at: minutesAgo(10) }),
    );
    const p = plan([...past, row({ id: 'live', last_seen_at: minutesAgo(90) })], []);
    assert.equal(p.guard, null);
    assert.equal(p.cancelNow.length, 13);
    assert.equal(p.guardDetail.upcoming_live, 1);
    assert.equal(p.guardDetail.upcoming_missing, 1);
  });
});

describe('reclassification: a hold the old sync stored as confirmed', () => {
  test('a VRBO "Blocked" row stored confirmed cancels immediately and is reported apart', () => {
    const p = plan([row({ id: 'hold', raw_summary: 'Blocked', last_seen_at: minutesAgo(5) })], []);
    assert.deepEqual(p.reclassified, ['hold']);
    assert.deepEqual(p.cancelNow, []);
    assert.deepEqual(p.deferred, []);
  });

  test('so do "Airbnb (Not available)" and "CLOSED - Not available"', () => {
    const p = plan(
      [
        row({ id: 'ab', raw_summary: 'Airbnb (Not available)' }),
        row({ id: 'bc', raw_summary: 'CLOSED - Not available' }),
      ],
      [],
    );
    assert.deepEqual([...p.reclassified].sort(), ['ab', 'bc']);
  });

  test('a hold already stored as a block is an ordinary disappearance, not a reclassification', () => {
    const p = plan([row({ id: 'blk', status: 'block', raw_summary: 'Blocked', last_seen_at: minutesAgo(60) })], []);
    assert.deepEqual(p.reclassified, []);
    assert.deepEqual(p.cancelNow, ['blk']);
  });

  test('a hold still in the feed is left to the upsert, which rewrites its status', () => {
    const p = plan([row({ id: 'hold', raw_summary: 'Blocked' })], ['hold']);
    assert.deepEqual(p.reclassified, []);
  });

  test('reclassified rows never count against the guard', () => {
    const holds = Array.from({ length: 8 }, (_, i) => row({ id: `h${i}`, raw_summary: 'Blocked' }));
    const p = plan([...holds, row({ id: 'stay', last_seen_at: minutesAgo(10) })], ['stay']);
    assert.equal(p.reclassified.length, 8);
    assert.equal(p.guard, null);
    assert.equal(p.guardDetail.upcoming_missing, 0);
  });
});

describe('the mass-cancel guard counts only upcoming stays', () => {
  const upcoming = (n: number, seenMin: number) =>
    Array.from({ length: n }, (_, i) => row({ id: `u${i}`, check_in: `2026-11-${String(i + 1).padStart(2, '0')}`, check_out: `2026-11-${String(i + 2).padStart(2, '0')}`, last_seen_at: minutesAgo(seenMin) }));

  test('threshold is max(5, ceil(40% of upcoming live))', () => {
    assert.equal(MASS_CANCEL_MIN, 5);
    assert.equal(MASS_CANCEL_SHARE, 0.4);
    assert.equal(massCancelThreshold(0), 5);
    assert.equal(massCancelThreshold(10), 5);
    assert.equal(massCancelThreshold(12), 5);
    assert.equal(massCancelThreshold(13), 6);
    assert.equal(massCancelThreshold(30), 12);
  });

  test('6 of 10 upcoming missing trips the guard; nothing upcoming cancels', () => {
    const rows = upcoming(10, 60);
    const p = plan(rows, ['u6', 'u7', 'u8', 'u9']);
    assert.equal(p.guard, 'mass_cancel');
    assert.deepEqual(p.cancelNow, []);
    assert.equal(p.deferred.length, 6);
    assert.deepEqual(p.guardDetail, { upcoming_live: 10, upcoming_missing: 6, threshold: 5 });
  });

  test('5 of 10 upcoming missing is at the threshold and cancels', () => {
    const rows = upcoming(10, 60);
    const p = plan(rows, ['u5', 'u6', 'u7', 'u8', 'u9']);
    assert.equal(p.guard, null);
    assert.equal(p.cancelNow.length, 5);
  });

  test('while the guard holds the upcoming set, rolled-off rows and reclassified holds still cancel', () => {
    const rows = [
      ...upcoming(10, 60),
      row({ id: 'past', check_in: '2026-09-01', check_out: '2026-09-04' }),
      row({ id: 'hold', raw_summary: 'Blocked' }),
    ];
    const p = plan(rows, ['u6', 'u7', 'u8', 'u9']);
    assert.equal(p.guard, 'mass_cancel');
    assert.deepEqual(p.cancelNow, ['past']);
    assert.deepEqual(p.reclassified, ['hold']);
    assert.equal(p.deferred.length, 6);
  });

  test('rows still inside the grace period do not count toward the guard either', () => {
    const rows = upcoming(10, 20);
    const p = plan(rows, []);
    assert.equal(p.guard, null);
    assert.equal(p.deferred.length, 10);
    assert.equal(p.guardDetail.upcoming_missing, 0);
  });

  test('a listing with fewer than six upcoming rows can never trip it', () => {
    const rows = upcoming(5, 60);
    const p = plan(rows, []);
    assert.equal(p.guard, null);
    assert.equal(p.cancelNow.length, 5);
  });
});
