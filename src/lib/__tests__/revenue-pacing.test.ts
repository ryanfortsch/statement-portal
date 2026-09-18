import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pacedMonthLift,
  projectOccupancy,
  type MonthContribution,
  type PacingFill,
  type PacingPricing,
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

/** 30 sellable nights at a calibrated 90% target. */
const fill: PacingFill = { targetNights: 27 };

/**
 * What the open nights are worth: last year's market rate for the same
 * weekday and holiday, already scaled by this home's achieved premium.
 */
const pricing: PacingPricing = {
  openNightRate: 380,
  avgStayNights: 4,
  cleaningPerStay: 290,
  openNights: 8,
};

const add = (a: MonthContribution, b: MonthContribution): MonthContribution => ({
  revenue: a.revenue + b.revenue,
  nights: a.nights + b.nights,
  stays: a.stays + b.stays,
  cleaning: a.cleaning + b.cleaning,
  calendarNights: a.calendarNights + b.calendarNights,
});

const adr = (m: MonthContribution) => m.revenue / m.nights;
const near = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, msg ?? `${a} vs ${b}`);
const NOTHING = { revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 0 };

// ── Safety: nothing outside the pacing branch may move ──────────────────

test('a home already at its target adds nothing', () => {
  assert.deepEqual(pacedMonthLift(booked, { targetNights: 22 }, pricing), NOTHING);
});

test('a home past its target is never dragged back down', () => {
  assert.deepEqual(pacedMonthLift(booked, { targetNights: 15 }, pricing), NOTHING);
});

test('a month with no open nights left adds nothing however far below target', () => {
  assert.deepEqual(
    pacedMonthLift(booked, { targetNights: 30 }, { ...pricing, openNights: 0 }),
    NOTHING,
  );
});

// ── The whole point: a home with nothing booked still projects ──────────

test('a home with zero bookings fills to its whole target', () => {
  const empty: MonthContribution = {
    revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 0,
  };
  const lift = pacedMonthLift(empty, { targetNights: 9 }, { ...pricing, openNights: 31 });
  assert.equal(lift.nights, 9);
  assert.equal(lift.calendarNights, 9);
  near(lift.revenue, 9 * 380);
  near(lift.stays, 9 / 4);
  near(lift.cleaning, (9 / 4) * 290);
});

test('the December case: an empty open home is no longer invisible to the projection', () => {
  // Sixteen of eighteen managed homes had no December booking at all. Under
  // the old booked-nights multiplier every one of them projected zero, so the
  // month's whole figure rested on the two that did.
  const empty: MonthContribution = {
    revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 0,
  };
  const oldModelWouldAdd = 0; // booked calendar nights x (multiplier - 1) = 0
  const lift = pacedMonthLift(empty, { targetNights: 9.3 }, { ...pricing, openNights: 31 });
  assert.ok(lift.nights > oldModelWouldAdd);
  near(lift.nights, 9.3);
});

test('a home closed for the month has no open nights, so it stays at zero', () => {
  const empty: MonthContribution = {
    revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 0,
  };
  // A shut home's target is taken against zero sellable nights AND it has no
  // open dates, so both guards agree.
  assert.deepEqual(
    pacedMonthLift(empty, { targetNights: 0 }, { ...pricing, openNights: 0 }),
    NOTHING,
  );
});

// ── Nights ──────────────────────────────────────────────────────────────

test('the added nights are the shortfall against target, as one figure', () => {
  const lift = pacedMonthLift(booked, fill, { ...pricing, openNights: 20 });
  near(lift.calendarNights, 5);
  // A projected night is a physical night and a sold night in the same
  // month, so the ADR denominator grows by exactly the nights that fill.
  assert.equal(lift.nights, lift.calendarNights);
});

test('the projection cannot add more nights than are open', () => {
  const lift = pacedMonthLift(booked, { targetNights: 30 }, { ...pricing, openNights: 3 });
  assert.equal(lift.nights, 3);
  near(lift.revenue, 3 * 380);
});

// ── Revenue: open nights price at the market analog, not the booked ADR ──

test('the added revenue is added nights × the open-night rate', () => {
  const lift = pacedMonthLift(booked, fill, { ...pricing, openNights: 20 });
  near(lift.revenue, 5 * 380);
});

