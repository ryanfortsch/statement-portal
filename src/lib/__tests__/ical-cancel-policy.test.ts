/**
 * Which disappeared iCal rows the sync may cancel this run.
 *
 * The cron runs every 30 minutes. The first run that misses an upcoming row
 * stamps missing_since and defers it; a later run that still misses it
 * cancels once that stamp is more than 55 minutes old. A past row rolling
 * off the feed cancels at once, a hold the old sync stored as confirmed is
 * reclassified at once, a vanished hold gets the grace period but never
 * feeds the guard, and too many upcoming STAYS vanishing together trip the
 * guard until the operator releases it.
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
  keepsEmptyFeedGuardUp,
  holdsAreReservations,
  releaseAnswers,
} from '../ical-cancel-policy.ts';
import { isBlockSummary } from '../ical.ts';

const NOW = new Date('2026-09-26T15:00:00Z');
const TODAY = '2026-09-26';
const minutesAgo = (m: number, from: Date = NOW) => new Date(from.getTime() - m * 60_000).toISOString();

type Row = CancelCandidate & { ical_uid: string };

/** An upcoming confirmed stay, seen last run (missing_since null). */
function row(over: Partial<Row> & { id: string }): Row {
  return {
    ical_uid: `uid-${over.id}`,
    status: 'confirmed',
    check_in: '2026-10-10',
    check_out: '2026-10-14',
    missing_since: null,
    raw_summary: 'Reserved',
    ...over,
  };
}

function plan(
  existing: Row[],
  seenIds: string[],
  extra: { now?: Date; allowMassCancel?: boolean; holdsAreReservations?: boolean; treatMissingAsReady?: boolean } = {},
) {
  return planCancelPass({
    existing,
    incomingUids: new Set(seenIds.map((id) => `uid-${id}`)),
    now: extra.now ?? NOW,
    todayIso: TODAY,
    isBlockSummary,
    allowMassCancel: extra.allowMassCancel,
    holdsAreReservations: extra.holdsAreReservations,
    treatMissingAsReady: extra.treatMissingAsReady,
  });
}

describe('observations, not minutes', () => {
  test('a row seen this run is left to the upsert, even one stamped missing earlier', () => {
    const p = plan([row({ id: 'a', missing_since: minutesAgo(90) })], ['a']);
    assert.deepEqual(p.cancelNow, []);
    assert.deepEqual(p.deferred, []);
    assert.deepEqual(p.stampMissing, []);
    assert.deepEqual(p.reclassified, []);
    assert.equal(p.guard, null);
  });

  test('missing with missing_since null is the first observation: deferred and stamped', () => {
    const p = plan([row({ id: 'a' })], []);
    assert.deepEqual(p.cancelNow, []);
    assert.deepEqual(p.deferred, ['a']);
    assert.deepEqual(p.stampMissing, ['a']);
  });

  test('missing, stamped 30 minutes ago (one cron beat): still deferred, not re-stamped', () => {
    const p = plan([row({ id: 'a', missing_since: minutesAgo(30) })], []);
    assert.deepEqual(p.deferred, ['a']);
    assert.deepEqual(p.stampMissing, []);
    assert.deepEqual(p.cancelNow, []);
  });

  test('missing, stamped 60 minutes ago: cancels', () => {
    const p = plan([row({ id: 'a', missing_since: minutesAgo(60) })], []);
    assert.deepEqual(p.cancelNow, ['a']);
    assert.deepEqual(p.deferred, []);
    assert.deepEqual(p.stampMissing, []);
  });

  test('the grace period is strictly more than one beat and less than two', () => {
    assert.equal(CANCEL_AFTER_MISSING_MS, 55 * 60_000);
    assert.ok(CANCEL_AFTER_MISSING_MS > 30 * 60_000);
    assert.ok(CANCEL_AFTER_MISSING_MS < 60 * 60_000);
    assert.deepEqual(plan([row({ id: 'a', missing_since: minutesAgo(55) })], []).cancelNow, [], 'exactly 55 is not yet');
    assert.deepEqual(plan([row({ id: 'a', missing_since: minutesAgo(56) })], []).cancelNow, ['a']);
  });

  test('an unreadable stamp counts as no observation at all', () => {
    const p = plan([row({ id: 'a', missing_since: 'not a date' })], []);
    assert.deepEqual(p.deferred, ['a']);
    assert.deepEqual(p.stampMissing, ['a']);
  });

  test('an already-cancelled row is never touched', () => {
    const p = plan([row({ id: 'a', status: 'cancelled', missing_since: minutesAgo(500) })], []);
    assert.deepEqual(p.cancelNow, []);
    assert.deepEqual(p.deferred, []);
    assert.deepEqual(p.stampMissing, []);
    assert.deepEqual(p.reclassified, []);
  });

  test('a failed run in between never turns one short feed into a cancel', () => {
    // 10:00 saw S. 10:30 failed at fetch (nothing written, so S carries no
    // stamp). 11:00 serves a short feed missing S. The old rule measured
    // from last_seen_at (10:00, 60 minutes back) and cancelled here, on the
    // first miss anyone observed.
    const at = (hhmm: string) => new Date(`2026-09-26T${hhmm}:00Z`);
    const s = row({ id: 's' });
    const first = plan([s], [], { now: at('11:00') });
    assert.deepEqual(first.cancelNow, []);
    assert.deepEqual(first.stampMissing, ['s']);

    // The sync writes the stamp. 11:30 is whole again: the upsert clears it.
    // 12:00 short again: a fresh first observation, still no cancel.
    const again = plan([row({ id: 's', missing_since: null })], [], { now: at('12:00') });
    assert.deepEqual(again.cancelNow, []);
    assert.deepEqual(again.stampMissing, ['s']);

    // Only a second observation, past the grace period, cancels.
    const stamped = row({ id: 's', missing_since: at('12:00').toISOString() });
    assert.deepEqual(plan([stamped], [], { now: at('12:30') }).cancelNow, []);
    assert.deepEqual(plan([stamped], [], { now: at('13:00') }).cancelNow, ['s']);
  });
});

