/**
 * Nights-basis allocator parity. Pure arithmetic, no database.
 *
 * The /revenue nights basis moves a stay's money into the months its nights
 * fall in. This proves the allocator conserves value, degrades to a no-op on
 * the ~90% of stays that sit inside one month, and clips correctly at range
 * and activation boundaries.
 *
 * Run: node --experimental-strip-types scripts/nights_basis_parity.mjs
 */
import { allocateStayByNights } from '../src/lib/revenue-nights-basis.ts';

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };
const cents = (n) => Math.round(n * 100);
const sumRev = (b) => b.reduce((a, x) => a + x.revenue, 0);
const sumNights = (b) => b.reduce((a, x) => a + x.nights, 0);

const WIDE = { rangeStart: '2020-01-01', periodEndExclusive: '2030-01-01', propStart: '2020-01-01' };

/* A1/A2 conservation over a window containing the whole stay ------------- */
const SHAPES = [
  ['one month',        '2026-08-10', '2026-08-17',  7,  5600],
  ['straddles a month','2026-08-28', '2026-09-13', 16, 15500],
  ['three months',     '2026-06-22', '2026-08-06', 45, 30271],
  ['one night',        '2026-07-04', '2026-07-05',  1,   950],
  ['awkward cents',    '2026-05-29', '2026-06-02',  4,  1000],
  ['long stay',        '2026-01-15', '2026-04-02', 77, 41234.56],
];
for (const [label, ci, co, nights, value] of SHAPES) {
  const b = allocateStayByNights({ checkIn: ci, checkOut: co, value, ...WIDE });
  if (cents(sumRev(b)) !== cents(value)) fail(`A1 ${label}: buckets sum to ${sumRev(b)}, expected ${value}`);
  if (sumNights(b) !== nights) fail(`A2 ${label}: nights sum to ${sumNights(b)}, expected ${nights}`);
}

/* A3 no-op for a stay wholly inside one month ---------------------------- */
{
  const b = allocateStayByNights({ checkIn: '2026-08-10', checkOut: '2026-08-17', value: 5600, ...WIDE });
  if (b.length !== 1) fail(`A3 expected exactly 1 bucket, got ${b.length}`);
  else if (b[0].month !== '2026-08' || cents(b[0].revenue) !== cents(5600) || b[0].nights !== 7) {
    fail(`A3 single-month stay must be byte-identical to the checkout branch, got ${JSON.stringify(b[0])}`);
  }
}

/* A4 guards -------------------------------------------------------------- */
{
  const zero = allocateStayByNights({ checkIn: '2026-08-10', checkOut: '2026-08-10', value: 500, ...WIDE });
  if (zero.length !== 0) fail('A4 same-day stay must produce no buckets');
  const nonPos = allocateStayByNights({ checkIn: '2026-08-10', checkOut: '2026-08-17', value: 0, ...WIDE });
  if (nonPos.length !== 0) fail('A4 zero-value stay must produce no buckets');
  const outside = allocateStayByNights({
    checkIn: '2026-08-10', checkOut: '2026-08-17', value: 5600,
    propStart: '2026-01-01', rangeStart: '2026-09-01', periodEndExclusive: '2026-10-01',
  });
  if (outside.length !== 0) fail('A4 stay entirely outside the range must produce no buckets');
  const afterCheckout = allocateStayByNights({
    checkIn: '2026-08-10', checkOut: '2026-08-17', value: 5600,
    propStart: '2026-09-01', rangeStart: '2020-01-01', periodEndExclusive: '2030-01-01',
  });
  if (afterCheckout.length !== 0) fail('A4 propStart past check_out must produce no buckets');
}

/* A5 activation: whole value spreads over post-activation nights only ----- */
{
  const b = allocateStayByNights({
    checkIn: '2026-06-10', checkOut: '2026-06-20', value: 10000,
    propStart: '2026-06-15', rangeStart: '2020-01-01', periodEndExclusive: '2030-01-01',
  });
  if (sumNights(b) !== 5) fail(`A5 expected 5 allocatable nights, got ${sumNights(b)}`);
  if (cents(sumRev(b)) !== cents(10000)) fail(`A5 whole value must land on post-activation nights, got ${sumRev(b)}`);
}

