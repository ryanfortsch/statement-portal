/**
 * Gloucester market average daily rate, by day, trailing twelve months, and
 * the lookups the revenue pacing projection prices its open nights with.
 *
 * Source: AirDNA "Rate by day" export for the Gloucester market
 * (rateByDay_last_12_month.csv, pulled 2026-09-16). One row per night, no
 * gaps. The table sits between the GENERATED markers below; refresh it with
 *
 *   node scripts/market_rate_by_day_gen.mjs ~/Downloads/rateByDay_last_12_month.csv
 *
 * Pure. No I/O, no imports (node --test loads it without a bundler). Unit
 * tests in src/lib/__tests__/market-rate-by-day.test.ts.
 *
 * Why a day series and not a monthly average: the pacing multiplier used to
 * price every projected night at the month's BOOKED ADR, and what is booked
 * early for an off-season month is the premium inventory (Halloween weekend,
 * Thanksgiving week), so a November 8% booked at $608/night projected the
 * other 27 points of occupancy at $608 too. The market's own day curve
 * carries the weekend and holiday shape (Fri/Sat run about 12% over Mon-Wed,
 * Thanksgiving week about 18% over early November, Christmas week about 20%
 * over early December), so a future night is priced at what the market got
 * for the same weekday and holiday a year earlier, with each home's achieved
 * premium over market applied on top.
 */

