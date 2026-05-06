/**
 * Gloucester market occupancy benchmark.
 *
 * Source: occupancy_since_2018.csv (monthly Cape Ann short-term-rental
 * market occupancy %, 2018-01 through 2026-04). Used as the seasonal
 * benchmark when projecting how booked-so-far revenue will pace to
 * historical norms.
 *
 * Two averages are pre-computed:
 *   - HISTORICAL_AVG_8YR: 2018-2025 average per month. Includes the
 *     pandemic spike years (2020-2022) so it skews high.
 *   - HISTORICAL_AVG_RECENT: 2022-2025 four-year average. Better
 *     reflects current market conditions; used as the default.
 *
 * Numbers are 0-100 (percentage), not 0-1.
 */

export type MonthlyOccupancy = { date: string; occupancy: number };

export const HISTORICAL_OCCUPANCY: MonthlyOccupancy[] = [
  { date: '2018-01', occupancy: 25.37 }, { date: '2018-02', occupancy: 44.17 },
  { date: '2018-03', occupancy: 46.65 }, { date: '2018-04', occupancy: 37.05 },
  { date: '2018-05', occupancy: 44.29 }, { date: '2018-06', occupancy: 57.05 },
  { date: '2018-07', occupancy: 68.48 }, { date: '2018-08', occupancy: 69.98 },
  { date: '2018-09', occupancy: 45.69 }, { date: '2018-10', occupancy: 47.74 },
  { date: '2018-11', occupancy: 37.09 }, { date: '2018-12', occupancy: 47.59 },

  { date: '2019-01', occupancy: 31.97 }, { date: '2019-02', occupancy: 37.40 },
  { date: '2019-03', occupancy: 40.14 }, { date: '2019-04', occupancy: 45.31 },
  { date: '2019-05', occupancy: 48.43 }, { date: '2019-06', occupancy: 61.21 },
  { date: '2019-07', occupancy: 68.48 }, { date: '2019-08', occupancy: 73.45 },
  { date: '2019-09', occupancy: 45.54 }, { date: '2019-10', occupancy: 49.15 },
  { date: '2019-11', occupancy: 27.63 }, { date: '2019-12', occupancy: 31.98 },

  { date: '2020-01', occupancy: 30.60 }, { date: '2020-02', occupancy: 46.35 },
  { date: '2020-03', occupancy: 40.75 }, { date: '2020-04', occupancy: 47.33 },
  { date: '2020-05', occupancy: 62.82 }, { date: '2020-06', occupancy: 72.34 },
  { date: '2020-07', occupancy: 77.71 }, { date: '2020-08', occupancy: 82.66 },
  { date: '2020-09', occupancy: 61.73 }, { date: '2020-10', occupancy: 63.18 },
  { date: '2020-11', occupancy: 51.07 }, { date: '2020-12', occupancy: 51.68 },

  { date: '2021-01', occupancy: 43.71 }, { date: '2021-02', occupancy: 48.37 },
  { date: '2021-03', occupancy: 49.16 }, { date: '2021-04', occupancy: 55.15 },
  { date: '2021-05', occupancy: 57.56 }, { date: '2021-06', occupancy: 76.23 },
  { date: '2021-07', occupancy: 88.01 }, { date: '2021-08', occupancy: 82.82 },
  { date: '2021-09', occupancy: 62.70 }, { date: '2021-10', occupancy: 67.56 },
  { date: '2021-11', occupancy: 40.09 }, { date: '2021-12', occupancy: 37.73 },

  { date: '2022-01', occupancy: 32.65 }, { date: '2022-02', occupancy: 53.69 },
  { date: '2022-03', occupancy: 49.72 }, { date: '2022-04', occupancy: 58.61 },
  { date: '2022-05', occupancy: 58.66 }, { date: '2022-06', occupancy: 67.65 },
  { date: '2022-07', occupancy: 82.02 }, { date: '2022-08', occupancy: 83.58 },
  { date: '2022-09', occupancy: 61.02 }, { date: '2022-10', occupancy: 68.53 },
  { date: '2022-11', occupancy: 38.32 }, { date: '2022-12', occupancy: 41.28 },

  { date: '2023-01', occupancy: 28.55 }, { date: '2023-02', occupancy: 49.59 },
  { date: '2023-03', occupancy: 48.47 }, { date: '2023-04', occupancy: 53.48 },
  { date: '2023-05', occupancy: 51.65 }, { date: '2023-06', occupancy: 62.49 },
  { date: '2023-07', occupancy: 73.94 }, { date: '2023-08', occupancy: 76.77 },
  { date: '2023-09', occupancy: 55.88 }, { date: '2023-10', occupancy: 64.85 },
  { date: '2023-11', occupancy: 33.01 }, { date: '2023-12', occupancy: 37.89 },

  { date: '2024-01', occupancy: 24.87 }, { date: '2024-02', occupancy: 43.92 },
  { date: '2024-03', occupancy: 47.37 }, { date: '2024-04', occupancy: 49.62 },
  { date: '2024-05', occupancy: 54.71 }, { date: '2024-06', occupancy: 60.68 },
  { date: '2024-07', occupancy: 75.78 }, { date: '2024-08', occupancy: 76.81 },
  { date: '2024-09', occupancy: 55.63 }, { date: '2024-10', occupancy: 64.70 },
  { date: '2024-11', occupancy: 34.45 }, { date: '2024-12', occupancy: 32.24 },

  { date: '2025-01', occupancy: 27.34 }, { date: '2025-02', occupancy: 37.27 },
  { date: '2025-03', occupancy: 46.82 }, { date: '2025-04', occupancy: 54.65 },
  { date: '2025-05', occupancy: 54.61 }, { date: '2025-06', occupancy: 62.74 },
  { date: '2025-07', occupancy: 77.17 }, { date: '2025-08', occupancy: 77.93 },
  { date: '2025-09', occupancy: 51.24 }, { date: '2025-10', occupancy: 60.81 },
  { date: '2025-11', occupancy: 33.71 }, { date: '2025-12', occupancy: 33.29 },

  { date: '2026-01', occupancy: 21.70 }, { date: '2026-02', occupancy: 32.79 },
  { date: '2026-03', occupancy: 46.39 }, { date: '2026-04', occupancy: 45.50 },
];

