/**
 * Benchmark calibration on Rising Tide's own closed months.
 * Pure arithmetic, no database.
 *
 * The forward forecast scales sparsely-booked months toward a benchmark. That
 * benchmark is Gloucester MARKET occupancy, and RT does not trade at the
 * market: close to it in season, well under it in the shoulders. This asserts
 * the measured capture rate reproduces 2026's actual closed months, and that
 * the guards throw out the fleet artifacts.
 *
 * Run: node --experimental-strip-types scripts/forecast_calibration_check.mjs
 */
import {
  computeRealizedCalibration,
  calibratedBenchmarkFrom,
  closedMonthsOf,
} from '../src/lib/forecast-calibration.ts';

// The Gloucester market benchmark, 2022-2025 average by month of year.
// Inlined so this harness stays runnable without pulling the AirDNA module.
const HISTORICAL_AVG_RECENT = [28.4, 46.1, 48.1, 54.1, 54.9, 63.4, 77.2, 78.8, 55.9, 64.7, 34.9, 36.2];

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };

/* Build stays that reproduce 2026's measured occupancy exactly.
   month -> [liveProperties, occupiedNights] straight off the live data. */
const REAL = {
  '2026-04': [5, 141],   // 94.0% — five properties, discarded by MIN_LIVE_PROPS
  '2026-05': [8, 115],   // 46.4%
  '2026-06': [12, 188],  // 52.2%
  '2026-07': [15, 341],  // 73.3%
  '2026-08': [17, 399],  // 75.7%
};
const DIM = { '2026-04': 30, '2026-05': 31, '2026-06': 30, '2026-07': 31, '2026-08': 31 };

// Spread the occupied nights across the live properties as contiguous blocks
// from the 1st. Occupancy is a night count, so the arrangement is irrelevant.
const stays = [];
for (const [key, [live, nights]] of Object.entries(REAL)) {
  const dim = DIM[key];
  let left = nights;
  for (let p = 0; p < live && left > 0; p++) {
    const take = Math.min(dim, Math.ceil(left / (live - p)));
    const start = `${key}-01`;
    const end = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, 1 + take));
    stays.push({ property_id: `${key}-p${p}`, check_in: start, check_out: end.toISOString().slice(0, 10) });
    left -= take;
  }
}

const closed = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
const cal = computeRealizedCalibration(stays, closed, HISTORICAL_AVG_RECENT);

/* -- the ratios must reproduce what the account actually did -------------- */
const EXPECT = { 5: 0.84, 6: 0.82, 7: 0.95, 8: 0.96 };
for (const [m, want] of Object.entries(EXPECT)) {
  const got = cal.byMonth.get(+m);
  if (got == null) { fail(`month ${m} should have a measured ratio`); continue; }
  if (Math.abs(got - want) > 0.02) fail(`month ${m} ratio ${got.toFixed(3)}, expected ~${want}`);
}

/* -- April is measured, then discarded: five properties is not a fleet ---- */
if (cal.byMonth.has(4)) fail('April must be discarded: only five live properties');
if (!cal.measured.some((r) => r.month === 4)) fail('April must still appear in `measured` for the audit trail');
if (!cal.discarded.some((d) => d.month === 4)) fail('April must be recorded in `discarded` with a reason');

/* -- the peak must not be haircut like the shoulder ----------------------- */
{
  const bench = calibratedBenchmarkFrom(cal, HISTORICAL_AVG_RECENT);
  const augRaw = HISTORICAL_AVG_RECENT[7];
  const augCal = bench[7];
  // Old flat 0.82 put August at 64.7% and it closed at 75.7%. The measured
  // ratio must land the benchmark near where the month actually finished.
  if (Math.abs(augCal - 75.7) > 1.5) fail(`August benchmark ${augCal.toFixed(1)}%, should sit near its realized 75.7%`);
  if (augCal <= augRaw * 0.82 + 1) fail('August must no longer carry the flat Q1 haircut');
  const mayCal = bench[4];
  if (mayCal >= HISTORICAL_AVG_RECENT[4]) fail('May must still be pulled below the raw market benchmark');
}

/* -- unmeasured months take the mean, not a fabricated seasonality -------- */
{
  const mean = (0.84 + 0.82 + 0.95 + 0.96) / 4;
  if (Math.abs(cal.fallback - mean) > 0.02) fail(`fallback ${cal.fallback.toFixed(3)}, expected the mean of measured ~${mean.toFixed(3)}`);
  const bench = calibratedBenchmarkFrom(cal, HISTORICAL_AVG_RECENT);
  const sep = bench[8];
  if (Math.abs(sep - HISTORICAL_AVG_RECENT[8] * cal.fallback) > 1e-9) {
    fail('an unmeasured month must use the fallback ratio');
  }
}

/* -- no history: fall through to the raw market curve, never to zero ------ */
{
  const none = computeRealizedCalibration([], [], HISTORICAL_AVG_RECENT);
  if (none.byMonth.size !== 0 || none.fallback !== 1) fail('no closed months must yield an inert calibration');
  const bench = calibratedBenchmarkFrom(none, HISTORICAL_AVG_RECENT);
  if (bench.some((v, i) => Math.abs(v - HISTORICAL_AVG_RECENT[i]) > 1e-9)) {
    fail('an inert calibration must return the raw benchmark unchanged');
  }
}

/* -- closedMonthsOf never includes the month in progress ------------------ */
{
  const c = closedMonthsOf(2026, new Date('2026-09-02T12:00:00Z'));
  if (c.includes('2026-09')) fail('the in-progress month must never count as closed');
  if (c[c.length - 1] !== '2026-08') fail(`last closed month should be 2026-08, got ${c[c.length - 1]}`);
  if (closedMonthsOf(2027, new Date('2026-09-02T12:00:00Z')).length !== 0) fail('a future year has no closed months');
}

console.log(failures === 0
  ? 'PASS - measured ratios reproduce May 0.84 / Jun 0.82 / Jul 0.95 / Aug 0.96, April is discarded as a five-property artifact, August sits near its realized 75.7% instead of the old 64.7%, and no history falls through to the raw market curve.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