describe('rolled-off past rows cancel immediately, as before', () => {
  test('check_out before today cancels with no stamp and no grace period', () => {
    const p = plan([row({ id: 'past', check_in: '2026-09-20', check_out: '2026-09-24' })], []);
    assert.deepEqual(p.cancelNow, ['past']);
    assert.deepEqual(p.deferred, []);
    assert.deepEqual(p.stampMissing, []);
  });

  test('a stay checking out today is still upcoming and gets the grace period', () => {
    const p = plan([row({ id: 'today', check_in: '2026-09-22', check_out: TODAY })], []);
    assert.deepEqual(p.deferred, ['today']);
    assert.deepEqual(p.stampMissing, ['today']);
  });

  test('past roll-offs never count against the guard', () => {
    const past = Array.from({ length: 12 }, (_, i) => row({ id: `p${i}`, check_in: '2026-08-01', check_out: '2026-08-05' }));
    const p = plan([...past, row({ id: 'live', missing_since: minutesAgo(90) })], []);
    assert.equal(p.guard, null);
    assert.equal(p.cancelNow.length, 13);
    assert.equal(p.guardDetail.upcoming_live, 1);
    assert.equal(p.guardDetail.upcoming_missing, 1);
  });
});

describe('reclassification: a hold the old sync stored as confirmed', () => {
  test('a VRBO "Blocked" row stored confirmed cancels immediately and is reported apart', () => {
    const p = plan([row({ id: 'hold', raw_summary: 'Blocked' })], []);
    assert.deepEqual(p.reclassified, ['hold']);
    assert.deepEqual(p.cancelNow, []);
    assert.deepEqual(p.deferred, []);
    assert.deepEqual(p.stampMissing, []);
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

  test('a hold still in the feed is left to the upsert, which rewrites its status', () => {
    const p = plan([row({ id: 'hold', raw_summary: 'Blocked' })], ['hold']);
    assert.deepEqual(p.reclassified, []);
  });

  test('reclassified rows never count against the guard, missing or live', () => {
    const holds = Array.from({ length: 8 }, (_, i) => row({ id: `h${i}`, raw_summary: 'Blocked' }));
    const p = plan([...holds, row({ id: 'stay' })], ['stay']);
    assert.equal(p.reclassified.length, 8);
    assert.equal(p.guard, null);
    assert.equal(p.guardDetail.upcoming_missing, 0);
    assert.equal(p.guardDetail.upcoming_live, 1, 'only the stay is live');
  });
});

describe('a vanished hold gets the grace period and never feeds the guard', () => {
  const blocks = (n: number, missingSince: string | null) =>
    Array.from({ length: n }, (_, i) =>
      row({
        id: `b${i}`,
        status: 'block',
        raw_summary: 'Airbnb (Not available)',
        check_in: `2026-12-${String(i * 2 + 1).padStart(2, '0')}`,
        check_out: `2026-12-${String(i * 2 + 3).padStart(2, '0')}`,
        missing_since: missingSince,
      }),
    );

  test('a block row missing for the first time is deferred and stamped, not reclassified', () => {
    const p = plan([row({ id: 'blk', status: 'block', raw_summary: 'Blocked' })], []);
    assert.deepEqual(p.reclassified, []);
    assert.deepEqual(p.deferred, ['blk']);
    assert.deepEqual(p.stampMissing, ['blk']);
  });

  test('a block row stamped 60 minutes ago cancels as an ordinary disappearance', () => {
    const p = plan([row({ id: 'blk', status: 'block', raw_summary: 'Blocked', missing_since: minutesAgo(60) })], []);
    assert.deepEqual(p.reclassified, []);
    assert.deepEqual(p.cancelNow, ['blk']);
    assert.equal(p.guardDetail.upcoming_missing, 0);
  });

  test('8 missing upcoming blocks plus 1 missing stay, all stamped 60 minutes ago, cancel all 9 with guard null', () => {
    const rows = [...blocks(8, minutesAgo(60)), row({ id: 'stay', missing_since: minutesAgo(60) })];
    const p = plan(rows, []);
    assert.equal(p.guard, null);
    assert.equal(p.released, false);
    assert.equal(p.cancelNow.length, 9);
    assert.deepEqual([...p.cancelNow].sort(), [...rows.map((r) => r.id)].sort());
    assert.deepEqual(p.deferred, []);
    assert.deepEqual(p.guardDetail, { upcoming_live: 1, upcoming_missing: 1, threshold: 5 });
  });

  test('a bulk unblock on the OTA never trips the guard, on this run or any later one', () => {
    // 4 stays still in the feed, 8 opened weekends gone.
    const stays = Array.from({ length: 4 }, (_, i) => row({ id: `s${i}` }));
    const staysSeen = stays.map((s) => s.id);
    const run1 = plan([...stays, ...blocks(8, null)], staysSeen);
    assert.equal(run1.guard, null);
    assert.equal(run1.stampMissing.length, 8);
    const run3 = plan([...stays, ...blocks(8, minutesAgo(60))], staysSeen);
    assert.equal(run3.guard, null);
    assert.equal(run3.cancelNow.length, 8);
  });

  test('live blocks do not inflate the live count the threshold is taken from', () => {
    // 6 of 6 upcoming stays vanish while 12 holds stay in the feed. Counted
    // as live, the holds would lift the threshold to 8 and hide the trip.
    const stays = Array.from({ length: 6 }, (_, i) => row({ id: `s${i}`, missing_since: minutesAgo(60) }));
    const liveBlocks = blocks(12, null);
    const p = plan([...stays, ...liveBlocks], liveBlocks.map((b) => b.id));
    assert.equal(p.guard, 'mass_cancel');
    assert.deepEqual(p.guardDetail, { upcoming_live: 6, upcoming_missing: 6, threshold: 5 });
  });
});

describe('the mass-cancel guard counts only upcoming stays', () => {
  const upcoming = (n: number, missingSince: string | null) =>
    Array.from({ length: n }, (_, i) =>
      row({
        id: `u${i}`,
        check_in: `2026-11-${String(i + 1).padStart(2, '0')}`,
        check_out: `2026-11-${String(i + 2).padStart(2, '0')}`,
        missing_since: missingSince,
      }),
    );

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
    const rows = upcoming(10, minutesAgo(60));
    const p = plan(rows, ['u6', 'u7', 'u8', 'u9']);
    assert.equal(p.guard, 'mass_cancel');
    assert.equal(p.released, false);
    assert.deepEqual(p.cancelNow, []);
    assert.equal(p.deferred.length, 6);
    assert.deepEqual(p.stampMissing, [], 'held rows were stamped on an earlier run');
    assert.deepEqual(p.guardDetail, { upcoming_live: 10, upcoming_missing: 6, threshold: 5 });
  });

  test('5 of 10 upcoming missing is at the threshold and cancels', () => {
    const rows = upcoming(10, minutesAgo(60));
    const p = plan(rows, ['u5', 'u6', 'u7', 'u8', 'u9']);
    assert.equal(p.guard, null);
    assert.equal(p.cancelNow.length, 5);
  });

  test('while the guard holds the upcoming set, rolled-off rows and reclassified holds still cancel', () => {
    const rows = [
      ...upcoming(10, minutesAgo(60)),
      row({ id: 'past', check_in: '2026-09-01', check_out: '2026-09-04' }),
      row({ id: 'hold', raw_summary: 'Blocked' }),
    ];
    const p = plan(rows, ['u6', 'u7', 'u8', 'u9']);
    assert.equal(p.guard, 'mass_cancel');
    assert.deepEqual(p.cancelNow, ['past']);
    assert.deepEqual(p.reclassified, ['hold']);
    assert.equal(p.deferred.length, 6);
  });

  test('rows seen missing for the first time do not count toward the guard', () => {
    const rows = upcoming(10, null);
    const p = plan(rows, []);
    assert.equal(p.guard, null);
    assert.equal(p.deferred.length, 10);
    assert.equal(p.stampMissing.length, 10);
    assert.equal(p.guardDetail.upcoming_missing, 0);
  });

  test('a listing with fewer than six upcoming stays can never trip it', () => {
    const rows = upcoming(5, minutesAgo(60));
    const p = plan(rows, []);
    assert.equal(p.guard, null);
    assert.equal(p.cancelNow.length, 5);
  });

  test('without a release the same rows trip again on every later run', () => {
    const rows = upcoming(10, minutesAgo(60));
    for (const later of [90, 600, 6000]) {
      const p = plan(rows, ['u6', 'u7', 'u8', 'u9'], { now: new Date(NOW.getTime() + later * 60_000) });
      assert.equal(p.guard, 'mass_cancel', `+${later} min`);
      assert.deepEqual(p.cancelNow, []);
    }
  });
});