/* A6 the worked example: 21 Horton GY-8QDbYkKX --------------------------- */
{
  const b = allocateStayByNights({ checkIn: '2026-08-28', checkOut: '2026-09-13', value: 15500, ...WIDE });
  const aug = b.find((x) => x.month === '2026-08');
  const sep = b.find((x) => x.month === '2026-09');
  if (!aug || !sep) fail('A6 expected an August and a September bucket');
  else {
    if (aug.nights !== 4 || sep.nights !== 12) fail(`A6 nights split ${aug.nights}/${sep.nights}, expected 4/12`);
    if (cents(aug.revenue) !== cents(3875)) fail(`A6 August revenue ${aug.revenue}, expected 3875.00`);
    if (cents(sep.revenue) !== cents(11625)) fail(`A6 September revenue ${sep.revenue}, expected 11625.00`);
    // Per-stay ADR is invariant across months. That is the signature of a
    // correct proration: (P*n/N)/n == P/N.
    const adrAug = aug.revenue / aug.nights, adrSep = sep.revenue / sep.nights;
    if (cents(adrAug) !== cents(968.75) || cents(adrSep) !== cents(968.75)) {
      fail(`A6 per-stay ADR must be 968.75 in both months, got ${adrAug} / ${adrSep}`);
    }
  }
}

/* A7 clipping: a clipped stay keeps its per-night share, no residue dump -- */
{
  const full = allocateStayByNights({ checkIn: '2026-08-28', checkOut: '2026-09-13', value: 15500, ...WIDE });
  const clipped = allocateStayByNights({
    checkIn: '2026-08-28', checkOut: '2026-09-13', value: 15500,
    propStart: '2020-01-01', rangeStart: '2026-08-01', periodEndExclusive: '2026-09-01',
  });
  if (clipped.length !== 1) fail(`A7 expected 1 in-range bucket, got ${clipped.length}`);
  else if (cents(clipped[0].revenue) !== cents(full.find((x) => x.month === '2026-08').revenue)) {
    fail(`A7 a clipped stay must keep its per-night share, got ${clipped[0].revenue}`);
  }
}

/* A8 additivity: splitting a range must not change the total ------------- */
{
  const whole = allocateStayByNights({
    checkIn: '2026-06-22', checkOut: '2026-08-06', value: 30271,
    propStart: '2020-01-01', rangeStart: '2026-06-01', periodEndExclusive: '2026-09-01',
  });
  const a = allocateStayByNights({
    checkIn: '2026-06-22', checkOut: '2026-08-06', value: 30271,
    propStart: '2020-01-01', rangeStart: '2026-06-01', periodEndExclusive: '2026-07-01',
  });
  const bb = allocateStayByNights({
    checkIn: '2026-06-22', checkOut: '2026-08-06', value: 30271,
    propStart: '2020-01-01', rangeStart: '2026-07-01', periodEndExclusive: '2026-09-01',
  });
  const drift = Math.abs(sumRev(a) + sumRev(bb) - sumRev(whole));
  // Tolerance is one cent, and only because the residue lands in the last
  // in-range bucket. Do not widen it.
  if (drift > 0.01) fail(`A8 split ranges drift by ${drift.toFixed(4)}, tolerance is 0.01`);
  if (sumNights(a) + sumNights(bb) !== sumNights(whole)) fail('A8 nights must be exactly additive');
}

/* A9 the operator's own installment splits reproduce under flat proration - */
{
  const three = allocateStayByNights({ checkIn: '2026-06-22', checkOut: '2026-08-06', value: 30271, ...WIDE });
  const got = three.map((b) => b.nights).join('/');
  if (got !== '9/31/5') fail(`A9 3 South nights split ${got}, operator slices are 9/31/5`);
  const two = allocateStayByNights({ checkIn: '2026-06-27', checkOut: '2026-08-01', value: 62465, ...WIDE });
  const got2 = two.map((b) => b.nights).join('/');
  if (got2 !== '4/31') fail(`A9 17 Beach nights split ${got2}, operator slices are 4/31`);
  const jun = two.find((b) => b.month === '2026-06');
  if (Math.abs(jun.revenue - 7139) > 1) fail(`A9 17 Beach June revenue ${jun.revenue}, operator slice is 7139`);
}

console.log(failures === 0
  ? 'PASS - allocator conserves value and nights, is a no-op inside one month, clips at range and activation boundaries, and reproduces both operator-entered installment splits.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
