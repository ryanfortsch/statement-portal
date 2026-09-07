/**
 * Date-range presets for the Revenue module. Ported from Perfection's
 * `dateRangeUtils.ts` and adapted for server-side use (no em dashes in labels;
 * pure functions with no React).
 *
 * Range semantics: rangeStart and rangeEnd are inclusive YYYY-MM-DD strings.
 * The snapshot logic treats reservations whose stays overlap
 * [rangeStart, rangeEnd] as eligible.
 *
 * WHAT "TODAY" MEANS HERE. Every preset that depends on the current date
 * resolves it in America/New_York, not on the server clock. Vercel runs in
 * UTC, so from 8pm ET onward the server has already rolled to tomorrow. At a
 * month boundary that silently switched "This Month" to the next one four or
 * five hours early, on exactly the evening someone is closing the month. The
 * calendar arithmetic underneath is UTC-anchored for the same reason the
 * nightsBetween helper below is: a date string is a calendar fact and should
 * not shift with a server's zone.
 */

export type RangePreset =
  | 'mtd'
  | 'last_30'
  | 'last_90'
  | 'this_month'
  | 'last_month'
  | 'next_month'
  | 'next_90'
  | 'ytd'
  | 'full_year'
  | 'custom_month'
  | 'custom_range';

export type DateRange = {
  rangeStart: string;
  rangeEnd: string;
};

export type CustomMonth = {
  year: number;
  month: number; // 0-indexed (0 = January, 11 = December)
};

export type CustomRange = {
  startDate: string;
  endDate: string;
};

const EASTERN_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

/**
 * The calendar date in Gloucester at a given instant, YYYY-MM-DD.
 *
 * Exported because it is the whole fix: an instant is not a date until you
 * name a zone, and the zone that matters is the one the operator is standing
 * in. 2026-09-01T02:00:00Z is September 1st to the server and still
 * August 31st, 10pm, to Dotti.
 */
export function easternDateStr(instant: Date): string {
  return EASTERN_DATE_FMT.format(instant);
}

/** Shift a YYYY-MM-DD calendar date by whole days. UTC-anchored, so it cannot
 *  drift across a DST boundary the way local-time arithmetic does. */
export function shiftDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function firstOfMonth(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

export function lastOfMonth(year: number, month: number): string {
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
}

export function computeDateRange(
  preset: RangePreset,
  customMonth?: CustomMonth,
  customRange?: CustomRange,
  /** The instant to resolve "today" from. Injected by tests; production never
   *  passes it, and must not: the default is what makes the date Eastern. */
  now: Date = new Date(),
): DateRange {
  const today = easternDateStr(now);
  const [y, m1] = today.split('-').map(Number);
  const m = m1 - 1; // 0-indexed, matching CustomMonth and the helpers above
  const todayLocal = () => today;

  switch (preset) {
    case 'mtd':
      return { rangeStart: firstOfMonth(y, m), rangeEnd: todayLocal() };

    case 'last_30':
      return { rangeStart: shiftDays(today, -30), rangeEnd: todayLocal() };

    case 'last_90':
      return { rangeStart: shiftDays(today, -90), rangeEnd: todayLocal() };

    case 'this_month':
      return { rangeStart: firstOfMonth(y, m), rangeEnd: lastOfMonth(y, m) };

    case 'last_month': {
      const py = m === 0 ? y - 1 : y;
      const pm = m === 0 ? 11 : m - 1;
      return { rangeStart: firstOfMonth(py, pm), rangeEnd: lastOfMonth(py, pm) };
    }

    case 'next_month': {
      const ny = m === 11 ? y + 1 : y;
      const nm = m === 11 ? 0 : m + 1;
      return { rangeStart: firstOfMonth(ny, nm), rangeEnd: lastOfMonth(ny, nm) };
    }

    case 'next_90':
      return { rangeStart: todayLocal(), rangeEnd: shiftDays(today, 90) };

    case 'ytd':
      return { rangeStart: `${y}-01-01`, rangeEnd: todayLocal() };

    case 'full_year':
      return { rangeStart: `${y}-01-01`, rangeEnd: `${y}-12-31` };

    case 'custom_month': {
      const cm = customMonth ?? { year: y, month: m };
      return { rangeStart: firstOfMonth(cm.year, cm.month), rangeEnd: lastOfMonth(cm.year, cm.month) };
    }

    case 'custom_range':
      return customRange
        ? { rangeStart: customRange.startDate, rangeEnd: customRange.endDate }
        : { rangeStart: firstOfMonth(y, m), rangeEnd: lastOfMonth(y, m) };

    default:
      return computeDateRange('mtd', undefined, undefined, now);
  }
}

export function presetLabel(preset: RangePreset, customMonth?: CustomMonth): string {
  switch (preset) {
    case 'mtd': return 'Month to Date';
    case 'last_30': return 'Last 30 Days';
    case 'last_90': return 'Last 90 Days';
    case 'this_month': return 'This Month';
    case 'last_month': return 'Last Month';
    case 'next_month': return 'Next Month';
    case 'next_90': return 'Next 90 Days';
    case 'ytd': return 'Year to Date';
    case 'full_year': return `Full Year ${easternDateStr(new Date()).slice(0, 4)}`;
    case 'custom_month':
      if (customMonth) {
        const d = new Date(customMonth.year, customMonth.month, 1);
        return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      }
      return 'Custom Month';
    case 'custom_range': return 'Custom Range';
    default: return 'Month to Date';
  }
}

export function formatRangeLabel(rangeStart: string, rangeEnd: string): string {
  // UTC anchor + UTC formatting: the strings are calendar dates already, and
  // reading them back through a server zone is how "Sep 1" prints as "Aug 31".
  const s = new Date(rangeStart + 'T00:00:00Z');
  const e = new Date(rangeEnd + 'T00:00:00Z');
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  };
  return `${s.toLocaleDateString('en-US', opts)} to ${e.toLocaleDateString('en-US', opts)}`;
}

