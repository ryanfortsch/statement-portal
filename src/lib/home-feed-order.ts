/**
 * The order of the home page's For Me feed: the signed-in person's day.
 *
 * Until 2026-10-18 the feed opened on owner blocks, cleaning flags, office
 * queues, guest payments, meetings and walks, and a staff member's own work
 * ("On your plate") was the seventh section down. The operations manager who
 * starts 2026-11-01 opens this page first every morning, so it now reads in
 * the order a day is worked:
 *
 *   1. mine      - work assigned to me, my planned walks, my meetings
 *   2. replies   - what is waiting on my answer
 *   3. team      - the clock-bound items anyone can take (an owner block's
 *                  "clean after?", a cleaning to check), then the team's
 *                  unassigned work when nothing is assigned to me
 *   4. office    - the office queues
 *   5. payments  - guest payment links, capped
 *   6. updates   - information and acknowledgments; never counted as replies
 *
 * Owners keep the "clean after?" card first: it is a question the operator
 * asked to be served loudly (2026-10-08), and it is owner-run today.
 *
 * Pure, no imports beyond the role type, so `npm test` pins the order.
 */

import type { HelmRole } from './helm-access.ts';

export type FeedSection =
  | 'work'
  | 'walks'
  | 'meetings'
  | 'replies'
  | 'holds'
  | 'cleanings'
  | 'unassigned'
  | 'queues'
  | 'payments'
  | 'updates';

const DAY: readonly FeedSection[] = [
  'work',
  'walks',
  'meetings',
  'replies',
  'holds',
  'cleanings',
  'unassigned',
  'queues',
  'payments',
  'updates',
];

export function homeFeedOrder(role: HelmRole): FeedSection[] {
  if (role === 'owner') return ['holds', ...DAY.filter((s) => s !== 'holds')];
  return [...DAY];
}

/** How many payment rows the feed shows before "N more". */
export const PAYMENTS_WINDOW = 4;

/**
 * The payment rows the feed shows, in the order they need a hand: a link
 * still unpaid, then a home whose links cannot be checked, then what got
 * paid. Past the window the rest fold into one "N more" link.
 */
export function windowPayments<O, P, D>(
  overdue: O[],
  problems: P[],
  paid: D[],
  cap: number = PAYMENTS_WINDOW,
): { overdue: O[]; problems: P[]; paid: D[]; more: number } {
  let left = Math.max(0, cap);
  function take<T>(rows: T[]): T[] {
    const out = rows.slice(0, left);
    left -= out.length;
    return out;
  }
  const o = take(overdue);
  const p = take(problems);
  const d = take(paid);
  return { overdue: o, problems: p, paid: d, more: overdue.length + problems.length + paid.length - o.length - p.length - d.length };
}
