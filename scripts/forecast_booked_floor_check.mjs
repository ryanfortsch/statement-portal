/**
 * A forecast must never sit below the book. Pure arithmetic, no database.
 *
 * Two floors, both of which the model claimed and neither of which it kept:
 *
 *   1. Part A carries a 1x floor, so Part A alone never falls under booked
 *      revenue. The 50/50 blend with Part B broke that: a property already
 *      booked past the benchmark pins its ratio at exactly 1, so Part A
 *      EQUALS booked, and averaging it with a smaller Part B lands under.
 *      On 2026-09-02 that was ten of seventeen properties for September.
 *
 *   2. The occupancy benchmark is an EXPECTED FINAL, so it cannot sit below
 *      what a month has already sold. September's calibrated benchmark read
 *      45.9% against a portfolio already booked past it with four weeks left
 *      to sell, which says the month ends below where it already stands.
 *
 * Run: node --experimental-strip-types scripts/forecast_booked_floor_check.mjs
 */

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };

/* -- floor 1: the blend, mirroring forecast-smart.ts ---------------------- */
const project = (bookedRev, partA, partB) => {
  let g = partA != null ? 0.5 * partA + 0.5 * partB : partB;
  if (bookedRev > g) g = bookedRev;      // the floor under test
  return g;
};

// Real September 2026 shapes: booked, Part A (ratio pinned at 1), Part B.
const SEPT = [
  ['17 Beach',        35159, 35159, 21321],
  ['21 Horton',       24533, 24533, 18221],
  ['19 Rackliffe',    16577, 16577, 12282],
  ['30 Woodward',     12408, 12408, 10945],
  ['53 Rocky Neck',   11590, 11590, 10405],
  ['79 Main',          8954,  8954,  6838],
  ['20 Hammond',       7599,  7599,  6210],
  ['36 Granite',       6527,  6527,  5318],
  ['53 RN Downstairs', 4859,  4859,  4246],
];
for (const [name, booked, a, b] of SEPT) {
  const got = project(booked, a, b);
  if (got < booked - 0.005) fail(`${name}: projected ${got.toFixed(0)} below booked ${booked}`);
  // Without the floor these all land under, which is what makes the case real.
  if (0.5 * a + 0.5 * b >= booked) fail(`${name} is no longer a floor-violating fixture; pick another`);
}

// A property genuinely pacing behind still gets its scale-up: the floor must
// not flatten growth, only prevent a projection under the book.
{
  const got = project(4790, 7329, 6468);
  if (Math.abs(got - 6898.5) > 0.01) fail(`under-booked property must keep its blend, got ${got}`);
}
// No bookings at all: pure Part B, floor is inert.
{
  const got = project(0, null, 9000);
  if (got !== 9000) fail(`a month with no bookings must be pure Part B, got ${got}`);
}

/* -- the current month must forecast SOME pickup -------------------------- */
// It used to print the raw book and stop, so the month in progress was
// forecast to gain nothing at all, even standing on the 1st.
const currentMonth = (booked, blended, dayOfMonth, daysInMonth) => {
  const remaining = Math.max(0, Math.min(1, (daysInMonth - dayOfMonth + 1) / daysInMonth));
  const g = booked + Math.max(0, blended - booked) * remaining;
  return Math.max(g, booked);
};
// On the 1st every day is still ahead: the full uplift applies.
if (Math.abs(currentMonth(339, 361, 1, 31) - 361) > 0.01) {
  fail('on the 1st the current month must take the whole uplift');
}
// On the last day nothing is left to sell: the book stands.
if (Math.abs(currentMonth(339, 361, 31, 31) - 339 - 22 / 31) > 0.01) {
  fail('on the last day the current month must be back to essentially the book');
}
// Mid-month lands in between, and monotonically.
{
  let prev = Infinity;
  for (let d = 1; d <= 31; d++) {
    const v = currentMonth(339, 361, d, 31);
    if (v > prev + 1e-9) fail(`current-month uplift must shrink as the month runs out (day ${d})`);
    if (v < 339 - 1e-9) fail(`current-month projection fell under the book on day ${d}`);
    prev = v;
  }
}
// A month already booked past its blend keeps the book, never less.
if (currentMonth(400, 361, 5, 31) !== 400) fail('a book above the blend must survive the current-month rule');

/* -- floor 2: the benchmark ---------------------------------------------- */
const multiplier = (pacingPct, benchPct) => {
  const hist = Math.max(benchPct, pacingPct);   // the floor under test
  return pacingPct > 0 && hist > pacingPct ? hist / pacingPct : 1;
};
// September: already booked past the calibrated bar. Must not imply decline.
if (multiplier(48.0, 45.9) < 1) fail('a month booked past its benchmark must never imply decline');
if (multiplier(48.0, 45.9) !== 1) fail('a month booked past its benchmark should sit at 1x, not scale up');
// A month genuinely behind still scales.
{
  const m = multiplier(31.7, 53.1);
  if (Math.abs(m - 53.1 / 31.7) > 1e-9) fail(`a month behind its benchmark must still scale up, got ${m}`);
}
// Nothing booked yet: no division blow-up.
if (multiplier(0, 55.9) !== 1) fail('an unbooked month must return a 1x multiplier, not Infinity');

console.log(failures === 0
  ? 'PASS - the blend never prints under the book across nine real September shapes, under-booked properties keep their scale-up, the current month takes its full uplift on the 1st and none on the last day while never dipping under the book, and the benchmark never implies a month ends below where it already stands.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
