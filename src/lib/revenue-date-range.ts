/**
 * Date-range presets for the Revenue module. Ported from Perfection's
 * `dateRangeUtils.ts` and adapted for server-side use (no em dashes in labels;
 * pure functions with no React).
 *
 * Range semantics: rangeStart and rangeEnd are inclusive YYYY-MM-DD strings,
 * both in local time. The snapshot logic treats reservations whose stays
 * overlap [rangeStart, rangeEnd] as eligible.
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

function todayLocal(): string {
  const today = new Date();
  const tz = today.getTimezoneOffset();
  return new Date(today.getTime() - tz * 60_000).toISOString().split('T')[0];
}

function fmt(date: Date): string {
  const tz = date.getTimezoneOffset();
  return new Date(date.getTime() - tz * 60_000).toISOString().split('T')[0];
}

function firstOfMonth(year: number, month: number): string {
  return fmt(new Date(year, month, 1));
}

function lastOfMonth(year: number, month: number): string {
  return fmt(new Date(year, month + 1, 0));
}

export function computeDateRange(
  preset: RangePreset,
  customMonth?: CustomMonth,
  customRange?: CustomRange,
): DateRange {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case 'mtd':
      return { rangeStart: firstOfMonth(y, m), rangeEnd: todayLocal() };

    case 'last_30': {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { rangeStart: fmt(start), rangeEnd: todayLocal() };
    }

    case 'last_90': {
      const start = new Date(now);
      start.setDate(start.getDate() - 90);
      return { rangeStart: fmt(start), rangeEnd: todayLocal() };
    }

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

    case 'next_90': {
      const end = new Date(now);
      end.setDate(end.getDate() + 90);
      return { rangeStart: todayLocal(), rangeEnd: fmt(end) };
    }

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
      return computeDateRange('mtd');
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
    case 'full_year': return `Full Year ${new Date().getFullYear()}`;
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
  const s = new Date(rangeStart + 'T00:00:00');
  const e = new Date(rangeEnd + 'T00:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
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
