import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_RATE_BY_DAY,
  MARKET_RATE_FIRST_DAY,
  MARKET_RATE_LAST_DAY,
  achievedRateIndex,
  blendRateIndex,
  marketAnalogDate,
  marketRateFor,
  meanMarketRate,
  shiftDays,
} from '../market-rate-by-day.ts';

// ── The table ───────────────────────────────────────────────────────────

test('the generated table is a gapless day series', () => {
  assert.equal(MARKET_RATE_FIRST_DAY, '2025-10-01');
  assert.ok(MARKET_RATE_LAST_DAY >= '2026-09-15');
  let d = MARKET_RATE_FIRST_DAY;
  let n = 0;
  while (d <= MARKET_RATE_LAST_DAY) {
    assert.ok(MARKET_RATE_BY_DAY[d] > 0, `missing ${d}`);
    d = shiftDays(d, 1);
    n += 1;
  }
  assert.equal(n, Object.keys(MARKET_RATE_BY_DAY).length);
});

// ── Weekday and holiday alignment ───────────────────────────────────────

test('a Saturday next November prices off a Saturday last November', () => {
  // 2026-11-14 is a Saturday; 364 days back is Saturday 2025-11-15.
  assert.equal(marketAnalogDate('2026-11-14'), '2025-11-15');
  assert.equal(marketRateFor('2026-11-14'), MARKET_RATE_BY_DAY['2025-11-15']);
});

test('Thanksgiving lands on Thanksgiving: the 52-week shift carries weekday-anchored holidays', () => {
  // 2026-11-26 is the fourth Thursday; 2025-11-27 was.
  assert.equal(marketAnalogDate('2026-11-26'), '2025-11-27');
});

test('a fixed-date holiday prices off the same calendar date, not the same weekday', () => {
  // 364 days before Christmas 2026 is 2025-12-26. Christmas is the date.
  assert.equal(marketAnalogDate('2026-12-25'), '2025-12-25');
  assert.equal(marketAnalogDate('2027-01-01'), '2026-01-01');
  assert.equal(marketAnalogDate('2026-10-31'), '2025-10-31');
});

test('a date whose 52-week analog predates the series widens to the nearest covered week, same weekday', () => {
  // 2026-09-16 (Wed) - 364d = 2025-09-17, before the series begins. Two weeks
  // later, 2025-10-01, is the first Wednesday on record.
  assert.equal(marketAnalogDate('2026-09-16'), '2025-10-01');
  assert.equal(new Date('2025-10-01T00:00:00Z').getUTCDay(), new Date('2026-09-16T00:00:00Z').getUTCDay());
});

test('a date beyond reach of the series has no analog', () => {
  assert.equal(marketAnalogDate('2031-05-05'), null);
  assert.equal(marketRateFor('2031-05-05'), null);
});

test('the day curve carries the shape the projection needs', () => {
  const nov = (a: string, b: string) => {
    const xs: number[] = [];
    for (let d = a; d <= b; d = shiftDays(d, 1)) xs.push(MARKET_RATE_BY_DAY[d]);
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  };
  // Thanksgiving week over early November, Christmas week over early December.
  assert.ok(nov('2025-11-20', '2025-11-29') > nov('2025-11-01', '2025-11-19') * 1.1);
  assert.ok(nov('2025-12-20', '2026-01-03') > nov('2025-12-01', '2025-12-10') * 1.1);
});

// ── Mean over open nights ───────────────────────────────────────────────

test('meanMarketRate averages only the nights it can price and says how many that was', () => {
  const { rate, covered } = meanMarketRate(['2026-11-14', '2031-05-05', '2026-11-26']);
  assert.equal(covered, 2);
  const expected = (MARKET_RATE_BY_DAY['2025-11-15'] + MARKET_RATE_BY_DAY['2025-11-27']) / 2;
  assert.ok(Math.abs(rate! - expected) < 1e-9);
  assert.deepEqual(meanMarketRate([]), { rate: null, covered: 0 });
});