describe("the operator's release: allowMassCancel skips rule 4 for one run", () => {
  const upcoming = (n: number, missingSince: string | null) =>
    Array.from({ length: n }, (_, i) =>
      row({
        id: `u${i}`,
        check_in: `2026-11-${String(i + 1).padStart(2, '0')}`,
        check_out: `2026-11-${String(i + 2).padStart(2, '0')}`,
        missing_since: missingSince,
      }),
    );

  test('the set the guard would hold cancels, and the plan says it was released', () => {
    const rows = upcoming(10, minutesAgo(60));
    const p = plan(rows, ['u6', 'u7', 'u8', 'u9'], { allowMassCancel: true });
    assert.equal(p.guard, null);
    assert.equal(p.released, true);
    assert.equal(p.cancelNow.length, 6);
    assert.deepEqual(p.deferred, []);
    assert.deepEqual(p.guardDetail, { upcoming_live: 10, upcoming_missing: 6, threshold: 5 }, 'the detail still reports what the guard saw');
  });

  test('all 8 of 8 upcoming stays gone (a suspended listing) cancel on release', () => {
    const rows = upcoming(8, minutesAgo(120));
    assert.equal(plan(rows, []).guard, 'mass_cancel');
    const p = plan(rows, [], { allowMassCancel: true });
    assert.equal(p.guard, null);
    assert.equal(p.cancelNow.length, 8);
  });

  test('a release on a run the guard would not trip is not reported as used', () => {
    const p = plan(upcoming(3, minutesAgo(60)), [], { allowMassCancel: true });
    assert.equal(p.guard, null);
    assert.equal(p.released, false);
    assert.equal(p.cancelNow.length, 3);
  });

  test('a release never skips the two-observation rule', () => {
    const rows = [...upcoming(3, minutesAgo(60)), row({ id: 'fresh' }), row({ id: 'waiting', missing_since: minutesAgo(20) })];
    const p = plan(rows, [], { allowMassCancel: true });
    assert.deepEqual([...p.deferred].sort(), ['fresh', 'waiting']);
    assert.deepEqual(p.stampMissing, ['fresh']);
    assert.equal(p.cancelNow.length, 3);
  });
});

