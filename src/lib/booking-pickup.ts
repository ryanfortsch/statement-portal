/**
 * How much of a month is still to book.
 *
 * The pacing projection had one estimator: pull a month up toward the
 * occupancy benchmark. That answers "are we behind the market" and nothing
 * else, so a month ALREADY past its benchmark projected no further and the
 * page implicitly claimed it would finish exactly where it stood. On
 * 2026-09-18 that was September: 284 nights booked, twelve days left, and a
 * forecast that said 284.
 *
 * Rising Tide books late. Measured on its own closed months, roughly a
 * fourteenth of a month's final nights arrive after the eighteenth of that
 * month. So there is a second floor, independent of the market: whatever is
 * on the books now, divided by the share of a month that is normally on the
 * books by this day. The projection takes the HIGHER of the two floors,
 * because they answer different questions and a month can be behind the
 * market and still picking up, or ahead of the market and still picking up.
 *
 * Measured, never assumed. `guesty_reservations.booked_at` carries the date a
 * reservation was made, populated from June 2026 onward, so the curve is
 * rebuilt from closed months on every load rather than hardcoded.
 *
 * SEASONALITY. A booking curve is seasonal: a summer month fills earlier than
 * a shoulder month. So the curve prefers months of the SAME month-of-year and
 * only pools across months when it has none, mirroring how
 * forecast-calibration.ts prefers a month's own measured ratio over its
 * fallback. Today there is no same-month history at all (booked_at starts
 * June 2026), so every measurement is pooled and the pooled months are peak
 * summer. Treat a shoulder-month pickup as the weaker of the two floors until
 * a year of history exists; the structure is here so it improves on its own.
 *
 * WHAT THE SHARE IS NOT. `finalNights` is the nights a month actually sold,
 * not its sellable inventory, so a share is a fraction of a month's own book
 * and never an occupancy. It is also net of cancellations: a stay cancelled
 * after booking is absent from both sides today, which leans the share high
 * and the pickup conservative. There is no cancelled_at column to reconstruct
 * the live-at-day-D set, so this is stated rather than corrected.
 *
 * Pure. No I/O, no imports. Unit-tested in
 * src/lib/__tests__/booking-pickup.test.ts.
 */

/** One stay, reduced to what the curve needs. */
export type PickupStay = {
  /** YYYY-MM-DD. */
  checkIn: string;
  /** YYYY-MM-DD, exclusive. */
  checkOut: string;
  /** YYYY-MM-DD the reservation was made, or null if unknown. */
  bookedAt: string | null;
  /**
   * When the home came onto the program, or null if it predates the registry.
   * The pacing ratio this curve divides into counts only nights from a home's
   * activation, so a month a home was live for only part of must not
   * contribute to the curve either.
   */
  activatedAt?: string | null;
};

/** What one closed month contributed to the curve. */
export type PickupMonth = {
  /** YYYY-MM. */
  month: string;
  /** Calendar nights in the month, as the month finally closed. */
  finalNights: number;
  /** Of those, the ones already on the books by the measurement day. */
  bookedByDay: number;
  /** bookedByDay / finalNights, 0-1. */
  share: number;
};

/** Where a curve's months came from. */
export type PickupBasis = 'same-month' | 'pooled';

export type BookingCurve = {
  /**
   * Mean share of a month's final nights already booked by the measurement
   * day. Null when too little closed history qualified, which makes the
   * pickup floor inert and leaves the benchmark floor alone.
   */
  share: number | null;
  /** The day of month the share was measured at. */
  dayOfMonth: number;
  /** Months that qualified. */
  months: PickupMonth[];
  /** Months measured but dropped, with the reason. */
  discarded: Array<{ month: string; reason: string }>;
  /**
   * Whether the share came from months of the same month-of-year as the one
   * being projected, or had to be pooled across whatever was available.
   * 'pooled' is the weaker claim and the UI should not oversell it.
   */
  basis: PickupBasis;
};

/** Fewest closed months before a curve is trusted. */
export const MIN_CURVE_MONTHS = 2;

/** Fewest final nights a month needs to contribute. A quiet month is noise. */
export const MIN_CURVE_NIGHTS = 60;

/**
 * A month can never be MORE than fully booked by the measurement day, and a
 * share below this is a data artifact rather than a booking curve.
 */
export const MIN_SHARE = 0.5;

/**
 * Backstop on the pickup multiplier. Derived from MIN_SHARE rather than
 * chosen, so the cap can only ever catch a share the guard already rejected.
 * A hand-picked cap below 1 / MIN_SHARE silently truncated curves the guard
 * had admitted, printing one target while computing another.
 */
export const MAX_PICKUP_MULTIPLIER = 1 / MIN_SHARE;

function daysInMonth(year: number, monthOneBased: number): number {
  return new Date(year, monthOneBased, 0).getDate();
}

/** Calendar nights `stay` occupies inside `ym` (YYYY-MM). */
function nightsInMonth(stay: PickupStay, ym: string): number {
  const [y, m] = ym.split('-').map((n) => parseInt(n, 10));
  if (!y || !m) return 0;
  const monthStart = `${ym}-01`;
  const monthEndExclusive = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const a = stay.checkIn > monthStart ? stay.checkIn : monthStart;
  const b = stay.checkOut < monthEndExclusive ? stay.checkOut : monthEndExclusive;
  if (a >= b) return 0;
  const ms = Date.parse(`${a}T00:00:00Z`);
  const me = Date.parse(`${b}T00:00:00Z`);
  return Math.round((me - ms) / 86_400_000);
}

