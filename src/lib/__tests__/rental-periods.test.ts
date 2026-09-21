import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countOpenNights,
  describePeriods,
  isClosedAllMonth,
  isOpenOn,
  normalizePeriod,
  openDatesOf,
  type RentalPeriod,
} from '../rental-periods.ts';
import { isOperatingOnDate, opensInYear } from '../forecast-operating-windows.ts';

/** A summer home: open Memorial Day weekend through the end of October. */
const summer: RentalPeriod[] = [{ startMonth: 5, startDay: 1, endMonth: 10, endDay: 31 }];
/** A winter rental that runs across New Year. */
const winter: RentalPeriod[] = [{ startMonth: 11, startDay: 1, endMonth: 4, endDay: 30 }];

// ── The default is the whole point ──────────────────────────────────────

test('no periods means open year-round, so an un-stamped home is unchanged', () => {
  assert.equal(isOpenOn([], '2026-12-25'), true);
  assert.equal(isOpenOn([], '2026-07-04'), true);
  assert.equal(isClosedAllMonth([], 2026, 12), false);
  assert.equal(countOpenNights([], '2026-12-01', '2027-01-01'), 31);
  assert.deepEqual(openDatesOf([], ['2026-01-09', '2026-06-02']), ['2026-01-09', '2026-06-02']);
  assert.equal(describePeriods([]), 'Open year-round');
});

// ── A plain window ──────────────────────────────────────────────────────

test('a summer season is open inside its window and shut outside it', () => {
  assert.equal(isOpenOn(summer, '2026-05-01'), true, 'first day is inclusive');
  assert.equal(isOpenOn(summer, '2026-08-15'), true);
  assert.equal(isOpenOn(summer, '2026-10-31'), true, 'last day is inclusive');
  assert.equal(isOpenOn(summer, '2026-11-01'), false);
  assert.equal(isOpenOn(summer, '2026-04-30'), false);
  assert.equal(isOpenOn(summer, '2026-12-25'), false);
});

test('a summer home is shut for all of December and open for all of August', () => {
  assert.equal(isClosedAllMonth(summer, 2026, 12), true);
  assert.equal(isClosedAllMonth(summer, 2026, 11), true);
  assert.equal(isClosedAllMonth(summer, 2026, 8), false);
});

// ── The year wrap ───────────────────────────────────────────────────────

test('a window whose start falls after its end runs through New Year', () => {
  assert.equal(isOpenOn(winter, '2026-12-25'), true);
  assert.equal(isOpenOn(winter, '2026-01-15'), true);
  assert.equal(isOpenOn(winter, '2026-11-01'), true);
  assert.equal(isOpenOn(winter, '2026-04-30'), true);
  assert.equal(isOpenOn(winter, '2026-06-15'), false);
  assert.equal(isOpenOn(winter, '2026-05-01'), false);
});

test('the wrap does not swallow the whole year: summer is still shut', () => {
  assert.equal(isClosedAllMonth(winter, 2026, 7), true);
  assert.equal(isClosedAllMonth(winter, 2026, 12), false);
});

// ── Several windows ─────────────────────────────────────────────────────

test('a home can be open for a season and again for a holiday week', () => {
  const periods: RentalPeriod[] = [
    { startMonth: 5, startDay: 1, endMonth: 10, endDay: 31 },
    { startMonth: 12, startDay: 20, endMonth: 12, endDay: 31 },
  ];
  assert.equal(isOpenOn(periods, '2026-07-04'), true);
  assert.equal(isOpenOn(periods, '2026-12-25'), true);
  assert.equal(isOpenOn(periods, '2026-12-10'), false);
  assert.equal(isClosedAllMonth(periods, 2026, 12), false);
  assert.equal(isClosedAllMonth(periods, 2026, 1), true);
});

// ── Counting the nights a target is taken against ───────────────────────

test('a home shut for half of November can only fill the half it is open', () => {
  const half: RentalPeriod[] = [{ startMonth: 1, startDay: 1, endMonth: 11, endDay: 15 }];
  assert.equal(countOpenNights(half, '2026-11-01', '2026-12-01'), 15);
  assert.equal(countOpenNights(half, '2026-12-01', '2027-01-01'), 0);
});

test('counting a summer season across a full year lands on its real length', () => {
  // May (31) + Jun (30) + Jul (31) + Aug (31) + Sep (30) + Oct (31) = 184
  assert.equal(countOpenNights(summer, '2026-01-01', '2027-01-01'), 184);
});

