/** Time-sensitive team items, then personal next actions, then updates.
 * Owners always keep clean-after decisions first. */

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
  'walks',
  'meetings',
  'holds',
  'cleanings',
  'work',
  'replies',
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
