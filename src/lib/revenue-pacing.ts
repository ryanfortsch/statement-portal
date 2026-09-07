/**
 * The pacing projection: what a current or future month looks like once its
 * booked-so-far figures are carried toward the historical occupancy benchmark.
 *
 * Pure. No I/O, no imports. Unit-tested in
 * src/lib/__tests__/revenue-pacing.test.ts.
 *
 * The multiplier driving all of this is an OCCUPANCY RATIO, built in
 * revenue-snapshot.ts as historical-benchmark-% / booked-so-far-%, floored at
 * 1 and capped late in the month by what the remaining days can plausibly
 * absorb. That origin is the whole reason this module exists. Because the
 * multiplier says "this many more nights will fill", every figure the month
 * contributes has to move with it. The projection used to lift revenue alone,
 * which asserted the opposite -- that the same nights would sell for more --
 * so ADR (revenue / nights) read high by the multiplier while Stays and
 * Occupancy sat frozen at booked-so-far.
 */

/** The figures one month contributes, before or after projection. */
export type MonthContribution = {
  /** Checkout-attributed dollars. */
  revenue: number;
  /** Checkout-attributed nights. The denominator under ADR. */
  nights: number;
  /** Stays checking out in the month. */
  stays: number;
  /** Cleaning those stays cost. */
  cleaning: number;
  /**
   * Physical nights occupied during the month. The numerator under occupancy,
   * and not interchangeable with `nights`: a stay crossing month-end counts
   * its calendar nights here while its whole revenue lands on the checkout
   * month.
   */
  calendarNights: number;
};

/**
 * How much a paced month ADDS to each figure. Deltas rather than totals,
 * because the caller layers three kinds of month (statement, paced, booked)
 * onto one base snapshot.
 *
 * A multiplier at or below 1 adds nothing. That is what keeps the Actuals
 * view, every past month and every unpaced month byte-identical to booked.
 */
export function pacedMonthLift(
  booked: MonthContribution,
  multiplier: number,
): MonthContribution {
  const lift = multiplier > 1 ? multiplier - 1 : 0;
  return {
    revenue: booked.revenue * lift,
    nights: booked.nights * lift,
    stays: booked.stays * lift,
    cleaning: booked.cleaning * lift,
    calendarNights: booked.calendarNights * lift,
  };
}

/**
 * Project one property's occupancy, and report the calendar nights that
 * projection actually consumed.
 *
 * The cap earns its keep twice. A home already near full cannot absorb a
 * portfolio-wide lift, so its own figure stops at 100%. And the portfolio
 * rollup sums `nightsUsed` rather than the raw delta, so the headline stays
 * the aggregate of the cards instead of drifting past them on capped homes.
 */
export function projectOccupancy(args: {
  /** Physical nights occupied in range, booked so far. */
  bookedCalendarNights: number;
  /** Calendar nights the projection adds. Zero or less means no projection. */
  calendarNightsDelta: number;
  /** Calendar nights available in range, less owner blocks. */
  bookableNights: number;
  /** The base pass's figure, returned untouched when nothing is projected. */
  bookedOccupancyPct: number | null;
}): { occupancyPct: number | null; nightsUsed: number } {
  const { bookedCalendarNights, calendarNightsDelta, bookableNights, bookedOccupancyPct } = args;

  if (calendarNightsDelta <= 0) {
    return { occupancyPct: bookedOccupancyPct, nightsUsed: bookedCalendarNights };
  }

  const projected = bookedCalendarNights + calendarNightsDelta;
  const nightsUsed = bookableNights > 0 ? Math.min(bookableNights, projected) : projected;
  const occupancyPct =
    bookableNights > 0 ? Math.min(100, (nightsUsed / bookableNights) * 100) : bookedOccupancyPct;

  return { occupancyPct, nightsUsed };
}
