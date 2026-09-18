import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PICKUP_MULTIPLIER,
  MIN_SHARE,
  measureBookingCurve,
  projectedFinalPct,
  type PickupStay,
} from '../booking-pickup.ts';

/** A stay covering a whole month, booked on a given date. */
const stay = (checkIn: string, checkOut: string, bookedAt: string | null): PickupStay => ({
  checkIn,
  checkOut,
  bookedAt,
});

/** Build n one-week stays in a month, m of them booked before the cutoff. */
function month(ym: string, early: number, late: number): PickupStay[] {
  const out: PickupStay[] = [];
  for (let i = 0; i < early; i++) out.push(stay(`${ym}-01`, `${ym}-08`, `${ym}-01`));
  for (let i = 0; i < late; i++) out.push(stay(`${ym}-01`, `${ym}-08`, `${ym}-25`));
  return out;
}

// ── Measuring the curve ─────────────────────────────────────────────────

test('the share is the fraction of final nights already on the books by the day', () => {
  // 9 stays x 7 nights booked on the 1st, 1 stay x 7 booked on the 25th.
  const c = measureBookingCurve([...month('2026-07', 9, 1), ...month('2026-08', 9, 1)], ['2026-07', '2026-08'], 18);
  assert.equal(c.months.length, 2);
  assert.equal(c.months[0].finalNights, 70);
  assert.equal(c.months[0].bookedByDay, 63);
  assert.ok(Math.abs(c.share! - 0.9) < 1e-9);
});

test('a month too thin to trust is discarded, and one month alone yields no curve', () => {
  const c = measureBookingCurve([...month('2026-07', 9, 1), ...month('2026-08', 1, 0)], ['2026-07', '2026-08'], 18);
  assert.equal(c.months.length, 1, 'August has 7 nights, under the floor');
  assert.equal(c.share, null, 'one qualifying month is not a curve');
  assert.match(c.discarded[0].reason, /only 7 nights/);
});

test('a month missing booking dates is discarded rather than read as unbooked', () => {
  const missing = [...month('2026-07', 9, 1)];
  missing.push(stay('2026-07-01', '2026-07-15', null)); // 14 nights, no date
  const c = measureBookingCurve([...missing, ...month('2026-08', 9, 1)], ['2026-07', '2026-08'], 18);
  assert.ok(c.months.every((m) => m.month !== '2026-07'));
  assert.match(c.discarded.find((d) => d.month === '2026-07')!.reason, /no booked_at/);
});

test('the cutoff clamps to the length of a short month', () => {
  // Day 31 of February resolves to the 28th rather than an impossible date.
  const feb = [
    ...Array.from({ length: 10 }, () => stay('2026-02-01', '2026-02-08', '2026-02-27')),
    ...Array.from({ length: 10 }, () => stay('2026-02-01', '2026-02-08', '2026-02-28')),
  ];
  const c = measureBookingCurve([...feb, ...month('2026-08', 9, 1)], ['2026-02', '2026-08'], 31);
  const f = c.months.find((m) => m.month === '2026-02')!;
  assert.equal(f.bookedByDay, f.finalNights, 'everything booked by the 28th counts');
});

test('only the nights inside the month count, not the whole stay', () => {
  // A stay spanning the month boundary contributes only its in-month nights.
  const crossing = [stay('2026-07-28', '2026-08-04', '2026-07-01')];
  const c = measureBookingCurve([...crossing, ...month('2026-07', 9, 1), ...month('2026-08', 9, 1)], ['2026-07'], 18);
  // July gains 4 nights (28,29,30,31) on top of its 70.
  assert.equal(c.months[0].finalNights, 74);
});

// ── Projecting the finish ───────────────────────────────────────────────

test('a month in progress is projected past what it has already booked', () => {
  const c = measureBookingCurve([...month('2026-07', 9, 1), ...month('2026-08', 9, 1)], ['2026-07', '2026-08'], 18);
  // 90% on the books by day 18, so 58% booked projects to 58 / 0.9.
  assert.ok(Math.abs(projectedFinalPct(58, c) - 58 / 0.9) < 1e-9);
});