// BEGIN GENERATED (2025-10-01 to 2026-09-15, 350 days; regenerate with scripts/market_rate_by_day_gen.mjs)
export const MARKET_RATE_FIRST_DAY = '2025-10-01';
export const MARKET_RATE_LAST_DAY = '2026-09-15';
export const MARKET_RATE_BY_DAY: Record<string, number> = {
  '2025-10-01': 348.61,
  '2025-10-02': 403.89,
  '2025-10-03': 453.62,
  '2025-10-04': 464.23,
  '2025-10-05': 423.63,
  '2025-10-06': 385.56,
  '2025-10-07': 374.63,
  '2025-10-08': 379.3,
  '2025-10-09': 444.35,
  '2025-10-10': 467.69,
  '2025-10-11': 469.56,
  '2025-10-12': 446.79,
  '2025-10-13': 405.61,
  '2025-10-14': 334.41,
  '2025-10-15': 376.89,
  '2025-10-16': 407.49,
  '2025-10-17': 444.36,
  '2025-10-18': 430.51,
  '2025-10-19': 369.57,
  '2025-10-20': 356.46,
  '2025-10-21': 366.77,
  '2025-10-22': 393.02,
  '2025-10-23': 424.62,
  '2025-10-24': 448.39,
  '2025-10-25': 438.44,
  '2025-10-26': 383.5,
  '2025-10-27': 371.31,
  '2025-10-28': 367.03,
  '2025-10-29': 350.59,
  '2025-10-30': 369.97,
  '2025-10-31': 376.18,
  '2025-11-01': 389.25,
  '2025-11-02': 391.97,
  '2025-11-03': 341.04,
  '2025-11-04': 324.65,
  '2025-11-05': 332.85,
  '2025-11-06': 347.53,
  '2025-11-07': 378.14,
  '2025-11-08': 378.7,
  '2025-11-09': 340.59,
  '2025-11-10': 335.43,
  '2025-11-11': 330.47,
  '2025-11-12': 349.95,
  '2025-11-13': 365.81,
  '2025-11-14': 389.28,
  '2025-11-15': 389.17,
  '2025-11-16': 370.86,
  '2025-11-17': 372.83,
  '2025-11-18': 357.28,
  '2025-11-19': 354.58,
  '2025-11-20': 417.86,
  '2025-11-21': 456.74,
  '2025-11-22': 440.37,
  '2025-11-23': 430.13,
  '2025-11-24': 398.15,
  '2025-11-25': 451.89,
  '2025-11-26': 419.72,
  '2025-11-27': 417.48,
  '2025-11-28': 413.43,
  '2025-11-29': 417.78,
  '2025-11-30': 357.84,
  '2025-12-01': 340.23,
  '2025-12-02': 365.84,
  '2025-12-03': 378.18,
  '2025-12-04': 362.53,
  '2025-12-05': 343,
  '2025-12-06': 341.04,
  '2025-12-07': 396.36,
  '2025-12-08': 421.93,
  '2025-12-09': 423.78,
  '2025-12-10': 422.04,
  '2025-12-11': 499.13,
  '2025-12-12': 479.77,
  '2025-12-13': 452.59,
  '2025-12-14': 479.03,
  '2025-12-15': 410.15,
  '2025-12-16': 466.77,
  '2025-12-17': 422.07,
  '2025-12-18': 394.48,
  '2025-12-19': 396.79,
  '2025-12-20': 389.37,
  '2025-12-21': 429.86,
  '2025-12-22': 458.92,
  '2025-12-23': 456.3,
  '2025-12-24': 427.32,
  '2025-12-25': 407.95,
  '2025-12-26': 448.03,
  '2025-12-27': 444.37,
  '2025-12-28': 446.31,
  '2025-12-29': 442.73,
  '2025-12-30': 460.65,
  '2025-12-31': 481.54,
  '2026-01-01': 523.58,
  '2026-01-02': 531.56,
  '2026-01-03': 455.96,
  '2026-01-04': 525.7,
  '2026-01-05': 390.06,
  '2026-01-06': 412.56,
  '2026-01-07': 395.88,
  '2026-01-08': 367.95,
  '2026-01-09': 405.89,
  '2026-01-10': 366,
  '2026-01-11': 404.33,
  '2026-01-12': 385.33,
  '2026-01-13': 384.87,
  '2026-01-14': 372.5,
  '2026-01-15': 392.4,
  '2026-01-16': 393.89,
  '2026-01-17': 374.45,
  '2026-01-18': 353.17,
  '2026-01-19': 387.5,
  '2026-01-20': 388.93,
  '2026-01-21': 387.21,
  '2026-01-22': 433.46,
  '2026-01-23': 401.35,
  '2026-01-24': 404.79,
  '2026-01-25': 357.16,
  '2026-01-26': 367.68,
  '2026-01-27': 395,
  '2026-01-28': 396.12,
  '2026-01-29': 395.37,
  '2026-01-30': 504.95,
  '2026-01-31': 428.5,
  '2026-02-01': 334.27,
  '2026-02-02': 314.42,
  '2026-02-03': 332.27,
  '2026-02-04': 346.45,
  '2026-02-05': 364.54,
  '2026-02-06': 340.45,
  '2026-02-07': 359.25,
  '2026-02-08': 318.14,
  '2026-02-09': 379.5,
  '2026-02-10': 399.22,
  '2026-02-11': 374.45,
  '2026-02-12': 353.27,
  '2026-02-13': 328.11,
  '2026-02-14': 301.31,
  '2026-02-15': 292.12,
  '2026-02-16': 366.92,
  '2026-02-17': 338.69,
  '2026-02-18': 369.08,
  '2026-02-19': 344.07,
  '2026-02-20': 327.52,
  '2026-02-21': 335.24,
  '2026-02-22': 346.25,
  '2026-02-23': 346.1,
  '2026-02-24': 387.67,
  '2026-02-25': 421,
  '2026-02-26': 421.7,
  '2026-02-27': 371.32,
  '2026-02-28': 336.3,
  '2026-03-01': 250.61,
  '2026-03-02': 229.88,
  '2026-03-03': 229.75,
  '2026-03-04': 236.15,
  '2026-03-05': 238.81,
  '2026-03-06': 210.48,
  '2026-03-07': 261.2,
  '2026-03-08': 228.95,
  '2026-03-09': 209,
  '2026-03-10': 209.29,
  '2026-03-11': 202.04,
  '2026-03-12': 256.7,
  '2026-03-13': 269.64,
  '2026-03-14': 267.57,
  '2026-03-15': 219.16,
  '2026-03-16': 233.96,
  '2026-03-17': 241.62,
  '2026-03-18': 239.7,
  '2026-03-19': 259.27,
  '2026-03-20': 319.09,
  '2026-03-21': 304.16,
  '2026-03-22': 227.5,
  '2026-03-23': 188.93,
  '2026-03-24': 201.46,
  '2026-03-25': 202.18,
  '2026-03-26': 217.81,
  '2026-03-27': 287.66,
  '2026-03-28': 295.53,
  '2026-03-29': 254.75,
  '2026-03-30': 292.5,
  '2026-03-31': 283.42,
  '2026-04-01': 396.6,
  '2026-04-02': 318,
  '2026-04-03': 315.17,
  '2026-04-04': 321.4,
  '2026-04-05': 305.08,
  '2026-04-06': 312.15,
  '2026-04-07': 282.52,
  '2026-04-08': 268.32,
  '2026-04-09': 290.85,
  '2026-04-10': 330.82,
  '2026-04-11': 345.76,
  '2026-04-12': 327.73,
  '2026-04-13': 287.68,
  '2026-04-14': 298.9,
  '2026-04-15': 297.27,
  '2026-04-16': 281.26,
  '2026-04-17': 322.55,
  '2026-04-18': 327.66,
  '2026-04-19': 333.84,
  '2026-04-20': 279.89,
  '2026-04-21': 298.19,
  '2026-04-22': 302.95,
  '2026-04-23': 332.31,
  '2026-04-24': 425.95,
  '2026-04-25': 401.67,
  '2026-04-26': 339.65,
  '2026-04-27': 391.03,
  '2026-04-28': 368.97,
  '2026-04-29': 364.12,
  '2026-04-30': 287.62,
  '2026-05-01': 356.01,
  '2026-05-02': 341.94,
  '2026-05-03': 286.35,
  '2026-05-04': 235.41,
  '2026-05-05': 246.27,
  '2026-05-06': 238.73,
  '2026-05-07': 333.4,
  '2026-05-08': 392.64,
  '2026-05-09': 393.36,
  '2026-05-10': 340.42,
  '2026-05-11': 233.44,
  '2026-05-12': 233.9,
  '2026-05-13': 274.96,
  '2026-05-14': 422.85,
  '2026-05-15': 424.14,
  '2026-05-16': 420.59,
  '2026-05-17': 367.44,
  '2026-05-18': 241.04,
  '2026-05-19': 238.33,
  '2026-05-20': 282.94,
  '2026-05-21': 367.84,
  '2026-05-22': 428.07,
  '2026-05-23': 420.62,
  '2026-05-24': 396.18,
  '2026-05-25': 350.62,
  '2026-05-26': 321.43,
  '2026-05-27': 338.6,
  '2026-05-28': 405.62,
  '2026-05-29': 464.12,
  '2026-05-30': 481.77,
  '2026-05-31': 439.44,
  '2026-06-01': 366.52,
  '2026-06-02': 378.03,
  '2026-06-03': 409.76,
  '2026-06-04': 460.27,
  '2026-06-05': 513.48,
  '2026-06-06': 511.87,
  '2026-06-07': 456.74,
  '2026-06-08': 433.63,
  '2026-06-09': 359.51,
  '2026-06-10': 378.82,
  '2026-06-11': 412.6,
  '2026-06-12': 433.31,
  '2026-06-13': 479.07,
  '2026-06-14': 470.67,
  '2026-06-15': 434.38,
  '2026-06-16': 448.47,
  '2026-06-17': 461.47,
  '2026-06-18': 481.71,
  '2026-06-19': 490.18,
  '2026-06-20': 511.87,
  '2026-06-21': 500.16,
  '2026-06-22': 501.23,
  '2026-06-23': 474.34,
  '2026-06-24': 494.87,
  '2026-06-25': 509.39,
  '2026-06-26': 495.12,
  '2026-06-27': 512.76,
  '2026-06-28': 489.95,
  '2026-06-29': 496.32,
  '2026-06-30': 506.88,
  '2026-07-01': 522.84,
  '2026-07-02': 536.31,
  '2026-07-03': 559.84,
  '2026-07-04': 559.42,
  '2026-07-05': 528.23,
  '2026-07-06': 489.75,
  '2026-07-07': 487.2,
  '2026-07-08': 494.8,
  '2026-07-09': 511.1,
  '2026-07-10': 539.43,
  '2026-07-11': 557.28,
  '2026-07-12': 541.98,
  '2026-07-13': 534.44,
  '2026-07-14': 527.43,
  '2026-07-15': 523.64,
  '2026-07-16': 551.59,
  '2026-07-17': 580.2,
  '2026-07-18': 574.98,
  '2026-07-19': 547.67,
  '2026-07-20': 514.94,
  '2026-07-21': 505.73,
  '2026-07-22': 508.82,
  '2026-07-23': 547.33,
  '2026-07-24': 562.17,
  '2026-07-25': 575.11,
  '2026-07-26': 560.94,
  '2026-07-27': 539.19,
  '2026-07-28': 537.31,
  '2026-07-29': 561.05,
  '2026-07-30': 562.88,
  '2026-07-31': 535.74,
  '2026-08-01': 557.25,
  '2026-08-02': 566.8,
  '2026-08-03': 556.9,
  '2026-08-04': 545.98,
  '2026-08-05': 547.03,
  '2026-08-06': 566.33,
  '2026-08-07': 575.95,
  '2026-08-08': 549.8,
  '2026-08-09': 570,
  '2026-08-10': 536.43,
  '2026-08-11': 533,
  '2026-08-12': 532.46,
  '2026-08-13': 567.64,
  '2026-08-14': 593.4,
  '2026-08-15': 603.99,
  '2026-08-16': 550.54,
  '2026-08-17': 533.53,
  '2026-08-18': 533.39,
  '2026-08-19': 540,
  '2026-08-20': 550.33,
  '2026-08-21': 533.87,
  '2026-08-22': 532.71,
  '2026-08-23': 520.66,
  '2026-08-24': 523.27,
  '2026-08-25': 513.19,
  '2026-08-26': 539.58,
  '2026-08-27': 551.33,
  '2026-08-28': 540,
  '2026-08-29': 528.21,
  '2026-08-30': 462.19,
  '2026-08-31': 419.58,
  '2026-09-01': 405.3,
  '2026-09-02': 417.91,
  '2026-09-03': 473.37,
  '2026-09-04': 540.26,
  '2026-09-05': 548.62,
  '2026-09-06': 530.66,
  '2026-09-07': 450.95,
  '2026-09-08': 381.29,
  '2026-09-09': 432.71,
  '2026-09-10': 509.8,
  '2026-09-11': 493.1,
  '2026-09-12': 496.56,
  '2026-09-13': 418.76,
  '2026-09-14': 366.09,
  '2026-09-15': 347.87,
};
// END GENERATED

