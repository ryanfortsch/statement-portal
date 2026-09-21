/**
 * Per-property operating schedules — pure arithmetic, no database.
 *
 * Asserts the schedules in src/lib/forecast-operating-windows.ts match what
 * operations actually told us, so a future edit to that table cannot quietly
 * reopen a closed property or close an open one.
 *
 * Run: node --experimental-strip-types scripts/forecast_operating_windows_check.mjs
 */
import { operatingFactor, isOperating, opensInYear, opensIn } from '../src/lib/forecast-operating-windows.ts';

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };
const near = (a, b) => Math.abs(a - b) < 1e-9;

/* Schedule review, 2026-08-26. */
const EXPECT = [
  // 16 Waterman shuts down after 31 Oct and reopens in May.
  ['16_waterman', '2026-09', 1, 'open in September'],
  ['16_waterman', '2026-10', 1, 'open through October'],
  ['16_waterman', '2026-11', 0, 'closed in November'],
  ['16_waterman', '2026-12', 0, 'closed in December'],
  ['16_waterman', '2027-01', 0, 'closed in January'],
  ['16_waterman', '2027-04', 0, 'still closed in April'],
  ['16_waterman', '2027-05', 1, 'reopens in May'],

  // 4 Brier Neck is not renting in September, and the agreement is not
  // renewed for 2027 (notice given 2026-08-31), so next summer is off too.
  ['4_brier_neck', '2026-08', 1, 'open in August'],
  ['4_brier_neck', '2026-09', 0, 'not renting in September'],
  ['4_brier_neck', '2027-06', 0, 'June 2027 off: not renewed'],
  ['4_brier_neck', '2027-07', 0, 'July 2027 off: not renewed'],
  ['4_brier_neck', '2027-08', 0, 'August 2027 off: not renewed'],
  ['4_brier_neck', '2027-09', 0, 'September stays off (recurring season)'],

  // 73 Rocky Neck: the sale was called off on 2026-09-16, so it has no end
  // date any more and runs every month like any unrestricted home.
  ['73_rocky_neck', '2026-09', 1, 'rents in September'],
  ['73_rocky_neck', '2026-10', 1, 'rents in October'],
  ['73_rocky_neck', '2026-11', 1, 'sale off: still renting in November'],
  ['73_rocky_neck', '2026-12', 1, 'sale off: still renting in December'],
  ['73_rocky_neck', '2027-03', 1, 'sale off: no end date at all'],

  // 30 Woodward is shut once November ends and reopens in May: the house is
  // not fully insulated, so the closure recurs every year.
  ['30_woodward', '2026-11', 1, 'open through November'],
  ['30_woodward', '2026-12', 0, 'shut for the winter'],
  ['30_woodward', '2027-01', 0, 'still shut in January'],
  ['30_woodward', '2027-03', 0, 'still shut in March'],
  ['30_woodward', '2027-05', 1, 'fully open in May'],
  ['30_woodward', '2027-11', 1, 'and runs to the end of November again'],

  // 79 Main is seasonal: June 1 through October 20, every year.
  ['79_main', '2026-06', 1, 'season opens in June'],
  ['79_main', '2026-09', 1, 'full month in September'],
  ['79_main', '2026-11', 0, 'shut after the season'],
  ['79_main', '2026-12', 0, 'still shut in December'],
  ['79_main', '2027-05', 0, 'still shut the following May'],
  ['79_main', '2027-06', 1, 'season returns the following June'],
  ['79_main', '2027-07', 1, 'open through the summer'],
];

for (const [id, ym, want, msg] of EXPECT) {
  const got = operatingFactor(id, ym);
  if (!near(got, want)) fail(`${id} ${ym}: ${msg} — factor ${got.toFixed(4)}, expected ${want}`);
}

// 30 Woodward reopens on 25 April, so April earns its last six days and does
// so every year. A partial month must still count as operating, or the home
// vanishes from the month it comes back in.
for (const y of [2027, 2028]) {
  const apr = operatingFactor('30_woodward', `${y}-04`);
  if (!near(apr, 6 / 30)) fail(`30 Woodward April ${y} pro-rate ${apr.toFixed(4)}, expected ${(6 / 30).toFixed(4)} (25th-30th)`);
}
if (!isOperating('30_woodward', '2027-04')) fail('30 Woodward April must count as operating so it still projects');
if (!near(operatingFactor('30_woodward', '2027-11'), 1)) fail('30 Woodward November is a whole month');

// 79 Main's closing month is pro-rated across the days it is open, and it
// pro-rates the SAME way every year because the season recurs.
for (const y of [2026, 2027, 2028]) {
  const oct = operatingFactor('79_main', `${y}-10`);
  if (!near(oct, 20 / 31)) fail(`79 Main October ${y} pro-rate ${oct.toFixed(4)}, expected ${(20 / 31).toFixed(4)} (20 of 31 days)`);
}
// A partial month is still an operating month: it must project, not vanish.
if (!isOperating('79_main', '2026-10')) fail('79 Main October must count as operating so it still projects');

// A property with no window is unrestricted.
if (operatingFactor('3_south_st', '2027-02') !== 1) fail('a property with no window must be open every month');

// The yearly roster predicate: seasonal homes are open for the year, homes
// offline before it are not, and a home with no window is open.
const ROSTER = [
  ['16_waterman', 2027, true, 'seasonal, open May to October'],
  ['30_woodward', 2027, true, 'seasonal, open May to November'],
  ['4_brier_neck', 2027, false, 'not renewed for 2027'],
  ['4_brier_neck', 2026, true, 'still ran in summer 2026'],
  ['73_rocky_neck', 2027, true, 'sale called off, no end date'],
  ['79_main', 2027, true, 'seasonal: returns each June'],
  ['79_main', 2026, true, 'operated in 2026'],
  ['3_south_st', 2028, true, 'no window, always open'],
];
for (const [id, year, want, msg] of ROSTER) {
  if (opensInYear(id, year) !== want) fail(`${id} ${year}: ${msg}, expected ${want}`);
}

// The month form of the same predicate: what the card and the bench scale on.
const MONTHLY = [
  ['16_waterman', 2027, 1, false, 'January: closed for the season'],
  ['30_woodward', 2027, 2, false, 'February: closed, the house is not insulated'],
  ['30_woodward', 2027, 4, true, 'April: partial month still counts as operating'],
  ['30_woodward', 2027, 9, true, 'September: open'],
  ['16_waterman', 2027, 7, true, 'July: open'],
  ['4_brier_neck', 2026, 8, true, 'August 2026: last operating month'],
  ['4_brier_neck', 2026, 9, false, 'September 2026: closed'],
  ['79_main', 2026, 10, true, 'October 2026: partial month still counts as operating'],
  ['79_main', 2026, 11, false, 'November 2026: out of season'],
  ['79_main', 2027, 6, true, 'June 2027: season returns'],
  ['3_south_st', 2026, 2, true, 'no window, open'],
];
for (const [id, year, month, want, msg] of MONTHLY) {
  if (opensIn(id, year, month) !== want) fail(`${id} ${year}-${month}: ${msg}, expected ${want}`);
}
if (opensIn('4_brier_neck', 2027) !== false) fail('opensIn without a month must behave as opensInYear');

console.log(failures === 0
  ? `PASS - all ${EXPECT.length + 9 + ROSTER.length + MONTHLY.length + 1} operating-window assertions hold; 79 Main's October pro-rates to ${(20 / 31).toFixed(4)} every year.`
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
