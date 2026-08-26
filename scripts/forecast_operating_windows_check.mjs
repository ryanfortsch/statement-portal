/**
 * Per-property operating schedules — pure arithmetic, no database.
 *
 * Asserts the schedules in src/lib/forecast-operating-windows.ts match what
 * operations actually told us, so a future edit to that table cannot quietly
 * reopen a closed property or close an open one.
 *
 * Run: node --experimental-strip-types scripts/forecast_operating_windows_check.mjs
 */
import { operatingFactor, isOperating } from '../src/lib/forecast-operating-windows.ts';

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

  // 4 Brier Neck is not renting in September.
  ['4_brier_neck', '2026-08', 1, 'open in August'],
  ['4_brier_neck', '2026-09', 0, 'not renting in September'],
  ['4_brier_neck', '2027-09', 0, 'September stays off (recurring season)'],

  // 73 Rocky Neck picked up September and October.
  ['73_rocky_neck', '2026-09', 1, 'rents in September'],
  ['73_rocky_neck', '2026-10', 1, 'rents in October'],
  ['73_rocky_neck', '2026-11', 0, 'off from November'],

  // 79 Main ends 21 October.
  ['79_main', '2026-09', 1, 'full month in September'],
  ['79_main', '2026-11', 0, 'gone from November'],
  ['79_main', '2026-12', 0, 'still gone in December'],
];

for (const [id, ym, want, msg] of EXPECT) {
  const got = operatingFactor(id, ym);
  if (!near(got, want)) fail(`${id} ${ym}: ${msg} — factor ${got.toFixed(4)}, expected ${want}`);
}

// 79 Main's final month is pro-rated across the days it was available.
const oct = operatingFactor('79_main', '2026-10');
if (!near(oct, 21 / 31)) fail(`79 Main October pro-rate ${oct.toFixed(4)}, expected ${(21 / 31).toFixed(4)} (21 of 31 days)`);
// A partial month is still an operating month: it must project, not vanish.
if (!isOperating('79_main', '2026-10')) fail('79 Main October must count as operating so it still projects');

// A property with no window is unrestricted.
if (operatingFactor('3_south_st', '2027-02') !== 1) fail('a property with no window must be open every month');

console.log(failures === 0
  ? `PASS - all ${EXPECT.length + 3} operating-window assertions hold; 79 Main's October pro-rates to ${(21 / 31).toFixed(4)}.`
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
