/**
 * Calibrating the occupancy benchmark on Rising Tide's own closed months.
 *
 * The forward forecast scales a sparsely-booked month up toward a benchmark.
 * That benchmark is Gloucester MARKET occupancy (`HISTORICAL_AVG_RECENT`, a
 * 2022-2025 AirDNA average), and Rising Tide does not trade at the market.
 * It runs close to it when the season is on and well under it in the
 * shoulders, so scaling to the raw market number overstates the shoulders
 * and a single flat haircut understates the peak.
 *
 * Measured on 2026's own closed months, per-property so a growing fleet
 * cannot distort the denominator:
 *
 *     month   live   RT occ    benchmark   ratio
 *     May      8      46.4%      54.9%      0.84
 *     Jun     12      52.2%      63.4%      0.82
 *     Jul     15      73.3%      77.2%      0.95
 *     Aug     17      75.7%      78.8%      0.96
 *
 * The previous approach took a flat 0.82 from the market's own Q1 deviation
 * and applied it to all twelve months. August is what showed that up: it
 * closed at 75.7% against a calibrated benchmark of 64.7%, beating the bar
 * by 17%, because a shoulder-season ratio had been pinned onto a peak month.
 *
 * April is measured but deliberately discarded: only five properties were
 * live, they ran 94% occupied, and the resulting 1.74 ratio describes a
 * five-unit portfolio rather than a nineteen-unit one. See MIN_LIVE_PROPS.
 *
 * Deliberately dependency-free: the caller passes the benchmark curve in, so
 * the rules stay pure and `scripts/forecast_calibration_check.mjs` can import
 * this module on its own.
 */

/**
 * Fewest live properties a month needs before its ratio is trusted.
 * Guards against a handful of well-booked units standing in for the fleet.
 */
const MIN_LIVE_PROPS = 8;

/** Fewest occupied nights a month needs. A quiet month is a noisy ratio. */
const MIN_NIGHTS = 60;

/**
 * Bounds on any single month's ratio. A measurement outside this band is
 * far likelier to be a fleet or data artifact than a real capture rate.
 */
const RATIO_FLOOR = 0.4;
const RATIO_CEILING = 1.3;

export type MonthCalibration = {
  /** Month of year, 1-12. */
  month: number;
  liveProperties: number;
  occupiedNights: number;
  possibleNights: number;
  /** Rising Tide's realized occupancy, 0-100. */
  rtOccupancyPct: number;
  /** The market benchmark for that month of year, 0-100. */
  benchmarkPct: number;
  /** rtOccupancyPct / benchmarkPct. */
  ratio: number;
};

export type RealizedCalibration = {
  /** Month of year (1-12) -> measured ratio, for months that qualified. */
  byMonth: Map<number, number>;
  /** Mean of the measured ratios, used for months with no measurement. */
  fallback: number;
  /** Everything measured, including months that failed the guards. */
  measured: MonthCalibration[];
  /** Months that were measured but discarded, with the reason. */
  discarded: Array<{ month: number; reason: string }>;
};

/** No usable history: fall through to the raw market benchmark. */
export const NO_CALIBRATION: RealizedCalibration = {
  byMonth: new Map(),
  fallback: 1,
  measured: [],
  discarded: [],
};

type StayRow = {
  property_id: string | null;
  check_in: string | null;
  check_out: string | null;
};

function daysInMonth(year: number, monthOneBased: number): number {
  return new Date(year, monthOneBased, 0).getDate();
}

/**
 * Turn closed-month stays into a per-month-of-year capture ratio.
 *
 * `stays` must already be filtered to revenue-bearing, non-cancelled stays
 * at managed (non-RT-owned) properties. Pure: the caller owns the query, so
 * this stays directly testable.
 *
 * Occupancy is computed per property against only the properties that were
 * actually live that month, which is what keeps a mid-year onboarding from
 * dragging the whole month's occupancy down.
 */