/**
 * Holidays whose premium follows the calendar date rather than the weekday.
 * The weekday-anchored ones (Thanksgiving, Memorial Day, Labor Day, Columbus
 * Day, MLK, Presidents' Day, Patriots' Day) fall out of the 52-week shift on
 * their own: 364 days back lands on the same weekday one calendar day
 * earlier, which is where those holidays sat the year before.
 */
export const FIXED_DATE_HOLIDAYS: ReadonlySet<string> = new Set([
  '01-01', // New Year's Day
  '07-04', // Independence Day
  '10-31', // Halloween
  '12-24', // Christmas Eve
  '12-25', // Christmas Day
  '12-31', // New Year's Eve
]);

/** Week offsets tried around the 52-week (then 104-week) shift, nearest first. */
const WEEK_SEARCH = [0, 1, -1, 2, -2, 3, -3];

/** Nights a home needs on record before its own achieved index is trusted. */
export const MIN_INDEX_NIGHTS = 14;

/** Sanity band for an achieved index. */
export const INDEX_FLOOR = 0.4;
export const INDEX_CEILING = 4;

export function shiftDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The date in the series that stands in for `iso`.
 *
 * A fixed-date holiday looks up the same calendar date one year back, then
 * two. Everything else shifts 52 weeks, which preserves the weekday, and
 * widens to the neighbouring weeks (same weekday, up to three either side)
 * before trying 104 weeks back the same way. Null when nothing is covered.
 */