test('the projection never falls below what is already sold', () => {
  const c = measureBookingCurve([...month('2026-07', 10, 0), ...month('2026-08', 10, 0)], ['2026-07', '2026-08'], 18);
  assert.equal(c.share, 1, 'everything was booked early');
  assert.equal(projectedFinalPct(58, c), 58, 'a full curve adds nothing');
});

test('with no usable curve the pickup floor is inert', () => {
  const c = measureBookingCurve([], [], 18);
  assert.equal(c.share, null);
  assert.equal(projectedFinalPct(58, c), 58);
});

test('nothing booked projects to nothing: there is no pace to extrapolate', () => {
  const c = measureBookingCurve([...month('2026-07', 9, 1), ...month('2026-08', 9, 1)], ['2026-07', '2026-08'], 18);
  assert.equal(projectedFinalPct(0, c), 0);
});

test('a curve the guard admitted is never silently truncated by the cap', () => {
  // 55% booked by day 18 implies 1.82x. MIN_SHARE admits it, so the cap must
  // not quietly hold it at something smaller: the page would print one target
  // and the projection would use another.
  const thin = [
    ...Array.from({ length: 11 }, () => stay('2026-07-01', '2026-07-08', '2026-07-01')),
    ...Array.from({ length: 9 }, () => stay('2026-07-01', '2026-07-08', '2026-07-28')),
    ...Array.from({ length: 11 }, () => stay('2026-08-01', '2026-08-08', '2026-08-01')),
    ...Array.from({ length: 9 }, () => stay('2026-08-01', '2026-08-08', '2026-08-28')),
  ];
  const c = measureBookingCurve(thin, ['2026-07', '2026-08'], 18);
  assert.ok(Math.abs(c.share! - 0.55) < 1e-9);
  assert.ok(Math.abs(projectedFinalPct(40, c) - 40 / 0.55) < 1e-9);
  // The cap is the reciprocal of the guard, so it can only ever catch a share
  // the guard would already have thrown out.
  assert.equal(MAX_PICKUP_MULTIPLIER, 1 / MIN_SHARE);
});

test('an impossible share is still capped', () => {
  const impossible = { share: 0.1, dayOfMonth: 18, months: [], discarded: [], basis: 'pooled' as const };
  assert.equal(projectedFinalPct(20, impossible), 20 * MAX_PICKUP_MULTIPLIER);
});

test('the projection never claims more than a full month', () => {
  const c = { share: 0.8, dayOfMonth: 18, months: [], discarded: [], basis: 'pooled' as const };
  assert.equal(projectedFinalPct(95, c), 100, '95 / 0.8 would be 118');
});

// ── Seasonality: same month-of-year speaks first ────────────────────────

test('months of the same month-of-year are preferred over pooled ones', () => {
  const stays = [
    // Two past Septembers, booked late: share 0.7.
    ...month('2025-09', 7, 3),
    ...month('2024-09', 7, 3),
    // Two summers, booked early: share 1.0. Pooling would drag September up.
    ...month('2026-07', 10, 0),
    ...month('2026-08', 10, 0),
  ];
  const c = measureBookingCurve(stays, ['2024-09', '2025-09', '2026-07', '2026-08'], 18, 9);
  assert.equal(c.basis, 'same-month');
  assert.ok(Math.abs(c.share! - 0.7) < 1e-9);
  assert.deepEqual(c.months.map((m) => m.month), ['2024-09', '2025-09']);
});

test('with too little same-month history it pools, and says so', () => {
  const stays = [...month('2025-09', 7, 3), ...month('2026-07', 10, 0), ...month('2026-08', 10, 0)];
  const c = measureBookingCurve(stays, ['2025-09', '2026-07', '2026-08'], 18, 9);
  assert.equal(c.basis, 'pooled', 'one September is not a September curve');
  assert.equal(c.months.length, 3);
});