test('the projected ADR settles between the booked ADR and the open-night rate', () => {
  const projected = add(booked, pacedMonthLift(booked, fill, { ...pricing, openNights: 20 }));
  assert.equal(Math.round(adr(booked)), 590);
  assert.ok(adr(projected) < adr(booked));
  assert.ok(adr(projected) > pricing.openNightRate!);
  near(adr(projected), (12400 + 5 * 380) / (21 + 5));
});

test('with no market analog the open nights fall back to the booked ADR', () => {
  const lift = pacedMonthLift(booked, fill, { ...pricing, openNightRate: null, openNights: 20 });
  near(lift.revenue, 5 * (12400 / 21));
});

// ── Stays and cleaning follow the added nights ──────────────────────────

test('added stays are added nights over the length of stay, each with a cleaning', () => {
  const lift = pacedMonthLift(booked, fill, { ...pricing, openNights: 20 });
  near(lift.stays, 5 / 4);
  near(lift.cleaning, (5 / 4) * 290);
});

test('with no length of stay given, the booked month supplies its own', () => {
  const lift = pacedMonthLift(booked, fill, { ...pricing, avgStayNights: 0, openNights: 20 });
  near(lift.stays, 5 / (21 / 5));
});

test('a month with nights but no stays of its own projects nights and revenue, not stays', () => {
  const crossing = { ...booked, revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 3 };
  const lift = pacedMonthLift(crossing, { targetNights: 6 }, { ...pricing, avgStayNights: 0, openNights: 20 });
  near(lift.nights, 3);
  near(lift.revenue, 3 * 380);
  assert.equal(lift.stays, 0);
  assert.equal(lift.cleaning, 0);
});

test('cleaning participates, so the projected payout does not overstate itself', () => {
  const lift = pacedMonthLift(booked, fill, { ...pricing, openNights: 20 });
  const projected = add(booked, lift);
  const payout = (m: MonthContribution) => m.revenue - m.revenue * 0.25 - m.cleaning;
  const revenueOnly = { ...booked, revenue: projected.revenue };
  assert.ok(payout(projected) < payout(revenueOnly));
});

// ── Occupancy ───────────────────────────────────────────────────────────

test('occupancy carries toward the target the projection is chasing', () => {
  const lift = pacedMonthLift(booked, fill, { ...pricing, openNights: 20 });
  const { occupancyPct, nightsUsed } = projectOccupancy({
    bookedCalendarNights: booked.calendarNights,
    calendarNightsDelta: lift.calendarNights,
    bookableNights: 30,
    bookedOccupancyPct: (booked.calendarNights / 30) * 100,
  });
  // 22 booked + 5 projected = 27 of 30.
  assert.equal(Math.round(occupancyPct! * 10) / 10, 90);
  assert.equal(nightsUsed, 27);
});

test('a home already near full cannot absorb the lift: capped at 100%', () => {
  const nearlyFull = { ...booked, calendarNights: 29 };
  const lift = pacedMonthLift(nearlyFull, { targetNights: 40 }, { ...pricing, openNights: null });
  const { occupancyPct, nightsUsed } = projectOccupancy({
    bookedCalendarNights: nearlyFull.calendarNights,
    calendarNightsDelta: lift.calendarNights,
    bookableNights: 30,
    bookedOccupancyPct: (29 / 30) * 100,
  });
  assert.equal(occupancyPct, 100);
  // The portfolio rollup must see the capped figure, or the headline drifts
  // past what the cards add up to.
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
    const lift = pacedMonthLift(
      { ...booked, calendarNights: home.calendarNights },
      { targetNights: 27 },
      { ...pricing, openNights: null },
    );
    const { nightsUsed } = projectOccupancy({
      bookedCalendarNights: home.calendarNights,
      calendarNightsDelta: lift.calendarNights,
      bookableNights: home.bookable,
      bookedOccupancyPct: (home.calendarNights / home.bookable) * 100,
    });
    used += nightsUsed;
    bookable += home.bookable;
  }
  // 27 + 27 + 29 (already past target, untouched) = 83 of 90.
  assert.equal(used, 83);
  assert.ok(used <= bookable, 'the rollup can never claim more nights than exist');
});
