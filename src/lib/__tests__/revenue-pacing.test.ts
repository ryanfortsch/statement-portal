import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pacedMonthLift,
  projectOccupancy,
  type MonthContribution,
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

/** A plausible mid-month lift: pacing 62%, Gloucester's September 77%. */
const MULT = 1.24;

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
const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, msg ?? `${a} vs ${b}`);

// ── Safety: nothing outside the pacing branch may move ──────────────────

test('multiplier 1 adds nothing, so Actuals and past months are untouched', () => {
  const lift = pacedMonthLift(booked, 1, pricing);
  assert.deepEqual(lift, { revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 0 });
});

test('a multiplier below 1 never subtracts: the projection is floored, not two-way', () => {
  assert.deepEqual(pacedMonthLift(booked, 0.8, pricing), {
    revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 0,
  });
});

test('a month with no calendar nights has nothing to carry forward', () => {
  const empty = { ...booked, calendarNights: 0 };
  assert.deepEqual(pacedMonthLift(empty, MULT, pricing), {
    revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 0,
  });
});

// ── Nights: the multiplier is an occupancy ratio and only ever adds nights ─

test('the added nights are booked calendar nights × (multiplier − 1), as one figure', () => {
  const lift = pacedMonthLift(booked, MULT, pricing);
  near(lift.calendarNights, 22 * 0.24);
  // A projected night is a physical night and a sold night in the same
  // month, so the ADR denominator grows by exactly the nights that fill.
  assert.equal(lift.nights, lift.calendarNights);
});

test('the projection cannot add more nights than are open', () => {
  const lift = pacedMonthLift(booked, MULT, { ...pricing, openNights: 3 });
  assert.equal(lift.nights, 3);
  assert.equal(lift.calendarNights, 3);
  near(lift.revenue, 3 * 380);
  assert.deepEqual(pacedMonthLift(booked, MULT, { ...pricing, openNights: 0 }), {
    revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 0,
  });
});

// ── Revenue: open nights price at the market analog, not the booked ADR ──

test('the added revenue is added nights × the open-night rate', () => {
  const lift = pacedMonthLift(booked, MULT, pricing);
  near(lift.revenue, 22 * 0.24 * 380);
});

test('the projected ADR settles between the booked ADR and the open-night rate', () => {
  const projected = add(booked, pacedMonthLift(booked, MULT, pricing));
  // $590 booked, $380 open: the blend lands between, weighted by nights.
  assert.equal(Math.round(adr(booked)), 590);
  assert.ok(adr(projected) < adr(booked));
  assert.ok(adr(projected) > pricing.openNightRate!);
  near(adr(projected), (12400 + 5.28 * 380) / (21 + 5.28));
});

test('the November case: premium bookings no longer price the whole month', () => {
  // What /revenue had for November 2026 on 2026-09-16: Halloween weekend and
  // Thanksgiving week booked at $608/night, 8% paced against a 35% benchmark.
  const november: MonthContribution = {
    revenue: 49_200, nights: 81, stays: 19, cleaning: 4_750, calendarNights: 39,
  };
  const mult = 4.52;
  // Last November's market averaged about $380 a night; the fleet clears
  // about 1.5× market on the nights it sells.
  const open: PacingPricing = { openNightRate: 380 * 1.5, avgStayNights: 4, cleaningPerStay: 250, openNights: 500 };
  const lift = pacedMonthLift(november, mult, open);
  const priced = add(november, lift);
  // The old model scaled the $49.2k by 4.52 and reported $222k at $608 a
  // night. The market-priced month lands well under that.
  const oldModel = november.revenue * mult;
  assert.ok(priced.revenue < oldModel * 0.65, `${priced.revenue} vs ${oldModel}`);
  near(lift.revenue, 39 * 3.52 * 570);
  // And the projected stays are what the added nights amount to at this
  // month's length of stay, not the booked count scaled by 4.52.
  near(lift.stays, (39 * 3.52) / 4);
  assert.ok(priced.stays < november.stays * mult);
});

test('with no market analog the open nights fall back to the booked ADR', () => {
  const lift = pacedMonthLift(booked, MULT, { ...pricing, openNightRate: null });
  near(lift.revenue, 22 * 0.24 * (12400 / 21));
});

// ── Stays and cleaning follow the added nights ──────────────────────────

test('added stays are added nights over the length of stay, and each carries a cleaning', () => {
  const lift = pacedMonthLift(booked, MULT, pricing);
  near(lift.stays, (22 * 0.24) / 4);
  near(lift.cleaning, ((22 * 0.24) / 4) * 290);
});

test('with no length of stay given, the booked month supplies its own', () => {
  const lift = pacedMonthLift(booked, MULT, { ...pricing, avgStayNights: 0 });
  near(lift.stays, (22 * 0.24) / (21 / 5));
});

test('a month with calendar nights but no stays of its own projects nights and revenue, not stays', () => {
  const crossing = { ...booked, revenue: 0, nights: 0, stays: 0, cleaning: 0, calendarNights: 3 };
  const lift = pacedMonthLift(crossing, MULT, { ...pricing, avgStayNights: 0 });
  near(lift.nights, 3 * 0.24);
  near(lift.revenue, 3 * 0.24 * 380);
  assert.equal(lift.stays, 0);
  assert.equal(lift.cleaning, 0);
});

test('cleaning participates, so the projected payout does not overstate itself', () => {
  const projected = add(booked, pacedMonthLift(booked, MULT, pricing));
  const payout = (m: MonthContribution) => m.revenue - m.revenue * 0.25 - m.cleaning;
  const revenueOnly = { ...booked, revenue: projected.revenue };
  assert.ok(payout(projected) < payout(revenueOnly));
});

// ── Occupancy ───────────────────────────────────────────────────────────

test('occupancy carries toward the benchmark the multiplier is chasing', () => {
  const lift = pacedMonthLift(booked, MULT, pricing);
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
  const lift = pacedMonthLift(nearlyFull, MULT, { ...pricing, openNights: null });
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
    const lift = pacedMonthLift({ ...booked, calendarNights: home.calendarNights }, MULT, { ...pricing, openNights: null });
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
