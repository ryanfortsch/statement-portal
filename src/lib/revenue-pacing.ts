/**
 * The pacing projection: what a current or future month looks like once its
 * booked-so-far nights are carried toward the historical occupancy benchmark
 * and the nights still open are priced at the market's rate for those dates.
 *
 * Pure. No I/O, no imports. Unit-tested in
 * src/lib/__tests__/revenue-pacing.test.ts.
 *
 * The multiplier is an OCCUPANCY RATIO, built in revenue-snapshot.ts as
 * historical-benchmark-% / booked-so-far-%, floored at 1 and capped late in
 * the current month by what the remaining days can absorb. It answers one
 * question, how many more nights will fill, and everything else here derives
 * from those added nights:
 *
 *   added nights   = booked calendar nights × (multiplier − 1), never more
 *                    than the nights still open
 *   added revenue  = added nights × the open-night rate. revenue-snapshot
 *                    builds that from market-rate-by-day: last year's market
 *                    rate for the same weekday and holiday, scaled by the
 *                    home's achieved premium over market
 *   added stays    = added nights / the home's length of stay
 *   added cleaning = added stays × cleaning per stay
 *
 * Two earlier shapes of this projection are why it is written this way. The
 * first lifted revenue alone, so ADR read high by the multiplier. The second
 * scaled every booked figure by the multiplier, which held ADR steady but
 * priced every projected night at the BOOKED ADR, and what is booked early
 * for an off-season month is the premium inventory: a November 8% booked at
 * $608/night projected the other 27 points of occupancy at $608 too, and
 * reported a Rising Tide fee equal to September's. Nights are also one figure
 * now. A projected night is a physical night and a sold night in the same
 * month; scaling checkout-attributed nights by a calendar-night ratio had put
 * October's nights under November's ADR.
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

/** What a projected night is worth and what it drags along. */
export type PacingPricing = {
  /**
   * Expected revenue for one added night. Null when the market series has no
   * analog for the month's open nights; the added nights then price at the
   * booked ADR, the pre-market behaviour and the best figure left.
   */
  openNightRate: number | null;
  /**
   * Nights per projected stay. Zero or less falls back to the booked month's
   * own length of stay; with no stays booked either, no stays are projected.
   */
  avgStayNights: number;
  /** Cleaning cost per projected stay. */
  cleaningPerStay: number;
  /**
   * Nights still open in the month. The projection can never add more than
   * exist. Null leaves it uncapped.
   */
  openNights: number | null;
};

const NOTHING: MonthContribution = { revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 0 };

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
  pricing: PacingPricing,
): MonthContribution {
  const lift = multiplier > 1 ? multiplier - 1 : 0;
  if (lift === 0 || booked.calendarNights <= 0) return { ...NOTHING };

  let addedNights = booked.calendarNights * lift;
  if (pricing.openNights != null) addedNights = Math.min(addedNights, Math.max(0, pricing.openNights));
  if (addedNights <= 0) return { ...NOTHING };

  const bookedAdr = booked.nights > 0 ? booked.revenue / booked.nights : 0;
  const rate = pricing.openNightRate ?? bookedAdr;
  const stayLength =
    pricing.avgStayNights > 0
      ? pricing.avgStayNights
      : booked.stays > 0
      ? booked.nights / booked.stays
      : 0;
  const addedStays = stayLength > 0 ? addedNights / stayLength : 0;

  return {
    revenue: addedNights * rate,
    nights: addedNights,
    stays: addedStays,
    cleaning: addedStays * Math.max(0, pricing.cleaningPerStay),
    calendarNights: addedNights,
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