// ── Achieved index ──────────────────────────────────────────────────────

const series: Record<string, number> = {};
for (let d = '2026-08-01'; d <= '2026-08-31'; d = shiftDays(d, 1)) series[d] = 500;

test('a home that clears twice the market on its booked nights indexes at 2', () => {
  const nights = [];
  for (let d = '2026-08-01'; d <= '2026-08-20'; d = shiftDays(d, 1)) nights.push({ date: d, nightly: 1000 });
  assert.equal(achievedRateIndex(nights, series), 2);
});

test('the index is revenue-weighted, so a premium Saturday counts for what it earned', () => {
  const nights = [];
  for (let d = '2026-08-01'; d <= '2026-08-14'; d = shiftDays(d, 1)) nights.push({ date: d, nightly: 500 });
  nights.push({ date: '2026-08-15', nightly: 2000 });
  // (14 x 500 + 2000) / (15 x 500) = 1.2
  assert.ok(Math.abs(achievedRateIndex(nights, series)! - 1.2) < 1e-9);
});

test('too few nights on record returns null so the caller falls back to the fleet', () => {
  const nights = [{ date: '2026-08-01', nightly: 900 }, { date: '2026-08-02', nightly: 900 }];
  assert.equal(achievedRateIndex(nights, series), null);
  assert.equal(achievedRateIndex(nights, series, 2), 1.8);
});

test('nights the series does not cover do not count', () => {
  const nights = [];
  for (let d = '2025-03-01'; d <= '2025-03-31'; d = shiftDays(d, 1)) nights.push({ date: d, nightly: 900 });
  assert.equal(achievedRateIndex(nights, series), null);
});

test('the index is clamped to a sane band', () => {
  const high = [];
  const low = [];
  for (let d = '2026-08-01'; d <= '2026-08-20'; d = shiftDays(d, 1)) {
    high.push({ date: d, nightly: 50_000 });
    low.push({ date: d, nightly: 1 });
  }
  assert.equal(achievedRateIndex(high, series), 4);
  assert.equal(achievedRateIndex(low, series), 0.4);
});

// ── Blending the month's own evidence with the trailing year ────────────

test('with no bookings in the month, the trailing-year index stands alone', () => {
  assert.equal(blendRateIndex({ yearIndex: 1.5, monthAdr: null, monthMarketRate: null, monthNights: 0 }), 1.5);
  assert.equal(blendRateIndex({ yearIndex: null, monthAdr: null, monthMarketRate: null, monthNights: 0 }), null);
});

test('with no year on record, the month\'s own bookings set the index', () => {
  assert.equal(blendRateIndex({ yearIndex: null, monthAdr: 900, monthMarketRate: 450, monthNights: 3 }), 2);
});

test('the December case: a waterfront home that clears 3x market in summer prices its open winter nights off what it actually books in December', () => {
  // Trailing-year index 2.99; December bookings at $747 a night against a
  // $450 Christmas-week market analog, 19 nights on record.
  const idx = blendRateIndex({ yearIndex: 2.99, monthAdr: 747, monthMarketRate: 450, monthNights: 19 });
  assert.ok(Math.abs(idx! - 747 / 450) < 1e-9);
  assert.ok(idx! < 1.7);
});

test('a thin month only partly overrides the year: seven nights weigh half', () => {
  const idx = blendRateIndex({ yearIndex: 3, monthAdr: 500, monthMarketRate: 500, monthNights: 7 });
  assert.ok(Math.abs(idx! - 2) < 1e-9);
});

test('the month index is clamped like the year index', () => {
  assert.equal(blendRateIndex({ yearIndex: null, monthAdr: 50_000, monthMarketRate: 400, monthNights: 20 }), 4);
  assert.equal(blendRateIndex({ yearIndex: null, monthAdr: 1, monthMarketRate: 400, monthNights: 20 }), 0.4);
});