export function computeRealizedCalibration(
  stays: StayRow[],
  closedMonths: string[],
  /** Market occupancy by month of year, 0-100. Twelve entries, Jan..Dec. */
  benchmarkByMonthOfYear: number[],
): RealizedCalibration {
  if (closedMonths.length === 0) return NO_CALIBRATION;

  const wanted = new Set(closedMonths);
  // month key -> property -> occupied nights
  const nightsByMonth = new Map<string, Map<string, number>>();

  for (const s of stays) {
    if (!s.property_id || !s.check_in || !s.check_out) continue;
    const start = new Date(`${s.check_in}T00:00:00Z`);
    const end = new Date(`${s.check_out}T00:00:00Z`);
    if (!(start < end)) continue;
    for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 7);
      if (!wanted.has(key)) continue;
      let byProp = nightsByMonth.get(key);
      if (!byProp) {
        byProp = new Map();
        nightsByMonth.set(key, byProp);
      }
      byProp.set(s.property_id, (byProp.get(s.property_id) ?? 0) + 1);
    }
  }

  const measured: MonthCalibration[] = [];
  const discarded: Array<{ month: number; reason: string }> = [];

  for (const key of closedMonths) {
    const byProp = nightsByMonth.get(key);
    if (!byProp || byProp.size === 0) continue;
    const [y, m] = key.split('-').map((n) => parseInt(n, 10));
    if (!y || !m) continue;

    const live = [...byProp.values()].filter((n) => n > 0).length;
    const occupiedNights = [...byProp.values()].reduce((a, b) => a + b, 0);
    const possibleNights = live * daysInMonth(y, m);
    const benchmarkPct = benchmarkByMonthOfYear[m - 1] ?? 0;
    if (possibleNights <= 0 || benchmarkPct <= 0) continue;

    const rtOccupancyPct = (occupiedNights / possibleNights) * 100;
    const ratio = rtOccupancyPct / benchmarkPct;
    const row: MonthCalibration = {
      month: m, liveProperties: live, occupiedNights, possibleNights,
      rtOccupancyPct, benchmarkPct, ratio,
    };
    measured.push(row);

    if (live < MIN_LIVE_PROPS) {
      discarded.push({ month: m, reason: `only ${live} live properties` });
      continue;
    }
    if (occupiedNights < MIN_NIGHTS) {
      discarded.push({ month: m, reason: `only ${occupiedNights} occupied nights` });
      continue;
    }
    if (ratio < RATIO_FLOOR || ratio > RATIO_CEILING) {
      discarded.push({ month: m, reason: `ratio ${ratio.toFixed(2)} outside [${RATIO_FLOOR}, ${RATIO_CEILING}]` });
      continue;
    }
  }

  const kept = measured.filter(
    (r) => !discarded.some((d) => d.month === r.month),
  );
  if (kept.length === 0) return { ...NO_CALIBRATION, measured, discarded };

  const byMonth = new Map<number, number>();
  for (const r of kept) byMonth.set(r.month, r.ratio);
  const fallback = kept.reduce((a, r) => a + r.ratio, 0) / kept.length;

  return { byMonth, fallback, measured, discarded };
}

/**
 * The benchmark the forward forecast should scale toward: the market shape,
 * pulled to Rising Tide's own capture rate.
 *
 * A month of year with its own measurement uses it. Everything else uses the
 * mean of what was measured, which is honest about being an average rather
 * than pretending to a seasonality the data has not yet earned.
 */
export function calibratedBenchmarkFrom(
  cal: RealizedCalibration,
  benchmarkByMonthOfYear: number[],
): number[] {
  return benchmarkByMonthOfYear.map((raw, i) => {
    const ratio = cal.byMonth.get(i + 1) ?? cal.fallback;
    return raw * ratio;
  });
}

/**
 * Calendar months of `year` that have fully closed, oldest first. The
 * in-progress month is never included: its book is still filling, so its
 * occupancy is not a realized number.
 */
export function closedMonthsOf(year: number, today: Date): string[] {
  const out: string[] = [];
  const cy = today.getFullYear();
  const cm = today.getMonth() + 1;
  for (let m = 1; m <= 12; m++) {
    if (year > cy || (year === cy && m >= cm)) break;
    out.push(`${year}-${String(m).padStart(2, '0')}`);
  }
  return out;
}