// ── Undated nights bias the share down if left in the denominator ───────

test('the share is measured on nights that carry a booking date', () => {
  // 20 stays x 7 nights; one of them undated. Leaving it in the denominator
  // would score it as never booked and understate the share.
  const withGap = [...month('2026-07', 19, 0), stay('2026-07-01', '2026-07-08', null)];
  const c = measureBookingCurve([...withGap, ...month('2026-08', 20, 0)], ['2026-07', '2026-08'], 18);
  const july = c.months.find((m) => m.month === '2026-07')!;
  assert.equal(july.share, 1, 'the 19 dated stays were all booked early');
  assert.ok(july.finalNights > july.bookedByDay, 'the undated night still counts as inventory');
});

// ── Activation ──────────────────────────────────────────────────────────

test('a home live for only part of a month does not contribute to that month', () => {
  const late = month('2026-07', 10, 0).map((s) => ({ ...s, activatedAt: '2026-07-15' }));
  const c = measureBookingCurve([...late, ...month('2026-08', 10, 0), ...month('2026-06', 10, 0)], ['2026-06', '2026-07', '2026-08'], 18);
  assert.ok(!c.months.some((m) => m.month === '2026-07'), 'July had only the mid-month home');
  assert.match(c.discarded.find((d) => d.month === '2026-07')!.reason, /only 0 nights/);
});

test('the real September case: 58% booked at day 18 is on pace for about 62%', () => {
  // Jun/Jul/Aug 2026 measured 93.1%, 97.7% and 90.0% booked by day 18.
  const curve = {
    share: (0.931 + 0.977 + 0.9) / 3,
    dayOfMonth: 18,
    months: [],
    discarded: [],
    basis: 'pooled' as const,
  };
  const projected = projectedFinalPct(58.4, curve);
  assert.equal(Math.round(projected * 10) / 10, 62.4);
  assert.ok(projected > 58.4, 'the month does not stop where it stands');
});

// ── The data window ─────────────────────────────────────────────────────

test('a month only partly inside the data window is discarded, not measured', () => {
  // The read starts 2026-07-10, so July is truncated: the stays that checked
  // out earlier are simply absent, and its share would be measured on the
  // remainder rather than on July.
  const c = measureBookingCurve(
    [...month('2026-07', 9, 1), ...month('2026-08', 9, 1), ...month('2026-09', 9, 1)],
    ['2026-07', '2026-08', '2026-09'],
    18,
    undefined,
    '2026-07-10',
  );
  assert.ok(!c.months.some((m) => m.month === '2026-07'));
  assert.match(c.discarded.find((d) => d.month === '2026-07')!.reason, /before the data window/);
  assert.deepEqual(c.months.map((m) => m.month), ['2026-08', '2026-09']);
});

test('the window guard fires before the same-month preference can promote a truncated month', () => {
  // September is the month being projected AND the boundary month. Without
  // the guard its truncated share would be preferred over the sound pooled
  // months, which is the worst case rather than a harmless one.
  const stays = [
    ...month('2025-09', 2, 8), // truncated remnant, share 0.2
    ...month('2026-07', 10, 0),
    ...month('2026-08', 10, 0),
    ...month('2026-09', 10, 0),
  ];
  const c = measureBookingCurve(stays, ['2025-09', '2026-07', '2026-08', '2026-09'], 18, 9, '2025-09-18');
  assert.ok(!c.months.some((m) => m.month === '2025-09'), 'the truncated September is out');
  assert.equal(c.basis, 'pooled', 'one sound September is not enough to prefer');
  assert.equal(c.share, 1);
});

test('with no window given every month is measured, as before', () => {
  const c = measureBookingCurve([...month('2026-07', 9, 1), ...month('2026-08', 9, 1)], ['2026-07', '2026-08'], 18);
  assert.equal(c.months.length, 2);
});