export function marketAnalogDate(
  iso: string,
  series: Record<string, number> = MARKET_RATE_BY_DAY,
): string | null {
  const candidates: string[] = [];
  const mmdd = iso.slice(5, 10);
  if (FIXED_DATE_HOLIDAYS.has(mmdd)) {
    const y = Number(iso.slice(0, 4));
    candidates.push(`${y - 1}-${mmdd}`, `${y - 2}-${mmdd}`);
  }
  for (const weeksBack of [52, 104]) {
    for (const k of WEEK_SEARCH) candidates.push(shiftDays(iso, -(weeksBack - k) * 7));
  }
  for (const c of candidates) if (series[c] != null) return c;
  return null;
}

/** Market rate for the night standing in for `iso`, or null when uncovered. */
export function marketRateFor(
  iso: string,
  series: Record<string, number> = MARKET_RATE_BY_DAY,
): number | null {
  const analog = marketAnalogDate(iso, series);
  return analog ? series[analog] : null;
}

/**
 * Mean market rate across a set of nights. `covered` says how many of them
 * the series could price; the mean is over those alone.
 */
export function meanMarketRate(
  dates: readonly string[],
  series: Record<string, number> = MARKET_RATE_BY_DAY,
): { rate: number | null; covered: number } {
  let sum = 0;
  let n = 0;
  for (const d of dates) {
    const r = marketRateFor(d, series);
    if (r != null) {
      sum += r;
      n += 1;
    }
  }
  return { rate: n > 0 ? sum / n : null, covered: n };
}

