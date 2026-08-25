/**
 * Interval arithmetic for the reservation gap backfill: turning a set of sold
 * calendar days and a set of known reservations into the runs of nights that
 * are sold with nothing on file.
 *
 * Every date here is a plain YYYY-MM-DD calendar day and every stay is the
 * half-open interval [check_in, check_out) -- the checkout morning is not a
 * night. Arithmetic is UTC-anchored so a local DST shift can never move a day
 * boundary and invent or swallow a night.
 *
 * Deliberately dependency-free so it can be exercised directly by
 * scripts/booked_runs_check.mjs without a database or a bundler, the same way
 * paged-select.ts is. The edge cases it has to get right are load-bearing:
 * back-to-back stays share no gap day, so a single run of missing nights can
 * stand for more than one missing reservation, and a one-night gap between two
 * known stays is a real, separate booking rather than an off-by-one.
 */

export type BookedRun = {
  property_id: string;
  check_in: string;
  /** Exclusive, i.e. the morning the guest leaves. */
  check_out: string;
  nights: number;
};

/** A calendar day n days after `iso`. UTC-anchored; DST cannot shift it. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** True when [aIn, aOut) and [bIn, bOut) share at least one night. */
export function staysOverlap(aIn: string, aOut: string, bIn: string, bOut: string): boolean {
  return aIn < bOut && bIn < aOut;
}

/** Every night a stay occupies. The checkout day is excluded. */
export function expandNights(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const end = checkOut.slice(0, 10);
  // Guard against a reversed or absurd interval turning this into a hang.
  for (let d = checkIn.slice(0, 10); d < end && out.length < 3660; d = addDays(d, 1)) {
    out.push(d);
  }
  return out;
}

/**
 * Sold nights with no reservation behind them, collapsed into consecutive
 * runs. Each run is reported as a stay: check_in on the first missing night,
 * check_out on the morning after the last one.
 */
export function uncoveredRuns(
  propertyId: string,
  bookedDates: Iterable<string>,
  coveredNights: ReadonlySet<string>,
): BookedRun[] {
  const gaps = [...new Set(bookedDates)].filter((d) => !coveredNights.has(d)).sort();
  const runs: BookedRun[] = [];
  let start: string | null = null;
  let prev = '';
  let nights = 0;

  for (const day of gaps) {
    if (start !== null && day === addDays(prev, 1)) {
      prev = day;
      nights += 1;
      continue;
    }
    if (start !== null) {
      runs.push({ property_id: propertyId, check_in: start, check_out: addDays(prev, 1), nights });
    }
    start = day;
    prev = day;
    nights = 1;
  }
  if (start !== null) {
    runs.push({ property_id: propertyId, check_in: start, check_out: addDays(prev, 1), nights });
  }
  return runs;
}