/**
 * Average a set of years' values for each month-of-year (1-12).
 * Returns 12 numbers in [0, 100].
 */
function monthAverages(yearsInclusive: number[]): number[] {
  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  for (const r of HISTORICAL_OCCUPANCY) {
    const [yyyy, mm] = r.date.split('-');
    if (!yearsInclusive.includes(parseInt(yyyy, 10))) continue;
    buckets[parseInt(mm, 10) - 1].push(r.occupancy);
  }
  return buckets.map((arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0));
}

/** 2018-2025 full eight-year monthly average (pandemic-skewed). */
export const HISTORICAL_AVG_8YR: number[] = monthAverages([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);

/**
 * 2022-2025 recent four-year average. This is the default benchmark for
 * forward projections — pandemic years (2020-21) are dropped because they
 * weren't representative of normal market dynamics.
 */
export const HISTORICAL_AVG_RECENT: number[] = monthAverages([2022, 2023, 2024, 2025]);

/** 2026 actuals (Jan-Apr). Only complete months — May-Dec are unknown. */
export const ACTUAL_2026_OCCUPANCY: Record<number, number | null> = {
  1: 21.70, 2: 32.79, 3: 46.39, 4: 45.50,
  5: null, 6: null, 7: null, 8: null,
  9: null, 10: null, 11: null, 12: null,
};

/**
 * Days in a month. Used for "nights possible" capacity calculations.
 */
export function daysInMonth(year: number, monthOneBased: number): number {
  return new Date(year, monthOneBased, 0).getDate();
}