/**
 * The index a paced month prices its open nights with.
 *
 * A home's own bookings in that month are the best evidence of the premium
 * it commands that season, so when it has them, its achieved ADR in the month
 * over the market analog of the nights it has booked leads, weighted by how
 * many nights that rests on (full weight at MIN_INDEX_NIGHTS). The
 * trailing-year index fills the rest: it is summer-weighted for a fleet that
 * has no winter on record, and a waterfront home that clears 3x market in
 * August does not clear 3x in December. With no month evidence the year
 * index stands alone; with neither, null.
 */
export function blendRateIndex(args: {
  yearIndex: number | null;
  monthAdr: number | null;
  monthMarketRate: number | null;
  monthNights: number;
}): number | null {
  const { yearIndex, monthAdr, monthMarketRate, monthNights } = args;
  const monthIndex =
    monthAdr != null && monthAdr > 0 && monthMarketRate != null && monthMarketRate > 0
      ? Math.min(INDEX_CEILING, Math.max(INDEX_FLOOR, monthAdr / monthMarketRate))
      : null;
  if (monthIndex == null) return yearIndex;
  if (yearIndex == null) return monthIndex;
  const w = Math.min(1, Math.max(0, monthNights) / MIN_INDEX_NIGHTS);
  return w * monthIndex + (1 - w) * yearIndex;
}

/**
 * A home's achieved revenue per booked night over the market rate on the
 * same nights: the scale that turns a market night into one of this home's.
 * Revenue-weighted (sum over sum), so a $1,200 Saturday counts for what it
 * earned. Only nights the series covers directly count; fewer than
 * `minNights` returns null so the caller can fall back to the fleet.
 * Clamped to [INDEX_FLOOR, INDEX_CEILING].
 */
export function achievedRateIndex(
  nights: ReadonlyArray<{ date: string; nightly: number }>,
  series: Record<string, number> = MARKET_RATE_BY_DAY,
  minNights: number = MIN_INDEX_NIGHTS,
): number | null {
  let earned = 0;
  let market = 0;
  let n = 0;
  for (const night of nights) {
    const m = series[night.date];
    if (m == null || m <= 0 || !(night.nightly > 0)) continue;
    earned += night.nightly;
    market += m;
    n += 1;
  }
  if (n < minNights || market <= 0) return null;
  return Math.min(INDEX_CEILING, Math.max(INDEX_FLOOR, earned / market));
}
