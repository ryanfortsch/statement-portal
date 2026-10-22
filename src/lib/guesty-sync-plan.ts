/**
 * The step plan and time budget for /api/sync-guesty.
 *
 * The Guesty sync is nine steps in one request. With no budget it ran into the
 * 300s platform limit on 17 of 51 calls between 2026-10-15 and 10-19, and the
 * nightly cron sat at 225-238s. A timeout kills the request mid-step: every
 * later step silently never ran and the caller read "refresh failed".
 *
 * Where the time went (Vercel outbound-request metrics, cron of 2026-10-21,
 * 237s in all): the reviews step looked up the guest behind every review of
 * the last two years, about 465 Guesty calls a run against Guesty's
 * 120-a-minute limit, so 60 to 78 of them came back 429 and each one slept
 * 2-10s before retrying. That one step was about 190s. Everything else
 * together was about 35s, 18 of it the review-slips model call. The route now
 * looks up only guests it has no name for (see syncReviews), and the per-step
 * times below are the measured costs with generous margin.
 *
 * Three rules, all pure here so they are tested without a network:
 *
 *   1. Order. The steps owner statements and the boards read (the
 *      reservations pull, the cancel reconcile, the ghost-booking check and
 *      the copy into `bookings`) run first, in that order. The calendar pair
 *      and the reviews pair come after.
 *   2. Budget. A step starts only when its expected cost still fits under
 *      SYNC_BUDGET_MS, which leaves a minute of headroom under the 300s
 *      limit for a step that runs long. A step that does not fit is skipped
 *      and named in the response, so a call ends with a partial result
 *      instead of dying mid-step.
 *   3. Catch-up. The calendar pair and the reviews pair swap places every
 *      UTC day, so when the budget runs short it is never the same pair that
 *      waits two nights running. Their sync_status stamps cannot say who is
 *      owed: the 30-minute channels-sync stamps 'guesty-calendar' too.
 */

export const GUESTY_SYNC_STEPS = [
  'listings',
  'reservations',
  'cancel_reconcile',
  'ghost_bookings',
  'bookings_backfill',
  'calendar',
  'reservation_gaps',
  'reviews',
  'reviews_to_slips',
] as const;
export type GuestySyncStep = (typeof GUESTY_SYNC_STEPS)[number];

/** Steps may start until this much of the request has gone. The route's
 *  maxDuration is 300s; the rest is headroom for a step that overruns. */
export const SYNC_BUDGET_MS = 240_000;

/** Expected cost of each step: the measured time with margin. A step starts
 *  only if elapsed + this still fits under the budget. */
export const STEP_ESTIMATE_MS: Record<GuestySyncStep, number> = {
  listings: 10_000,
  reservations: 15_000,
  cancel_reconcile: 15_000,
  ghost_bookings: 10_000,
  bookings_backfill: 15_000,
  calendar: 30_000,
  reservation_gaps: 15_000,
  reviews: 30_000,
  reviews_to_slips: 45_000,
};

/**
 * A step that only makes sense after another one succeeded in the same run.
 * The reservation follow-ups probe and copy what the pull just wrote (after a
 * failed pull every row looks stale, and the probes would burn rate limit for
 * nothing); the gap audit checks this run's calendar against the
 * reservations.
 */
export const STEP_NEEDS: Partial<Record<GuestySyncStep, GuestySyncStep>> = {
  cancel_reconcile: 'reservations',
  ghost_bookings: 'reservations',
  bookings_backfill: 'reservations',
  reservation_gaps: 'calendar',
};

/** The reservations pull and the three steps that finish it: what the
 *  Revenue page's automatic refresh asks for. */
export const RESERVATION_STEPS: readonly GuestySyncStep[] = [
  'reservations',
  'cancel_reconcile',
  'ghost_bookings',
  'bookings_backfill',
];

const CORE_STEPS: readonly GuestySyncStep[] = ['listings', ...RESERVATION_STEPS];
const CALENDAR_PAIR: readonly GuestySyncStep[] = ['calendar', 'reservation_gaps'];
const REVIEWS_PAIR: readonly GuestySyncStep[] = ['reviews', 'reviews_to_slips'];

/** Plain words for a step, for the one line a partial run shows. */
export const STEP_WORDS: Record<GuestySyncStep, string> = {
  listings: 'listings',
  reservations: 'bookings',
  cancel_reconcile: 'the cancellation check',
  ghost_bookings: 'the ghost booking check',
  bookings_backfill: 'the bookings copy',
  calendar: 'the calendar',
  reservation_gaps: 'the missing reservations check',
  reviews: 'reviews',
  reviews_to_slips: 'review work slips',
};

