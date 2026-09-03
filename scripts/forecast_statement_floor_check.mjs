/**
 * Statement run-rate floor. Pure arithmetic, no database.
 *
 * Proves the floor in src/lib/forecast-statement-floor.ts reads closed
 * statements the way the docblock says: latest full month or the whole
 * record, whichever is larger; never from a single month; never from a
 * partial or closed month; nothing at all when there are no statements.
 *
 * Run: node --experimental-strip-types scripts/forecast_statement_floor_check.mjs
 */
import { statementFloor, MIN_STATEMENT_MONTHS } from '../src/lib/forecast-statement-floor.ts';

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

// Gloucester revenue-seasonality shares as of 2026-09-02 (percent of year).
const SHARE = [4.0, 4.6, 5.2, 5.9, 7.2, 10.6, 15.5, 15.7, 9.5, 11.8, 5.4, 4.7].map((x) => x / 100);
const M = (o) => new Map(Object.entries(o));

if (MIN_STATEMENT_MONTHS !== 2) fail(`MIN_STATEMENT_MONTHS is ${MIN_STATEMENT_MONTHS}, the docblock promises 2`);

/* 84 Thatcher: activated 2026-06-15, July was a ramp month, August was not.
   32,532 is the billed fee base (8,132.94 / 25%), which is what the loader
   yields; rental_revenue alone was 31,398 and left the floor $283 short. */
{
  const f = statementFloor({
    grossByMonth: M({ '2026-07': 9796, '2026-08': 32532 }),
    revenueShare: SHARE,
    activatedAt: '2026-06-15T00:00:00+00:00',
  });
  const latest = 32532 / SHARE[7];
  const record = (9796 + 32532) / (SHARE[6] + SHARE[7]);
  if (!near(f.latestAnnual, latest)) fail(`Thatcher latest ${f.latestAnnual.toFixed(0)} != ${latest.toFixed(0)}`);
  if (!near(f.recordAnnual, record)) fail(`Thatcher record ${f.recordAnnual.toFixed(0)} != ${record.toFixed(0)}`);
  if (!near(f.annual, latest)) fail(`Thatcher floor must be the August run rate, got ${f.annual.toFixed(0)}`);
  if (f.annual < 200000) fail(`Thatcher floor ${f.annual.toFixed(0)} should clear the $176K the pacing model carried`);
}

/* A single month, however strong, is not a floor. */
{
  const f = statementFloor({ grossByMonth: M({ '2026-08': 37561 }), revenueShare: SHARE });
  if (f.annual !== 0 || f.months.length !== 0) fail(`one month must not floor, got ${f.annual}`);
}

/* No statements at all: nothing, so the model runs exactly as before. */
{
  const f = statementFloor({ grossByMonth: new Map(), revenueShare: SHARE });
  if (f.annual !== 0) fail(`empty record must return 0, got ${f.annual}`);
}

/* The activation month of a mid-month onboarding is not a full month. */
{
  const f = statementFloor({
    grossByMonth: M({ '2026-06': 4000, '2026-07': 20000, '2026-08': 30000 }),
    revenueShare: SHARE,
    activatedAt: '2026-06-15',
  });
  if (f.months.join() !== '2026-07,2026-08') fail(`activation month must drop, kept ${f.months.join()}`);
  const first = statementFloor({
    grossByMonth: M({ '2026-06': 4000, '2026-07': 20000 }),
    revenueShare: SHARE,
    activatedAt: '2026-06-01',
  });
  if (first.months.join() !== '2026-06,2026-07') fail(`a first-of-month activation is a full month, kept ${first.months.join()}`);
  const before = statementFloor({
    grossByMonth: M({ '2026-05': 9000, '2026-07': 20000, '2026-08': 30000 }),
    revenueShare: SHARE,
    activatedAt: '2026-07-01',
  });
  if (before.months.join() !== '2026-07,2026-08') fail(`months before activation must drop, kept ${before.months.join()}`);
}

/* Closed or partial months under the operating window are not full months. */
{
  const factor = (ym) => (ym === '2026-10' ? 21 / 31 : ym === '2026-11' ? 0 : 1);
  const f = statementFloor({
    grossByMonth: M({ '2026-08': 30000, '2026-09': 12000, '2026-10': 8000, '2026-11': 500 }),
    revenueShare: SHARE,
    operatingFactor: factor,
  });
  if (f.months.join() !== '2026-08,2026-09') fail(`partial and closed months must drop, kept ${f.months.join()}`);
}

/* Once the latest month is a shoulder month the whole record carries the summer,
   and the first closed month (a ramp month) is left out of that record. */
{
  const f = statementFloor({
    grossByMonth: M({ '2026-06': 4000, '2026-07': 40000, '2026-08': 32000, '2026-09': 9000 }),
    revenueShare: SHARE,
  });
  const latest = 9000 / SHARE[8];
  const record = (40000 + 32000 + 9000) / (SHARE[6] + SHARE[7] + SHARE[8]);
  const withRamp = (4000 + 40000 + 32000 + 9000) / (SHARE[5] + SHARE[6] + SHARE[7] + SHARE[8]);
  if (!near(f.latestAnnual, latest)) fail(`shoulder latest ${f.latestAnnual.toFixed(0)} != ${latest.toFixed(0)}`);
  if (!near(f.recordAnnual, record)) fail(`record must drop the first month, got ${f.recordAnnual.toFixed(0)} vs ${record.toFixed(0)} (with ramp ${withRamp.toFixed(0)})`);
  if (!near(f.annual, record)) fail(`floor must not decay to the shoulder month, got ${f.annual.toFixed(0)} vs record ${record.toFixed(0)}`);
  if (f.months.length !== 4) fail(`all four months still qualify for eligibility, got ${f.months.length}`);
}

/* With exactly two months the record keeps both: the latest reading carries. */
{
  const f = statementFloor({ grossByMonth: M({ '2026-07': 9796, '2026-08': 32532 }), revenueShare: SHARE });
  const both = (9796 + 32532) / (SHARE[6] + SHARE[7]);
  if (!near(f.recordAnnual, both)) fail(`two-month record must use both months, got ${f.recordAnnual.toFixed(0)}`);
  if (!near(f.annual, 32532 / SHARE[7])) fail(`two-month floor is the latest reading, got ${f.annual.toFixed(0)}`);
}

/* 17 Beach shape: the thin April the Statements module started with must not
   drag the record once May to August exist. */
{
  const f = statementFloor({
    grossByMonth: M({ '2026-04': 4179, '2026-05': 11614, '2026-06': 20718, '2026-07': 55326, '2026-08': 35272 }),
    revenueShare: SHARE,
  });
  const record = (11614 + 20718 + 55326 + 35272) / (SHARE[4] + SHARE[5] + SHARE[6] + SHARE[7]);
  if (!near(f.recordAnnual, record)) fail(`17 Beach record must exclude April, got ${f.recordAnnual.toFixed(0)} vs ${record.toFixed(0)}`);
}

/* Zero and negative months carry no information. */
{
  const f = statementFloor({ grossByMonth: M({ '2026-07': 0, '2026-08': 30000, '2026-06': -12 }), revenueShare: SHARE });
  if (f.annual !== 0) fail(`a lone positive month next to zeros must not floor, got ${f.annual}`);
}

if (failures === 0) console.log('OK    statement floor: run rate or whole record (first month dropped), two-month minimum, full months only, empty record is inert');
process.exit(failures ? 1 : 0);
