#!/usr/bin/env node
/**
 * Booked-run detection check.
 *
 * Exercises the REAL shipped helper (src/lib/booked-runs.ts) via Node's native
 * TypeScript stripping. No database, no bundler, no network.
 *
 * This guards the detection half of the reservation gap backfill
 * (src/lib/reservation-gap-backfill.ts). Guesty's /v1/reservations feed only
 * returns `confirmed` rows, so a stay created AND checked into between two
 * syncs never lands anywhere; the only thing that still knows about it is the
 * per-day calendar mirror, and these functions are what turn "sold nights the
 * mirror knows about" into "the stay nobody has on file". Get the interval
 * arithmetic wrong and the pass either misses a real gap or re-probes Guesty
 * forever for a stay that is already covered.
 *
 * The cases that matter: half-open intervals (the checkout morning is not a
 * night), back-to-back stays that leave no gap day between them, a one-night
 * hole between two known stays, month and year boundaries, and the live
 * 225 Washington gap this whole pass was written for.
 *
 * Run: node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON scripts/booked_runs_check.mjs
 */

import assert from 'node:assert/strict';
import {
  addDays,
  expandNights,
  staysOverlap,
  uncoveredRuns,
} from '../src/lib/booked-runs.ts';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

/** Sold nights for a set of stays, as the mirror would report them. */
function booked(...stays) {
  return stays.flatMap(([ci, co]) => expandNights(ci, co));
}
/** Nights covered by the reservations we DO have on file. */
function covered(...stays) {
  return new Set(booked(...stays));
}
const shape = (runs) => runs.map((r) => `${r.check_in}->${r.check_out}:${r.nights}`);

console.log('addDays');
check('walks a month boundary', () => assert.equal(addDays('2026-08-31', 1), '2026-09-01'));
check('walks a year boundary', () => assert.equal(addDays('2026-12-31', 1), '2027-01-01'));
check('handles leap day', () => assert.equal(addDays('2028-02-28', 1), '2028-02-29'));
check('walks backwards', () => assert.equal(addDays('2026-03-01', -1), '2026-02-28'));
check('survives a US DST spring-forward', () => {
  // 2026-03-08 is the US spring-forward. A local-time implementation returns
  // the same day back here; UTC anchoring must not.
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
});
check('tolerates a timestamp suffix', () => assert.equal(addDays('2026-08-22T14:10:00Z', 1), '2026-08-23'));

console.log('expandNights');
check('excludes the checkout morning', () =>
  assert.deepEqual(expandNights('2026-08-22', '2026-08-25'), ['2026-08-22', '2026-08-23', '2026-08-24']));
check('a one-night stay is one night', () =>
  assert.deepEqual(expandNights('2026-06-22', '2026-06-23'), ['2026-06-22']));
check('a zero-night stay is empty', () => assert.deepEqual(expandNights('2026-06-22', '2026-06-22'), []));
check('a reversed interval is empty, not a hang', () =>
  assert.deepEqual(expandNights('2026-06-25', '2026-06-22'), []));

console.log('staysOverlap');
check('back-to-back stays do not overlap', () =>
  assert.equal(staysOverlap('2026-08-22', '2026-08-29', '2026-08-29', '2026-09-02'), false));
check('a shared night overlaps', () =>
  assert.equal(staysOverlap('2026-08-22', '2026-08-29', '2026-08-28', '2026-09-02'), true));
check('containment overlaps', () =>
  assert.equal(staysOverlap('2026-08-24', '2026-08-26', '2026-08-22', '2026-08-29'), true));

console.log('uncoveredRuns');
check('fully covered leaves nothing', () =>
  assert.deepEqual(uncoveredRuns('p', booked(['2026-08-22', '2026-08-29']), covered(['2026-08-22', '2026-08-29'])), []));

check('the live 225 Washington gap', () => {
  // Mirror on 2026-08-25: Aug 22-28 sold (Andrea Richmond, created and checked
  // in the same day, never returned by the feed) and Sep 2-5 sold (Bianca Rosa,
  // on file). Only the first is a gap, and it must come back as a 7-night stay
  // checking out Aug 29 -- not 7 one-night stays, not Aug 22-28.
  const runs = uncoveredRuns(
    '225_washington',
    booked(['2026-08-22', '2026-08-29'], ['2026-09-02', '2026-09-06']),
    covered(['2026-09-02', '2026-09-06']),
  );
  assert.deepEqual(shape(runs), ['2026-08-22->2026-08-29:7']);
  assert.equal(runs[0].property_id, '225_washington');
});

check('back-to-back missing stays collapse into one run', () => {
  // Two stays that touch share no gap day, so detection cannot tell them
  // apart. The pass is built for that: it inserts everything the listing query
  // returns for the run's window, not one row per run.
  const runs = uncoveredRuns('p', booked(['2026-07-01', '2026-07-04'], ['2026-07-04', '2026-07-08']), new Set());
  assert.deepEqual(shape(runs), ['2026-07-01->2026-07-08:7']);
});

check('a one-night hole between two known stays is its own run', () => {
  const runs = uncoveredRuns(
    'p',
    booked(['2026-06-19', '2026-06-22'], ['2026-06-22', '2026-06-23'], ['2026-06-23', '2026-06-26']),
    covered(['2026-06-19', '2026-06-22'], ['2026-06-23', '2026-06-26']),
  );
  assert.deepEqual(shape(runs), ['2026-06-22->2026-06-23:1']);
});

check('separate holes stay separate', () => {
  const runs = uncoveredRuns(
    'p',
    booked(['2026-06-05', '2026-06-07'], ['2026-06-08', '2026-06-10']),
    new Set(),
  );
  assert.deepEqual(shape(runs), ['2026-06-05->2026-06-07:2', '2026-06-08->2026-06-10:2']);
});

check('a run spanning a month boundary stays one run', () => {
  const runs = uncoveredRuns('p', booked(['2026-08-30', '2026-09-02']), new Set());
  assert.deepEqual(shape(runs), ['2026-08-30->2026-09-02:3']);
});

check('a partly-covered stay reports only the uncovered tail', () => {
  const runs = uncoveredRuns('p', booked(['2026-05-03', '2026-05-08']), covered(['2026-05-03', '2026-05-05']));
  assert.deepEqual(shape(runs), ['2026-05-05->2026-05-08:3']);
});

check('unsorted and duplicated mirror days still collapse correctly', () => {
  const runs = uncoveredRuns('p', ['2026-07-14', '2026-07-13', '2026-07-13', '2026-07-15'], new Set());
  assert.deepEqual(shape(runs), ['2026-07-13->2026-07-16:3']);
});

check('no booked days means no runs', () => assert.deepEqual(uncoveredRuns('p', [], new Set()), []));

console.log(`\n${passed} checks passed`);