/**
 * Measure what share of a month's final nights were already booked by
 * `dayOfMonth`, averaged over the closed months that qualify.
 *
 * `stays` must already be filtered to the fleet the pacing % is measured on,
 * and to real bookings. A stay with no `bookedAt` is dropped from the
 * numerator but still counts toward the month's final nights, which would
 * understate the share, so a month is discarded outright unless essentially
 * all of its stays carry the date.
 */
export function measureBookingCurve(
  stays: readonly PickupStay[],
  closedMonths: readonly string[],
  dayOfMonth: number,
  /**
   * Month-of-year (1-12) being projected. When given, months sharing it are
   * preferred and everything else is only a fallback.
   */
  targetMonthOfYear?: number,
  /**
   * First date the caller's stay list actually covers (YYYY-MM-DD).
   *
   * A month that starts before this is only PARTLY in the data, so its
   * `finalNights` is truncated and its share is measured on whatever survived
   * the cutoff rather than on the month. That is dangerous rather than merely
   * noisy: the boundary month is, by construction, the same month-of-year as
   * the one being projected, so it is exactly the month `targetMonthOfYear`
   * would promote over the sound pooled ones. Months starting before this are
   * discarded outright.
   */
  coveredFrom?: string,
): BookingCurve {
  const months: PickupMonth[] = [];
  const discarded: Array<{ month: string; reason: string }> = [];

  for (const ym of closedMonths) {
    const [y, m] = ym.split('-').map((n) => parseInt(n, 10));
    if (!y || !m) continue;
    const monthStart = `${ym}-01`;
    if (coveredFrom && monthStart < coveredFrom) {
      discarded.push({ month: ym, reason: `starts before the data window opens at ${coveredFrom}` });
      continue;
    }
    const cutoff = `${ym}-${String(Math.min(dayOfMonth, daysInMonth(y, m))).padStart(2, '0')}`;

    let finalNights = 0;
    let datedNights = 0;
    let bookedByDay = 0;
    for (const s of stays) {
      // A home live for only part of the month is excluded, because the
      // pacing ratio this curve divides into counts nights from activation.
      if (s.activatedAt && s.activatedAt.slice(0, 10) > monthStart) continue;
      const n = nightsInMonth(s, ym);
      if (n <= 0) continue;
      finalNights += n;
      if (!s.bookedAt) continue;
      datedNights += n;
      if (s.bookedAt <= cutoff) bookedByDay += n;
    }

    if (finalNights < MIN_CURVE_NIGHTS) {
      discarded.push({ month: ym, reason: `only ${finalNights} nights` });
      continue;
    }
    // Coverage floor, NOT a correction. An undated night can never reach the
    // numerator, so leaving it in the denominator would score it as "not
    // booked by day D" and bias every share downward, which inflates the
    // pickup. The share is measured on the dated nights; the test below just
    // throws out a month too sparsely dated to speak for itself.
    const undated = finalNights - datedNights;
    if (undated > finalNights * 0.05) {
      discarded.push({ month: ym, reason: `${undated} of ${finalNights} nights have no booked_at` });
      continue;
    }
    const share = datedNights > 0 ? bookedByDay / datedNights : 0;
    if (share < MIN_SHARE || share > 1) {
      discarded.push({ month: ym, reason: `share ${share.toFixed(3)} outside [${MIN_SHARE}, 1]` });
      continue;
    }
    months.push({ month: ym, finalNights, bookedByDay, share });
  }

  // A booking curve is seasonal, so months of the same month-of-year speak
  // first. Pooling is the fallback, and says so through `basis`.
  const sameMonth =
    targetMonthOfYear != null
      ? months.filter((r) => parseInt(r.month.slice(5, 7), 10) === targetMonthOfYear)
      : [];
  const chosen = sameMonth.length >= MIN_CURVE_MONTHS ? sameMonth : months;
  const basis: PickupBasis = chosen === sameMonth ? 'same-month' : 'pooled';

  if (chosen.length < MIN_CURVE_MONTHS) {
    return { share: null, dayOfMonth, months, discarded, basis: 'pooled' };
  }
  return {
    share: chosen.reduce((a, r) => a + r.share, 0) / chosen.length,
    dayOfMonth,
    months: chosen,
    discarded,
    basis,
  };
}

/**
 * The occupancy a month in progress is on pace to FINISH at, given what is
 * booked now and how much of a month is normally booked by today.
 *
 * Returns `bookedPct` untouched when there is no usable curve, so the
 * benchmark floor is left to act alone. Never returns less than `bookedPct`:
 * nights already sold cannot un-sell.
 */
export function projectedFinalPct(bookedPct: number, curve: BookingCurve): number {
  if (curve.share == null || curve.share <= 0 || bookedPct <= 0) return bookedPct;
  const multiplier = Math.min(MAX_PICKUP_MULTIPLIER, 1 / curve.share);
  // Occupancy has a ceiling. A month at 80% booked on a 0.85 curve would
  // otherwise project to 94%, which is fine, but the same arithmetic on a
  // nearly full month runs past 100 and stops being an occupancy.
  return Math.min(100, Math.max(bookedPct, bookedPct * multiplier));
}