export function isValidDateRange(start: string, end: string): boolean {
  return new Date(start) <= new Date(end);
}

/** Inclusive nights between two YYYY-MM-DD strings (UTC anchor for stability). */
export function nightsBetween(startStr: string, endStr: string): number {
  const start = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** Day after `dateStr`, formatted YYYY-MM-DD. Used for inclusive→exclusive end. */
export function dayAfter(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

/**
 * Detect whether a range is exactly one calendar month (first of month
 * through last day). Returns the 0-indexed month and year when so, else
 * null. Used by previousRange + the snapshot lib to switch between
 * sliding-window and calendar-month semantics.
 */
export function exactCalendarMonth(range: DateRange): { year: number; month: number } | null {
  const start = new Date(range.rangeStart + 'T00:00:00Z');
  const end = new Date(range.rangeEnd + 'T00:00:00Z');
  if (start.getUTCDate() !== 1) return null;
  if (end.getUTCMonth() !== start.getUTCMonth()) return null;
  if (end.getUTCFullYear() !== start.getUTCFullYear()) return null;
  const lastDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate();
  if (end.getUTCDate() !== lastDay) return null;
  return { year: start.getUTCFullYear(), month: start.getUTCMonth() };
}

/**
 * The prior period for delta comparisons.
 *
 * - When `range` is exactly one calendar month (e.g. May 1 to May 31),
 *   prior is the previous calendar month exactly (April 1 to April 30).
 *   This matches "vs last month" intuition and lines up with what the
 *   Statements module reports.
 * - Otherwise, prior is the same-length window immediately preceding
 *   `range` (e.g. Last 30 Days -> the 30 days before that).
 */
export function previousRange(range: DateRange): DateRange {
  const cal = exactCalendarMonth(range);
  if (cal) {
    const py = cal.month === 0 ? cal.year - 1 : cal.year;
    const pm = cal.month === 0 ? 11 : cal.month - 1;
    return { rangeStart: firstOfMonth(py, pm), rangeEnd: lastOfMonth(py, pm) };
  }

  const start = new Date(range.rangeStart + 'T00:00:00Z');
  const end = new Date(range.rangeEnd + 'T00:00:00Z');
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (days - 1));

  return {
    rangeStart: prevStart.toISOString().split('T')[0],
    rangeEnd: prevEnd.toISOString().split('T')[0],
  };
}

/**
 * Day-count of a month (1-12, year). Wrapper so callers don't have to
 * recreate the new-Date dance.
 */
export function daysInMonth(year: number, oneIndexedMonth: number): number {
  return new Date(year, oneIndexedMonth, 0).getDate();
}

/**
 * Percentage change from `prev` to `curr`. Returns null when prev is
 * zero or null (no baseline to compare against).
 */
export function deltaPct(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}