test('an empty or inverted range counts nothing', () => {
  assert.equal(countOpenNights(summer, '2026-06-01', '2026-06-01'), 0);
  assert.equal(countOpenNights(summer, '2026-07-01', '2026-06-01'), 0);
});

test('a leap day inside a wrapping window is open', () => {
  assert.equal(isOpenOn(winter, '2028-02-29'), true);
  assert.equal(countOpenNights(winter, '2028-02-01', '2028-03-01'), 29);
});

// ── Storage hygiene ─────────────────────────────────────────────────────

test('a nonsense row is clamped rather than trusted into the projection', () => {
  const p = normalizePeriod({ startMonth: 0, startDay: 99, endMonth: 47, endDay: -3 });
  assert.deepEqual(p, { startMonth: 1, startDay: 31, endMonth: 12, endDay: 1, note: null });
});

test('the description reads the way an operator would say it', () => {
  assert.equal(describePeriods(summer), 'May 1 to Oct 31');
  assert.equal(describePeriods(winter), 'Nov 1 to Apr 30');
  assert.equal(
    describePeriods([
      { startMonth: 5, startDay: 1, endMonth: 10, endDay: 31 },
      { startMonth: 12, startDay: 20, endMonth: 12, endDay: 31 },
    ]),
    'May 1 to Oct 31, Dec 20 to Dec 31',
  );
});

// ── The code-maintained windows the revenue projection also honours ──────
// (src/lib/forecast-operating-windows.ts; see its header for why there are
// two sources and why a home is open only when both agree.)

test('79 Main is seasonal, June 1 through October 20, and returns every year', () => {
  assert.equal(isOperatingOnDate('79_main', '2026-06-01'), true);
  assert.equal(isOperatingOnDate('79_main', '2026-10-20'), true, 'the 20th is the last day');
  assert.equal(isOperatingOnDate('79_main', '2026-10-21'), false);
  assert.equal(isOperatingOnDate('79_main', '2026-12-25'), false);
  assert.equal(isOperatingOnDate('79_main', '2027-05-31'), false);
  assert.equal(isOperatingOnDate('79_main', '2027-06-01'), true, 'the season comes back');
  assert.equal(opensInYear('79_main', 2027), true);
  assert.equal(opensInYear('79_main', 2030), true);
});

test('73 Rocky Neck has no end date: the sale was called off', () => {
  assert.equal(isOperatingOnDate('73_rocky_neck', '2026-11-15'), true);
  assert.equal(isOperatingOnDate('73_rocky_neck', '2026-12-25'), true);
  assert.equal(opensInYear('73_rocky_neck', 2027), true);
  assert.equal(opensInYear('73_rocky_neck', 2028), true);
});

test('an offboarded home is shut for good, so nothing projects it a November', () => {
  // 4 Brier Neck: notice given 2026-08-31, not renewed for 2027.
  assert.equal(isOperatingOnDate('4_brier_neck', '2026-08-15'), true);
  assert.equal(isOperatingOnDate('4_brier_neck', '2026-11-15'), false);
  assert.equal(isOperatingOnDate('4_brier_neck', '2027-07-15'), false);
  assert.equal(opensInYear('4_brier_neck', 2027), false);
});

test('16 Waterman runs May to October', () => {
  assert.equal(isOperatingOnDate('16_waterman', '2026-10-31'), true);
  assert.equal(isOperatingOnDate('16_waterman', '2026-11-01'), false);
  assert.equal(isOperatingOnDate('16_waterman', '2027-05-01'), true);
});

test('a home with no window is open every day', () => {
  assert.equal(isOperatingOnDate('3_south_st', '2028-02-29'), true);
});

test('30 Woodward runs May to the end of November, and is shut all winter', () => {
  // Not fully insulated, so the closure is a property fact and recurs.
  assert.equal(isOperatingOnDate('30_woodward', '2026-11-30'), true, 'the 30th is the last night');
  assert.equal(isOperatingOnDate('30_woodward', '2026-12-01'), false);
  assert.equal(isOperatingOnDate('30_woodward', '2027-01-15'), false);
  assert.equal(isOperatingOnDate('30_woodward', '2027-04-30'), false, 'April stays shut');
  assert.equal(isOperatingOnDate('30_woodward', '2027-05-01'), true, 'reopens in May');
  assert.equal(opensInYear('30_woodward', 2027), true);
  assert.equal(opensInYear('30_woodward', 2030), true, 'the season recurs, it is not an exit');
});
