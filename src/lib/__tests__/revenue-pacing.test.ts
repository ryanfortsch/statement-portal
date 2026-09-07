import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pacedMonthLift,
  projectOccupancy,
  type MonthContribution,
} from '../revenue-pacing.ts';

/**
 * One property's booked September, as /revenue would have it before any
 * projection. calendarNights sits one above nights because a stay crossed
 * into the month.
 */
const booked: MonthContribution = {
  revenue: 12400,
  nights: 21,
  stays: 5,
  cleaning: 1450,
  calendarNights: 22,
};

/** A plausible mid-month lift: pacing 62%, Gloucester's September 77%. */
const MULT = 1.24;

const add = (a: MonthContribution, b: MonthContribution): MonthContribution => ({
  revenue: a.revenue + b.revenue,
  nights: a.nights + b.nights,
  stays: a.stays + b.stays,
  cleaning: a.cleaning + b.cleaning,
  calendarNights: a.calendarNights + b.calendarNights,
});

const adr = (m: MonthContribution) => m.revenue / m.nights;

// ── Safety: nothing outside the pacing branch may move ──────────────────

test('multiplier 1 adds nothing, so Actuals and past months are untouched', () => {
  const lift = pacedMonthLift(booked, 1);
  assert.deepEqual(lift, { revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 0 });
});

test('a multiplier below 1 never subtracts: the projection is floored, not two-way', () => {
  assert.deepEqual(pacedMonthLift(booked, 0.8), {
    revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 0,
  });
});

// ── The bug this module exists to fix ───────────────────────────────────

test('ADR holds under the projection: revenue and nights move together', () => {
  const projected = add(booked, pacedMonthLift(booked, MULT));
  assert.equal(Math.round(adr(projected) * 100), Math.round(adr(booked) * 100));
});

test('the old revenue-only projection inflated ADR by the multiplier', () => {
  // What the code did before: lift the dollars, leave the nights alone.
  const revenueOnly = { ...booked, revenue: booked.revenue * MULT };
  assert.equal(Math.round(adr(revenueOnly)), Math.round(adr(booked) * MULT));
  // $590/night booked was reported as $732/night, a rate nobody had booked.
  assert.equal(Math.round(adr(booked)), 590);
  assert.equal(Math.round(adr(revenueOnly)), 732);
});

test('every figure the month contributes scales by the same multiplier', () => {
  const projected = add(booked, pacedMonthLift(booked, MULT));
  for (const k of ['revenue', 'nights', 'stays', 'cleaning', 'calendarNights'] as const) {
    assert.ok(
      Math.abs(projected[k] - booked[k] * MULT) < 1e-9,
      `${k} did not scale: ${projected[k]} vs ${booked[k] * MULT}`,
    );
  }
});

test('cleaning participates, so the projected payout stops overstating itself', () => {
  const projected = add(booked, pacedMonthLift(booked, MULT));
  const payout = (m: MonthContribution) => m.revenue - m.revenue * 0.25 - m.cleaning;
  // The old projection carried month-to-date cleaning against a full-month
  // revenue figure, which paid the owner more than the month can support.
  const revenueOnly = { ...booked, revenue: booked.revenue * MULT };
  assert.ok(payout(projected) < payout(revenueOnly));
  assert.equal(Math.round(payout(revenueOnly) - payout(projected)), Math.round(booked.cleaning * (MULT - 1)));
});

// ── Occupancy ───────────────────────────────────────────────────────────

test('occupancy carries toward the benchmark the multiplier is chasing', () => {
  const lift = pacedMonthLift(booked, MULT);
  const { occupancyPct, nightsUsed } = projectOccupancy({
    bookedCalendarNights: booked.calendarNights,
    calendarNightsDelta: lift.calendarNights,
    bookableNights: 30,
    bookedOccupancyPct: (booked.calendarNights / 30) * 100,
  });
  // 22/30 = 73.3% booked, x1.24 = 90.9% projected.
  assert.equal(Math.round(occupancyPct! * 10) / 10, 90.9);
  assert.equal(Math.round(nightsUsed * 100) / 100, 27.28);
});

test('a home already near full cannot absorb the lift: capped at 100%', () => {
  const nearlyFull = { ...booked, calendarNights: 29 };
  const lift = pacedMonthLift(nearlyFull, MULT);
  const { occupancyPct, nightsUsed } = projectOccupancy({
    bookedCalendarNights: nearlyFull.calendarNights,
    calendarNightsDelta: lift.calendarNights,
    bookableNights: 30,
    bookedOccupancyPct: (29 / 30) * 100,
  });
  assert.equal(occupancyPct, 100);
  // The portfolio rollup must see the capped figure, not 29 x 1.24 = 35.96,
  // or the headline drifts past what the cards add up to.
  assert.equal(nightsUsed, 30);
});

test('no projection leaves occupancy alone and consumes no extra nights', () => {
  const { occupancyPct, nightsUsed } = projectOccupancy({
    bookedCalendarNights: 22,
    calendarNightsDelta: 0,
    bookableNights: 30,
    bookedOccupancyPct: 73.3,
  });
  assert.equal(occupancyPct, 73.3);
  // nightsUsed - bookedCalendarNights is what the portfolio rollup adds, so
  // this has to be exactly zero for statement and booked months.
  assert.equal(nightsUsed - 22, 0);
});

test('a property with no bookable nights keeps its base figure rather than dividing by zero', () => {
  const { occupancyPct, nightsUsed } = projectOccupancy({
    bookedCalendarNights: 0,
    calendarNightsDelta: 4,
    bookableNights: 0,
    bookedOccupancyPct: null,
  });
  assert.equal(occupancyPct, null);
  assert.equal(nightsUsed, 4);
});

test('portfolio occupancy is the aggregate of the cards, capped homes included', () => {
  const fleet = [
    { calendarNights: 22, bookable: 30 },
    { calendarNights: 19, bookable: 30 },
    { calendarNights: 29, bookable: 30 }, // hits the cap
  ];
  let used = 0;
  let bookable = 0;
  for (const home of fleet) {
    const lift = pacedMonthLift({ ...booked, calendarNights: home.calendarNights }, MULT);
    const { nightsUsed } = projectOccupancy({
      bookedCalendarNights: home.calendarNights,
      calendarNightsDelta: lift.calendarNights,
      bookableNights: home.bookable,
      bookedOccupancyPct: (home.calendarNights / home.bookable) * 100,
    });
    used += nightsUsed;
    bookable += home.bookable;
  }
  // 27.28 + 23.56 + 30 (capped from 35.96) = 80.84 of 90.
  assert.equal(Math.round(used * 100) / 100, 80.84);
  assert.ok(used <= bookable, 'the rollup can never claim more nights than exist');
});
