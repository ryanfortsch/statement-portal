/**
 * A home's own off-season, read from the shoulder month on the books.
 *
 * Part B of the smart forecast spreads a home's annual gross over the
 * Gloucester revenue curve, which is the MARKET's shape: October is 11.8%
 * of the year on it, more than June, and January is 4%. A beach house does
 * not work that way. On 2026-10-16, 17 Beach had $19,580 booked for an
 * October the curve put at $32,061, 61%, while January 2027 was projected
 * at $10,608 of gross with nothing booked and nothing to be expected. The
 * operator's read: "we have $4.6K for October and not a whole lot of pickup
 * expected; the January to April numbers look high as well".
 *
 * So each home carries an off-season factor: what its shoulder month is
 * actually doing, as a share of what the curve expected of it, applied to
 * Part B in every month outside June to September. The shoulder month is
 * the current month once it is at least half elapsed (the pace-up applies
 * only to the days still ahead), otherwise the month just finished, read
 * at its final bookings. The factor only lowers (capped at 1) and never
 * below OFF_SEASON_FACTOR_MIN, so a thin reading cannot zero a home. A home
 * with nothing on the books for the shoulder month learns nothing (factor
 * 1): zero is a data gap as often as a fact (a Helm-run home's feed stays
 * are not in guesty_reservations yet). Summer months learn nothing either:
 * the factor is read from an off-season month only.
 *
 * Pure and dependency-free so the rule is testable without the database.
 */

/** Months whose share of the year comes from the market curve unscaled. */
export const SUMMER_MONTHS: ReadonlySet<number> = new Set([6, 7, 8, 9]);

/** The day of the month from which the current month is the shoulder reading. */
export const SHOULDER_MIN_DAY = 15;

/** The factor never drops a home's off-season below this share of the curve. */
export const OFF_SEASON_FACTOR_MIN = 0.5;

export function isOffSeasonMonth(ym: string): boolean {
  const m = parseInt(ym.slice(5, 7), 10);
  return m >= 1 && m <= 12 && !SUMMER_MONTHS.has(m);
}

/** YYYY-MM of the month before `ym`. */
export function previousMonth(ym: string): string {
  const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The month the off-season is read from on `today`: the current month from
 * its 15th, the month just finished before that. Null when that month is a
 * summer month, which teaches nothing about the off-season.
 */
export function shoulderMonthFor(today: Date): { month: string; current: boolean } | null {
  const cur = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const pick = today.getDate() >= SHOULDER_MIN_DAY ? { month: cur, current: true } : { month: previousMonth(cur), current: false };
  return isOffSeasonMonth(pick.month) ? pick : null;
}

/**
 * What the shoulder month is on course to do. A finished month is its
 * bookings. The current month is its bookings plus the pace-up on the days
 * still ahead (none on the last day, all of it on the 1st), the same rule
 * the projection itself uses for the month in progress.
 */
export function realizedForShoulder(input: {
  booked: number;
  /** Pace-corrected bookings (Part A) for the month; falls back to booked. */
  paceA?: number | null;
  /** Share of the month still ahead, 0 to 1. 0 for a finished month. */
  remaining: number;
}): number {
  const a = input.paceA != null && input.paceA > input.booked ? input.paceA : input.booked;
  const remaining = Math.max(0, Math.min(1, input.remaining));
  return input.booked + (a - input.booked) * remaining;
}

/**
 * The share of the curve a home's off-season carries: realized over
 * expected, capped at 1, floored at OFF_SEASON_FACTOR_MIN. 1 when either
 * side is unknown (no bookings, no expectation).
 */
export function offSeasonFactor(realized: number, expected: number): number {
  if (!(realized > 0) || !(expected > 0)) return 1;
  return Math.max(OFF_SEASON_FACTOR_MIN, Math.min(1, realized / expected));
}