export const TIME_BUDGET_REASON = 'time_budget';

export type StepStatus = 'ok' | 'error' | 'skipped';
export type StepOutcome = {
  step: GuestySyncStep;
  status: StepStatus;
  ms: number;
  reason?: string;
};

function isStep(s: unknown): s is GuestySyncStep {
  return typeof s === 'string' && (GUESTY_SYNC_STEPS as readonly string[]).includes(s);
}

/**
 * Read the request body's `steps`. Absent means every step. Anything else
 * must be a non-empty list of known step names; a typo is refused rather
 * than quietly running nothing.
 */
export function parseRequestedSteps(
  raw: unknown,
): { ok: true; steps: Set<GuestySyncStep> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, steps: new Set(GUESTY_SYNC_STEPS) };
  const known = GUESTY_SYNC_STEPS.join(', ');
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: `steps must be a non-empty list of: ${known}` };
  }
  const unknown = raw.filter((s) => !isStep(s)).map(String);
  if (unknown.length > 0) {
    return { ok: false, error: `unknown steps: ${unknown.join(', ')}. Known: ${known}` };
  }
  return { ok: true, steps: new Set(raw as GuestySyncStep[]) };
}

/**
 * The order to run the requested steps in: the core steps first, then the
 * calendar and reviews pairs, which swap places on alternate UTC days.
 */
export function planGuestySync(
  requested: ReadonlySet<GuestySyncStep>,
  nowMs: number,
): GuestySyncStep[] {
  const day = Math.floor(nowMs / 86_400_000);
  const pairs = day % 2 === 0 ? [CALENDAR_PAIR, REVIEWS_PAIR] : [REVIEWS_PAIR, CALENDAR_PAIR];
  return [...CORE_STEPS, ...pairs.flat()].filter((s) => requested.has(s));
}

/**
 * Whether a step may start now. A step whose prerequisite failed or did not
 * run is skipped with the reason; one whose prerequisite waited for time
 * waits for time too. Otherwise it starts only if its expected cost fits.
 */
export function gateStep(
  step: GuestySyncStep,
  ctx: { elapsedMs: number; outcomes: ReadonlyMap<GuestySyncStep, StepOutcome>; budgetMs?: number },
): { run: true } | { run: false; reason: string } {
  const need = STEP_NEEDS[step];
  if (need) {
    const prior = ctx.outcomes.get(need);
    if (prior?.status === 'error') return { run: false, reason: `${need}_sync_failed` };
    if (prior?.status === 'skipped' && prior.reason === TIME_BUDGET_REASON) {
      return { run: false, reason: TIME_BUDGET_REASON };
    }
    if (prior?.status !== 'ok') return { run: false, reason: `${need}_not_run` };
  }
  const budgetMs = ctx.budgetMs ?? SYNC_BUDGET_MS;
  if (ctx.elapsedMs + STEP_ESTIMATE_MS[step] > budgetMs) {
    return { run: false, reason: TIME_BUDGET_REASON };
  }
  return { run: true };
}

/** The steps this run left for the next one because time ran short. */
export function waitingSteps(outcomes: readonly StepOutcome[]): GuestySyncStep[] {
  return outcomes
    .filter((o) => o.status === 'skipped' && o.reason === TIME_BUDGET_REASON)
    .map((o) => o.step);
}

/** One console line per run: step names, status and milliseconds. Never any
 *  guest, booking or property data. */
export function syncLogLine(outcomes: readonly StepOutcome[], totalMs: number, budgetMs = SYNC_BUDGET_MS): string {
  const parts = outcomes.map((o) =>
    o.status === 'skipped' ? `${o.step} skipped (${o.reason ?? 'unknown'})` : `${o.step} ${o.status} ${o.ms}ms`,
  );
  return `[sync-guesty] ${parts.join(', ')}; total ${totalMs}ms of ${budgetMs}ms budget`;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The one line a partial run shows, from the response's `waiting_steps`.
 * Empty when nothing waits.
 */
export function partialSyncLine(waiting: readonly string[]): string {
  if (waiting.length === 0) return '';
  const words = waiting.map((s) => (isStep(s) ? STEP_WORDS[s] : s));
  const verb = words.length === 1 ? 'catches' : 'catch';
  return `Partial sync: ${joinWords(words)} ${verb} up on the next run.`;
}
