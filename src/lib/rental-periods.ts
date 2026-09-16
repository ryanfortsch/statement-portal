/**
 * When a property is open for rental.
 *
 * A home is not always sellable inventory. Some go dark for the winter, some
 * come back for a holiday week, some are year-round. Guesty calendar blocks
 * cannot answer this: an owner who never blocks the dark months looks open,
 * which is how /revenue came to project a December for homes that do not
 * rent in December.
 *
 * So the periods are knowledge Helm holds, per property, edited on the
 * property page. Each period is a RECURRING open window in month-day terms
 * (May 1 to October 31), not a dated range, because the season repeats. A
 * window whose start falls after its end wraps the year (November 1 to
 * April 30).
 *
 * **No periods means open year-round.** That is the default for every home
 * that has never been stamped, so adding this table changed nothing until an
 * operator says otherwise.
 *
 * Pure. No I/O, no imports. Unit-tested in
 * src/lib/__tests__/rental-periods.test.ts.
 */

export type RentalPeriod = {
  /** 1-12. */
  startMonth: number;
  /** 1-31. */
  startDay: number;
  /** 1-12. */
  endMonth: number;
  /** 1-31, inclusive: an end of Oct 31 means the 31st is still rentable. */
  endDay: number;
  note?: string | null;
};

/** A stored period, with the id the editor needs to replace or drop it. */
export type RentalPeriodRow = RentalPeriod & { id: string };

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Sortable month-day key. Feb 29 sits where it belongs between Feb 28 and Mar 1. */
function mdKey(month: number, day: number): number {
  return month * 100 + day;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

/** Coerce a stored row into a usable period, clamping nonsense into range. */
export function normalizePeriod(raw: {
  startMonth: unknown;
  startDay: unknown;
  endMonth: unknown;
  endDay: unknown;
  note?: string | null;
}): RentalPeriod {
  return {
    startMonth: clampInt(raw.startMonth, 1, 12, 1),
    startDay: clampInt(raw.startDay, 1, 31, 1),
    endMonth: clampInt(raw.endMonth, 1, 12, 12),
    endDay: clampInt(raw.endDay, 1, 31, 31),
    note: raw.note ?? null,
  };
}

/** Whether one period covers a given month-day. Handles the year wrap. */
function periodCovers(p: RentalPeriod, month: number, day: number): boolean {
  const key = mdKey(month, day);
  const start = mdKey(p.startMonth, p.startDay);
  const end = mdKey(p.endMonth, p.endDay);
  // A window that starts after it ends runs through New Year: Nov 1 -> Apr 30
  // is open in December and in March, closed in June.
  if (start > end) return key >= start || key <= end;
  return key >= start && key <= end;
}

/**
 * Is the property open for rental on this date?
 *
 * **An empty list means open**, which is what keeps every un-stamped home
 * behaving exactly as it did before rental periods existed.
 */
export function isOpenOn(periods: readonly RentalPeriod[], iso: string): boolean {
  if (periods.length === 0) return true;
  const month = parseInt(iso.slice(5, 7), 10);
  const day = parseInt(iso.slice(8, 10), 10);
  if (!month || !day) return true;
  return periods.some((p) => periodCovers(p, month, day));
}

/** The subset of `dates` the property is open for. */
export function openDatesOf(periods: readonly RentalPeriod[], dates: readonly string[]): string[] {
  if (periods.length === 0) return [...dates];
  return dates.filter((d) => isOpenOn(periods, d));
}

/**
 * Nights in [startIso, endExclusiveIso) the property is open for rental.
 * The denominator a month's occupancy target is taken against: a home shut
 * for half of November can only fill the half it is open.
 */
export function countOpenNights(
  periods: readonly RentalPeriod[],
  startIso: string,
  endExclusiveIso: string,
): number {
  if (startIso >= endExclusiveIso) return 0;
  let n = 0;
  const cursor = new Date(startIso + 'T00:00:00Z');
  const end = new Date(endExclusiveIso + 'T00:00:00Z');
  while (cursor < end) {
    if (isOpenOn(periods, cursor.toISOString().slice(0, 10))) n += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return n;
}

/** Is the property shut for every night of this month? */
export function isClosedAllMonth(
  periods: readonly RentalPeriod[],
  year: number,
  monthOneBased: number,
): boolean {
  if (periods.length === 0) return false;
  const days = new Date(year, monthOneBased, 0).getDate();
  for (let d = 1; d <= days; d++) {
    if (periods.some((p) => periodCovers(p, monthOneBased, d))) return false;
  }
  return true;
}

/** "May 1 to Oct 31", "Open year-round", or several windows joined. */
export function describePeriods(periods: readonly RentalPeriod[]): string {
  if (periods.length === 0) return 'Open year-round';
  return periods
    .map(
      (p) =>
        `${MONTH_NAMES[p.startMonth - 1]} ${p.startDay} to ${MONTH_NAMES[p.endMonth - 1]} ${p.endDay}`,
    )
    .join(', ');
}
