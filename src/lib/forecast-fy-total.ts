/**
 * Making /forecast's totals column a real fiscal year.
 *
 * The per-property table projects the months still AHEAD, because closed
 * months are carried by the Monthly Detail table instead. Its totals column
 * therefore summed four months of twelve on the current-year tab and called
 * itself "FY total": $144.5k of a 2026 tracking near $339k, with 4 Brier Neck
 * reading as a dash because every dollar it earned this year sat behind the
 * left edge.
 *
 * The fix is not a better label, it is the missing half of the year. Closed
 * statements supply a year-to-date actual per property, the forward months
 * supply the projection, and the two tile the year exactly: the statement
 * loaders exclude the in-progress month and `forwardMonths()` starts at it,
 * so there is no gap and no double count.
 *
 * `coversYear` is the invariant that entitles the column to say "FY total".
 * When the two halves do not tile twelve months of the year, the caller is
 * expected to label the span instead of overclaiming.
 *
 * ACTUALS ARE NOT THE SAME AS MONTHS. A month can be closed and still carry
 * no statement, which is true of January to March 2026: Helm's statements
 * begin in April. `monthsWithActuals` reports what the money actually covers
 * so the surface can say so rather than implying a complete year.
 *
 * Pure. No I/O, no imports. Unit-tested in
 * src/lib/__tests__/forecast-fy-total.test.ts.
 */

export type YtdSummary = {
  /** Months of the year already closed, whether or not they carry statements. */
  closedMonths: string[];
  /** Of those, the ones some property actually filed a statement for. */
  monthsWithActuals: string[];
  /**
   * property_id -> its closed-statement management fee for the year.
   *
   * A plain object rather than a Map on purpose: this summary is built on the
   * server and handed to a client component, and a plain object is
   * unambiguously serializable across that boundary.
   */
  byProperty: Record<string, number>;
  /** Fleet year-to-date management fee. */
  total: number;
  /**
   * Whether the closed months and the forward months together tile twelve
   * distinct months of `year`. Only then is a combined total a fiscal year.
   */
  coversYear: boolean;
};

/**
 * Roll closed-statement fees up into a year-to-date figure per property, and
 * report whether it plus the forward months add up to a whole year.
 *
 * `closedMonths` and `forwardMonths` are both YYYY-MM. Months outside `year`
 * are ignored on both sides, so a caller can hand in an unfiltered list.
 */
export function summarizeYtd(
  feeByProperty: ReadonlyMap<string, ReadonlyMap<string, number>>,
  closedMonths: readonly string[],
  forwardMonths: readonly string[],
  year: number,
): YtdSummary {
  const prefix = `${year}-`;
  const closed = [...new Set(closedMonths.filter((m) => m.startsWith(prefix)))].sort();
  const forward = [...new Set(forwardMonths.filter((m) => m.startsWith(prefix)))].sort();

  const byProperty: Record<string, number> = {};
  const withActuals = new Set<string>();
  let total = 0;
  for (const [propertyId, months] of feeByProperty) {
    let sum = 0;
    for (const m of closed) {
      const fee = months.get(m);
      if (fee == null || !(fee > 0)) continue;
      sum += fee;
      withActuals.add(m);
    }
    if (sum > 0) {
      byProperty[propertyId] = sum;
      total += sum;
    }
  }

  // Twelve DISTINCT months, so an overlap between the two halves cannot pass
  // as a full year by arithmetic alone. An overlap would double count, which
  // is the one failure worse than the truncation this replaces.
  const union = new Set([...closed, ...forward]);
  const coversYear = union.size === 12 && closed.length + forward.length === 12;

  return {
    closedMonths: closed,
    monthsWithActuals: [...withActuals].sort(),
    byProperty,
    total,
    coversYear,
  };
}

/** Month-of-year label for a YYYY-MM, e.g. "Apr". Empty string if unparseable. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthLabel(ym: string): string {
  const m = parseInt(ym.slice(5, 7), 10);
  return m >= 1 && m <= 12 ? MONTHS[m - 1] : '';
}

/**
 * "Apr to Aug", "Aug", or "" for nothing. What the year-to-date column's
 * tooltip says its money actually covers, which is not always every closed
 * month.
 */
export function describeMonths(months: readonly string[]): string {
  if (months.length === 0) return '';
  const first = monthLabel(months[0]);
  const last = monthLabel(months[months.length - 1]);
  return first === last ? first : `${first} to ${last}`;
}
