/**
 * Which week the cleaner's schedule page (/c/<token>) shows.
 *
 * The page renders one week at a time, starting today. `?d=<date>` used to
 * be honoured only inside that first week, so a cleaner could never look
 * past next Sunday: any later date silently snapped back to today. Now the
 * page pages forward in whole weeks anchored on today, out to a horizon, and
 * `?d=` selects a day in whichever week holds it.
 *
 * Pure date math, no imports, so the test can run without the app.
 */

export const CLEANER_WINDOW_DAYS = 7;
/** How far ahead a cleaner may page. Bookings land a season out; a year
 *  covers next summer without letting a link ask for an unbounded range. */
export const CLEANER_HORIZON_DAYS = 365;

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
}

function plusDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A real calendar date in YYYY-MM-DD, or null. Rejects 2026-02-31. */
export function parseScheduleDate(raw: string | undefined | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const t = Date.parse(`${raw}T12:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === raw ? raw : null;
}

export type CleanerWindow = {
  /** First day of the week shown. */
  start: string;
  /** The requested day, when it is inside [today, horizon]; else null and
   *  the page picks its own default within the first week. */
  requested: string | null;
  /** First day of the previous / next week, or null at either end. */
  prevStart: string | null;
  nextStart: string | null;
};

export function cleanerWindow(today: string, raw: string | undefined | null): CleanerWindow {
  const horizon = plusDays(today, CLEANER_HORIZON_DAYS);
  const parsed = parseScheduleDate(raw);
  // Past days and days beyond the horizon fall back to the first week.
  const requested = parsed && parsed >= today && parsed <= horizon ? parsed : null;
  const offset = requested ? dayNumber(requested) - dayNumber(today) : 0;
  const start = plusDays(today, Math.floor(offset / CLEANER_WINDOW_DAYS) * CLEANER_WINDOW_DAYS);
  const prev = plusDays(start, -CLEANER_WINDOW_DAYS);
  const next = plusDays(start, CLEANER_WINDOW_DAYS);
  return {
    start,
    requested,
    prevStart: start > today ? (prev < today ? today : prev) : null,
    nextStart: next <= horizon ? next : null,
  };
}