describe('keepsEmptyFeedGuardUp: only an upcoming live stay holds the guard', () => {
  const today = '2026-10-01';
  const isHold = (raw: string | null) => /not available|blocked|closed/i.test(raw ?? '');
  const r = (status: string, check_out: string, raw_summary: string | null = null) => ({ status, check_out, raw_summary });

  test('an upcoming confirmed stay keeps the guard up', () => {
    assert.equal(keepsEmptyFeedGuardUp(r('confirmed', '2026-10-05', 'Reserved'), today, isHold), true);
  });

  test('a lifted owner block (the feed\'s last event) does not: it must be able to cancel', () => {
    assert.equal(keepsEmptyFeedGuardUp(r('block', '2026-10-05', 'Airbnb (Not available)'), today, isHold), false);
    assert.equal(keepsEmptyFeedGuardUp(r('confirmed', '2026-10-05', 'Blocked'), today, isHold), false);
  });

  test('a cancelled or rolled-off row does not', () => {
    assert.equal(keepsEmptyFeedGuardUp(r('cancelled', '2026-10-05'), today, isHold), false);
    assert.equal(keepsEmptyFeedGuardUp(r('confirmed', '2026-09-30'), today, isHold), false);
  });
});

describe('Booking.com: a closure may be a guest, so both guards count it', () => {
  // Booking.com's iCal publishes every booking as "CLOSED - Not available";
  // ical-sync stores each as a block. Before this, neither guard counted a
  // block, and an empty or truncated Booking.com feed cancelled every
  // Booking.com guest on file in three beats.
  const closure = (id: string, over: Partial<Row> = {}) => row({ id, status: 'block', raw_summary: 'CLOSED - Not available', ...over });

  test('only booking_com publishes reservations as closures', () => {
    assert.equal(holdsAreReservations('booking_com'), true);
    for (const c of ['airbnb', 'vrbo', 'other', 'guesty', null]) assert.equal(holdsAreReservations(c), false, String(c));
  });

  test('an upcoming Booking.com closure keeps the empty-feed guard up; an Airbnb one does not', () => {
    const r = closure('b');
    assert.equal(keepsEmptyFeedGuardUp(r, TODAY, isBlockSummary, true), true);
    assert.equal(keepsEmptyFeedGuardUp(r, TODAY, isBlockSummary, false), false);
    assert.equal(keepsEmptyFeedGuardUp({ ...r, check_out: '2026-09-20' }, TODAY, isBlockSummary, true), false, 'past');
    assert.equal(keepsEmptyFeedGuardUp({ ...r, status: 'cancelled' }, TODAY, isBlockSummary, true), false, 'cancelled');
  });

  test('six Booking.com reservations vanishing at once trip the mass-cancel guard', () => {
    const rows = Array.from({ length: 6 }, (_, i) => closure(`b${i}`, { missing_since: minutesAgo(60) }));
    const p = plan(rows, [], { holdsAreReservations: true });
    assert.equal(p.guard, 'mass_cancel');
    assert.deepEqual(p.cancelNow, []);
    assert.equal(p.guardDetail.upcoming_live, 6);
  });

  test('the same six Airbnb closures lifted at once cancel with no guard (a bulk unblock)', () => {
    const rows = Array.from({ length: 6 }, (_, i) => closure(`a${i}`, { missing_since: minutesAgo(60), raw_summary: 'Airbnb (Not available)' }));
    const p = plan(rows, [], { holdsAreReservations: false });
    assert.equal(p.guard, null);
    assert.equal(p.cancelNow.length, 6);
  });

  test('one Booking.com closure leaving still cancels after two looks', () => {
    const p = plan([closure('b1', { missing_since: minutesAgo(60) }), closure('b2')], ['b2'], { holdsAreReservations: true });
    assert.deepEqual(p.cancelNow, ['b1']);
    assert.equal(p.guard, null);
  });
});

