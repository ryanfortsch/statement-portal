/**
 * The Guesty sync's step order, time budget and catch-up.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GUESTY_SYNC_STEPS,
  RESERVATION_STEPS,
  STEP_ESTIMATE_MS,
  SYNC_BUDGET_MS,
  TIME_BUDGET_REASON,
  gateStep,
  parseRequestedSteps,
  partialSyncLine,
  planGuestySync,
  syncLogLine,
  waitingSteps,
  type GuestySyncStep,
  type StepOutcome,
} from '../guesty-sync-plan.ts';

const DAY = 86_400_000;
const EVEN_DAY = 20_384 * DAY; // 2025-10-23 UTC, an even day index
const ODD_DAY = EVEN_DAY + DAY;
const ALL = new Set(GUESTY_SYNC_STEPS);

function outcomes(...list: StepOutcome[]): Map<GuestySyncStep, StepOutcome> {
  return new Map(list.map((o) => [o.step, o]));
}

describe('planGuestySync', () => {
  test('what statements and the boards read runs first, in order', () => {
    for (const now of [EVEN_DAY, ODD_DAY]) {
      const plan = planGuestySync(ALL, now);
      assert.deepEqual(plan.slice(0, 5), ['listings', 'reservations', 'cancel_reconcile', 'ghost_bookings', 'bookings_backfill']);
      assert.equal(plan.length, GUESTY_SYNC_STEPS.length, 'every step is planned once');
    }
  });

  test('the calendar pair and the reviews pair swap places every UTC day', () => {
    assert.deepEqual(planGuestySync(ALL, EVEN_DAY).slice(5), ['calendar', 'reservation_gaps', 'reviews', 'reviews_to_slips']);
    assert.deepEqual(planGuestySync(ALL, ODD_DAY).slice(5), ['reviews', 'reviews_to_slips', 'calendar', 'reservation_gaps']);
    // Any time inside the day plans the same way, so the cron and a click
    // later that day agree.
    assert.deepEqual(planGuestySync(ALL, EVEN_DAY + DAY - 1), planGuestySync(ALL, EVEN_DAY));
  });

  test('only the requested steps are planned', () => {
    assert.deepEqual(planGuestySync(new Set(RESERVATION_STEPS), EVEN_DAY), [...RESERVATION_STEPS]);
  });
});

describe('gateStep', () => {
  test('a step starts only when its expected cost fits under the budget', () => {
    const none = outcomes();
    assert.deepEqual(gateStep('reviews', { elapsedMs: 0, outcomes: none }), { run: true });
    const lastStart = SYNC_BUDGET_MS - STEP_ESTIMATE_MS.reviews;
    assert.deepEqual(gateStep('reviews', { elapsedMs: lastStart, outcomes: none }), { run: true });
    assert.deepEqual(gateStep('reviews', { elapsedMs: lastStart + 1, outcomes: none }), { run: false, reason: TIME_BUDGET_REASON });
  });

  test('the budget leaves real headroom under the 300s limit', () => {
    assert.ok(SYNC_BUDGET_MS <= 240_000, 'a minute for a step that overruns its estimate');
    const route = readFileSync(new URL('../../app/api/sync-guesty/route.ts', import.meta.url), 'utf8');
    const cron = readFileSync(new URL('../../app/api/cron/sync-guesty/route.ts', import.meta.url), 'utf8');
    for (const src of [route, cron]) assert.ok(/export const maxDuration = 300;/.test(src), 'both routes set maxDuration = 300');
    assert.ok(SYNC_BUDGET_MS < 300_000);
  });

  test('a reservation follow-up never runs after a failed or missing pull', () => {
    for (const step of ['cancel_reconcile', 'ghost_bookings', 'bookings_backfill'] as const) {
      const failed = outcomes({ step: 'reservations', status: 'error', ms: 900 });
      assert.deepEqual(gateStep(step, { elapsedMs: 0, outcomes: failed }), { run: false, reason: 'reservations_sync_failed' });
      assert.deepEqual(gateStep(step, { elapsedMs: 0, outcomes: outcomes() }), { run: false, reason: 'reservations_not_run' });
      const ok = outcomes({ step: 'reservations', status: 'ok', ms: 900 });
      assert.deepEqual(gateStep(step, { elapsedMs: 0, outcomes: ok }), { run: true });
    }
  });

  test('the gap audit waits with the calendar when the calendar waited for time', () => {
    const waited = outcomes({ step: 'calendar', status: 'skipped', ms: 0, reason: TIME_BUDGET_REASON });
    assert.deepEqual(gateStep('reservation_gaps', { elapsedMs: 0, outcomes: waited }), { run: false, reason: TIME_BUDGET_REASON });
    const failed = outcomes({ step: 'calendar', status: 'error', ms: 10 });
    assert.deepEqual(gateStep('reservation_gaps', { elapsedMs: 0, outcomes: failed }), { run: false, reason: 'calendar_sync_failed' });
  });

  test('a measured full run fits with room to spare', () => {
    // Every step at its estimate, back to back, is still inside the budget,
    // so the budget only bites on a bad day.
    let elapsed = 0;
    const done = new Map<GuestySyncStep, StepOutcome>();
    for (const step of planGuestySync(ALL, EVEN_DAY)) {
      assert.deepEqual(gateStep(step, { elapsedMs: elapsed, outcomes: done }), { run: true }, step);
      elapsed += STEP_ESTIMATE_MS[step];
      done.set(step, { step, status: 'ok', ms: STEP_ESTIMATE_MS[step] });
    }
    assert.ok(elapsed < SYNC_BUDGET_MS);
  });
});

describe('a slow run ends partial, and the other pair goes first next time', () => {
  function simulate(now: number, slowMs: number): StepOutcome[] {
    // The core steps ate most of the budget.
    let elapsed = 0;
    const done = new Map<GuestySyncStep, StepOutcome>();
    const out: StepOutcome[] = [];
    for (const step of planGuestySync(ALL, now)) {
      const gate = gateStep(step, { elapsedMs: elapsed, outcomes: done });
      const o: StepOutcome = gate.run
        ? { step, status: 'ok', ms: step === 'bookings_backfill' ? slowMs : 5_000 }
        : { step, status: 'skipped', ms: 0, reason: gate.reason };
      elapsed += o.ms;
      done.set(step, o);
      out.push(o);
    }
    return out;
  }

  test('the second pair waits, by name, and runs first the next day', () => {
    // The core steps take 205s: the calendar pair still fits, reviews do not.
    const run = simulate(EVEN_DAY, 185_000);
    assert.deepEqual(waitingSteps(run), ['reviews', 'reviews_to_slips']);
    assert.equal(run.find((o) => o.step === 'calendar')?.status, 'ok');
    const next = simulate(ODD_DAY, 185_000);
    assert.equal(next.find((o) => o.step === 'reviews')?.status, 'ok', 'the pair that waited goes first the next day');
    assert.ok(!waitingSteps(next).includes('reviews'));
  });
});

describe('parseRequestedSteps', () => {
  test('absent means every step', () => {
    const r = parseRequestedSteps(undefined);
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.steps.size, GUESTY_SYNC_STEPS.length);
  });
  test('a list of known steps is taken as given', () => {
    const r = parseRequestedSteps([...RESERVATION_STEPS]);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual([...r.steps], [...RESERVATION_STEPS]);
  });
  test('a typo or an empty list is refused, never a silent no-op', () => {
    for (const bad of [[], ['reservation'], 'reservations', [42]]) {
      const r = parseRequestedSteps(bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
    }
  });
});

describe('what a partial run says', () => {
  test('one plain line naming what waits', () => {
    assert.equal(partialSyncLine([]), '');
    assert.equal(partialSyncLine(['calendar']), 'Partial sync: the calendar catches up on the next run.');
    assert.equal(
      partialSyncLine(['reviews', 'reviews_to_slips']),
      'Partial sync: reviews and review work slips catch up on the next run.',
    );
    assert.doesNotMatch(partialSyncLine(['reviews']), /fail/i);
    assert.doesNotMatch(partialSyncLine(['calendar', 'reservation_gaps', 'reviews']), /—/);
  });

  test('the log line carries step names and times, nothing else', () => {
    const line = syncLogLine(
      [
        { step: 'reservations', status: 'ok', ms: 3200 },
        { step: 'reviews', status: 'skipped', ms: 0, reason: TIME_BUDGET_REASON },
      ],
      61_000,
    );
    assert.equal(line, '[sync-guesty] reservations ok 3200ms, reviews skipped (time_budget); total 61000ms of 240000ms budget');
  });
});

describe('the route keeps its guards', () => {
  const route = readFileSync(new URL('../../app/api/sync-guesty/route.ts', import.meta.url), 'utf8');
  test('every step goes through the gate, and the response names what waited', () => {
    assert.ok(/gateStep\(/.test(route), 'the route gates each step');
    assert.ok(/planGuestySync\(/.test(route), 'the route runs the planned order');
    assert.ok(/waiting_steps/.test(route), 'the response names the steps that waited');
  });
  test('the reviews step looks up only guests it has no name for', () => {
    assert.ok(/const nameCache = await loadKnownGuestNames\(\);/.test(route), 'names already on file seed the lookup cache');
  });
});
