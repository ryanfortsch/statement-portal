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

/**
 * JANUARY TO MARCH: RISING TIDE'S OWN WINTER, MEASURED (2026-11-09).
 *
 * The shoulder reading above comes from October or November, and October is
 * foliage season: it sells far better than a Cape Ann January. So a home's
 * October said "your off-season is fine" and the forecast spread a
 * market-shaped January to March across it. On 2026-11-09 the 2027 forecast
 * had January to March at 28% of its own July plus August; the homes Rising
 * Tide ran last winter did 11%. Dotti: "change it" so January to March follow
 * last winter's real fees.
 *
 * The measurement, same homes on both sides. The six homes managed all of
 * winter 2025-26 (CURRENT_2026 entries with start: 1: 17 Beach, 21 Horton,
 * 73 Rocky Neck, 3 South, 20 Hammond, 20 Enon):
 *
 *   January to March 2026 fees   $6,389.31  (the Chase ...5130 sweeps, Feb 2
 *                                            to Apr 3; Statements began April)
 *   July plus August 2026 fees  $57,765.33  (their 12 closed statements)
 *   ratio                          11.06%
 *
 * On the Gloucester revenue curve the same months are 13.67% and 31.19% of the
 * year, a ratio of 43.82%. So Rising Tide's January to March runs at about a
 * quarter (25.2%) of the market's shape, against the curve's own summer. The
 * Jul+Aug 2025 sweeps against the same winter give 11.14%, so the reading does
 * not hang on which summer is the base. If 53 Rocky Neck (contract from
 * 2025-06-30, no statement before May) was in the winter sweeps, the true
 * ratio is lower still (9.4%); 11.06% is the generous reading.
 *
 * Every home carries this one factor in January, February and March in place
 * of its shoulder reading (which stays on April, May and October to December).
 * Bookings still speak: Part A blends in as each winter month books. One
 * winter is one reading. Re-measure when April 2027 closes, from the
 * statements this time, and replace the two figures.
 */
export const DEEP_WINTER_MONTHS: ReadonlySet<number> = new Set([1, 2, 3]);

/** January to March 2026 management fees of the six homes managed all winter. */
export const RT_WINTER_FEES_JAN_MAR = 6389.31;
/** July plus August 2026 management fees of the same six homes. */
export const RT_SUMMER_FEES_JUL_AUG = 57765.33;

export function isDeepWinterMonth(ym: string): boolean {
  return DEEP_WINTER_MONTHS.has(parseInt(ym.slice(5, 7), 10));
}

/**
 * The share of the market curve Rising Tide's January to March carries:
 * RT's own January-to-March over July-plus-August, divided by the curve's.
 * `curve` is twelve shares, January first. Capped at 1 (it only lowers);
 * 1 when either side is unknown.
 */
export function deepWinterFactor(
  curve: readonly number[],
  winterFees: number = RT_WINTER_FEES_JAN_MAR,
  summerFees: number = RT_SUMMER_FEES_JUL_AUG,
): number {
  const curveWinter = (curve[0] ?? 0) + (curve[1] ?? 0) + (curve[2] ?? 0);
  const curveSummer = (curve[6] ?? 0) + (curve[7] ?? 0);
  if (!(winterFees > 0) || !(summerFees > 0) || !(curveWinter > 0) || !(curveSummer > 0)) return 1;
  return Math.min(1, winterFees / summerFees / (curveWinter / curveSummer));
}

/**
 * What multiplies a home's curve share in month `ym`: 1 in summer, the
 * measured winter factor in January to March, the home's own shoulder
 * reading in the other off-season months.
 */
export function partBSeasonFactor(ym: string, offFactor: number, winterFactor: number): number {
  if (!isOffSeasonMonth(ym)) return 1;
  return isDeepWinterMonth(ym) ? winterFactor : offFactor;
}