describe('releasing an empty-feed guard: the operator is the second look', () => {
  test('with treatMissingAsReady, rows never observed missing cancel on the release run', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', status: 'block', raw_summary: 'CLOSED - Not available' })];
    const p = plan(rows, [], { allowMassCancel: true, treatMissingAsReady: true, holdsAreReservations: true });
    assert.deepEqual(p.cancelNow.sort(), ['a', 'b']);
    assert.deepEqual(p.stampMissing, []);
  });

  test('without it the same rows only start the two-look clock', () => {
    const p = plan([row({ id: 'a' })], [], { allowMassCancel: true });
    assert.deepEqual(p.cancelNow, []);
    assert.deepEqual(p.stampMissing, ['a']);
  });
});

describe('releaseAnswers: a release answers only the run whose alert it was pressed on', () => {
  const run = (id: string, guard: string | null) => ({ id, guard });
  test('the answered run, still the newest decisive one, releases its own guard', () => {
    assert.equal(releaseAnswers('run-1', run('run-1', 'mass_cancel')), 'mass_cancel');
    assert.equal(releaseAnswers('run-1', run('run-1', 'empty_feed')), 'empty_feed');
  });
  test('a mass-cancel click never releases the empty feed recorded after it (stale tab, or a run in flight)', () => {
    assert.equal(releaseAnswers('run-1', run('run-2', 'empty_feed')), null);
    assert.equal(releaseAnswers('run-1', run('run-2', 'mass_cancel')), null, 'a later mass cancel is a different set');
  });
  test('no run named, no run read, or an unguarded run answers nothing', () => {
    assert.equal(releaseAnswers(null, run('run-1', 'mass_cancel')), null);
    assert.equal(releaseAnswers('run-1', null), null);
    assert.equal(releaseAnswers('run-1', run('run-1', null)), null);
  });
});
