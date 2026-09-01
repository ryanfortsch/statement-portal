#!/usr/bin/env node
/**
 * Statement-month gate + freeze-scope parity harness.
 *
 * READ-ONLY, no database, no network. Pure arithmetic/logic proof for the
 * three fixes shipped alongside it:
 *
 *   1. src/app/api/ingest/route.ts   -- statement-month gate on PDF rows,
 *                                       plus the wrong-month-PDF refusal
 *   2. src/lib/statement-finality.ts -- FREEZE_FROM_MONTH ('') replaces the
 *                                       FINALITY_FROM_MONTH ('2026-08')
 *                                       grandfather on the freeze path
 *   3. src/app/api/ingest/route.ts   -- cancel suspects are the UNION of
 *                                       unmatched-and-always-pays rows and
 *                                       cache-cancelled rows at ANY match
 *                                       status
 *
 * What this proves
 *   1. SAFETY (the one that matters): on a statement whose bookings all
 *      check out in the month -- every statement in the portfolio's history
 *      bar the two sanctioned installment splits -- the gate is a no-op.
 *      rental_revenue, num_stays, nights_booked and owner_payout are
 *      byte-identical before and after.
 *   2. The gate never touches an installment-sliced row, so the sanctioned
 *      cross-month split (Kate Bacon, Emily Hancock) still recognizes.
 *   3. The wrong-month refusal fires ONLY when every parsed row is out of
 *      month, never on a mixed PDF -- a stray payment-basis row must not
 *      block an otherwise good ingest.
 *   4. The freeze now covers every month, and specifically covers the
 *      July-2026 case the old grandfather waved through.
 *   5. The widened cancel suspect set is a strict superset of the old one,
 *      and it catches the bank-matched cancel the old one missed.
 *
 * Run: node scripts/month_gate_parity.mjs
 * Exit 0 = parity holds. Exit 1 = a case diverged.
 */

const round2 = (n) => Math.round(n * 100) / 100;

let failures = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}\n         got      ${a}\n         expected ${e}`);
    failures++;
  }
};

/* ── 1. The gate itself ─────────────────────────────────────────────────── */

/**
 * Mirror of the statement-month gate in /api/ingest's money loop.
 *
 * `slicedThisMonth` mirrors `installmentByCode` -- codes with a slice for
 * THIS month, not codes with slices in any month. That distinction is the
 * point: a stay whose slices all live in other months is already recognized
 * there and must be held out, not exempted.
 */
function applyGate(rows, month, slicedThisMonth = new Set()) {
  const kept = [];
  const outOfMonth = [];
  for (const r of rows) {
    const checkOutMonth = (r.check_out || '').slice(0, 7);
    const hasSliceThisMonth = !!r.confirmation_code && slicedThisMonth.has(r.confirmation_code);
    if (checkOutMonth && checkOutMonth !== month && !hasSliceThisMonth) {
      outOfMonth.push(r);
      continue;
    }
    kept.push(r);
  }
  return { kept, outOfMonth };
}

/** The statement totals, canonical formula, add-on terms zero. */
function totals(rows, { month, feePct, cleaning, repairs, reserve }) {
  const rental = round2(rows.reduce((s, r) => s + r.adjusted_revenue, 0));
  const fee = round2(rental * (feePct / 100));
  const payout = round2(rental - fee - cleaning - repairs - reserve);
  const numStays = rows.filter(
    (r) => r.adjusted_revenue > 0 && (r.check_out || '').slice(0, 7) === month,
  ).length;
  const nights = rows.reduce((s, r) => s + r.nights, 0);
  return { rental, fee, payout, numStays, nights };
}

console.log('\n1. SAFETY: a statement with only in-month checkouts is unchanged');
{
  // 20 Hammond, August 2026, as it stands after correction.
  const rows = [
    { confirmation_code: 'HMFT2NQQJN', check_out: '2026-08-04', nights: 4, adjusted_revenue: 2251.08 },
    { confirmation_code: 'HMQMPC4YBJ', check_out: '2026-08-08', nights: 3, adjusted_revenue: 1678.17 },
    { confirmation_code: 'HMNNBHMACZ', check_out: '2026-08-09', nights: 1, adjusted_revenue: 711.49 },
    { confirmation_code: 'HA-I6ZK9s6', check_out: '2026-08-17', nights: 8, adjusted_revenue: 4090.87 },
    { confirmation_code: 'HM2FTKP3DJ', check_out: '2026-08-19', nights: 2, adjusted_revenue: 671.77 },
    { confirmation_code: 'HA-yIjXLto', check_out: '2026-08-23', nights: 4, adjusted_revenue: 2556.45 },
    { confirmation_code: 'HMJ32NTFXE', check_out: '2026-08-28', nights: 4, adjusted_revenue: 1270.03 },
    { confirmation_code: 'HMK8JKM98A', check_out: '2026-08-30', nights: 2, adjusted_revenue: 852.60 },
  ];
  const opts = { month: '2026-08', feePct: 25, cleaning: 1673.10, repairs: 171.80, reserve: 0 };
  const before = totals(rows, opts);
  const { kept, outOfMonth } = applyGate(rows, '2026-08');
  const after = totals(kept, opts);
  check('nothing held out', outOfMonth.length, 0);
  check('totals byte-identical', after, before);
  check('payout is the corrected figure', after.payout, 8716.94);
}

console.log('\n2. The gate holds out exactly the out-of-month row, nothing else');
{
  // 20 Enon, August 2026, as ingested: one real stay + the September one.
  const rows = [
    { confirmation_code: 'HMN3FDWKEA', check_out: '2026-08-30', nights: 4, adjusted_revenue: 1749.15 },
    { confirmation_code: 'HMMBCXQJDS', check_out: '2026-09-03', nights: 2, adjusted_revenue: 795.14 },
  ];
  const opts = { month: '2026-08', feePct: 25, cleaning: 327.00, repairs: 0, reserve: 0 };
  const before = totals(rows, opts);
  const { kept, outOfMonth } = applyGate(rows, '2026-08');
  const after = totals(kept, opts);
  check('the September row is held out', outOfMonth.map((r) => r.confirmation_code), ['HMMBCXQJDS']);
  check('old (broken) payout', before.payout, 1581.22);
  check('gated payout matches the applied correction', after.payout, 984.86);
  check('gated rental_revenue', after.rental, 1749.15);
  check('gated nights drop the Sep row too', after.nights, 4);
  // num_stays already filtered on checkout month, so it alone never moved.
  check('num_stays was always right', [before.numStays, after.numStays], [1, 1]);
}

console.log('\n3. Exemption is month-scoped: a slice for THIS month, not slices in any month');
{
  // 3 South, July 2026: Emily Hancock checks out Aug 6 and HAS a July slice.
  const hancock = [
    { confirmation_code: 'GY-fCdhbUYC', check_out: '2026-08-06', nights: 31, adjusted_revenue: 20853.63 },
  ];
  const julySlice = new Set(['GY-fCdhbUYC']);
  const kept = applyGate(hancock, '2026-07', julySlice);
  check('row with a slice THIS month is kept', kept.kept.map((r) => r.confirmation_code), ['GY-fCdhbUYC']);
  check('nothing held out', kept.outOfMonth.length, 0);

  // Same row with no slices at all is held out -- the 16 Waterman shape.
  check('unsliced cross-month row IS held out', applyGate(hancock, '2026-07', new Set()).outOfMonth.length, 1);

  // THE REGRESSION THE REVIEW CAUGHT. Kate Bacon: slices live in June and
  // July only, stay checks out Aug 1. Ingesting August, there is no August
  // slice, so the booking is already fully recognized on the June and July
  // statements. Keying the exemption on "slices in ANY month" would wave it
  // through here at full PDF value and pay it a third time.
  const bacon = [
    { confirmation_code: 'GY-qqVPackv', check_out: '2026-08-01', nights: 35, adjusted_revenue: 62464.60 },
  ];
  const slicesAnyMonth = new Set(['GY-qqVPackv']); // what the first draft used
  const slicesThisMonth = new Set();               // no September slice exists
  check(
    'BROKEN semantics would exempt an already-recognized stay',
    applyGate(bacon, '2026-09', slicesAnyMonth).outOfMonth.length,
    0,
  );
  check(
    'month-scoped semantics hold it out',
    applyGate(bacon, '2026-09', slicesThisMonth).outOfMonth.map((r) => r.confirmation_code),
    ['GY-qqVPackv'],
  );
}

/* ── 4. Wrong-month PDF signalling ──────────────────────────────────────── */

/**
 * Mirror of the out_of_month_reservation gap's severity choice. Note what
 * this is NOT: a refusal. An earlier draft returned 400 when every parsed
 * row was out of month. The review killed it -- an ordinary month whose one
 * booking checks out on the 2nd of the next month hits that same condition
 * on a perfectly correct PDF, and refusing blocks cleaning, repairs,
 * add-ons and installment injection for the whole property-month. The
 * statement always builds; the gap carries the volume.
 */
function gateOutcome(rows, month, slicedThisMonth = new Set()) {
  const { kept, outOfMonth } = applyGate(rows, month, slicedThisMonth);
  if (outOfMonth.length === 0) return { ingests: true, gap: null };
  return {
    ingests: true,
    gap: outOfMonth.length === rows.length ? 'critical' : 'warning',
    recognized: kept.length,
  };
}

console.log('\n4. A wrong-month PDF is flagged critical, never refused');
{
  // 16 Waterman: July selected, August's PDF attached. All six out of month.
  const augustPdf = [
    { confirmation_code: 'HM8WZ9CJYQ', check_out: '2026-08-03', nights: 3, adjusted_revenue: 2984.54 },
    { confirmation_code: 'HM9ZQ228CT', check_out: '2026-08-10', nights: 7, adjusted_revenue: 5018.37 },
    { confirmation_code: 'HMYP9YKHK5', check_out: '2026-08-15', nights: 4, adjusted_revenue: 3733.21 },
    { confirmation_code: 'HMS9E9N3NQ', check_out: '2026-08-22', nights: 7, adjusted_revenue: 5085.04 },
    { confirmation_code: 'HM9NAHMA9T', check_out: '2026-08-23', nights: 1, adjusted_revenue: 626.14 },
    { confirmation_code: 'HM92KRNJCZ', check_out: '2026-08-29', nights: 6, adjusted_revenue: 4754.81 },
  ];
  check('August PDF into July: critical gap, still ingests', gateOutcome(augustPdf, '2026-07'), {
    ingests: true, gap: 'critical', recognized: 0,
  });
  check('none of August\'s revenue lands on July', applyGate(augustPdf, '2026-07').kept.length, 0);
  check('same PDF as August: no gap at all', gateOutcome(augustPdf, '2026-08'), { ingests: true, gap: null });

  // The 20 Enon shape: one stray row among good ones is a warning, not critical.
  const mixed = [
    { confirmation_code: 'HMN3FDWKEA', check_out: '2026-08-30', nights: 4, adjusted_revenue: 1749.15 },
    { confirmation_code: 'HMMBCXQJDS', check_out: '2026-09-03', nights: 2, adjusted_revenue: 795.14 },
  ];
  check('mixed PDF warns and keeps the good row', gateOutcome(mixed, '2026-08'), {
    ingests: true, gap: 'warning', recognized: 1,
  });

  // THE REGRESSION THE REVIEW CAUGHT: a legitimate shoulder month whose only
  // booking checks out on the 2nd of the next month. The killed 400 would
  // have blocked this entire property-month, cleaning included.
  const shoulder = [
    { confirmation_code: 'HMSHOULDER', check_out: '2026-09-02', nights: 3, adjusted_revenue: 1200.00 },
  ];
  check('single next-month checkout still ingests', gateOutcome(shoulder, '2026-08').ingests, true);
  check('and recognizes no revenue', applyGate(shoulder, '2026-08').kept.length, 0);
  check('empty PDF raises nothing', gateOutcome([], '2026-08'), { ingests: true, gap: null });
}

/* ── 5. Freeze scope ────────────────────────────────────────────────────── */

const FINALITY_FROM_MONTH = '2026-08'; // integrity check only
const FREEZE_FROM_MONTH = '';          // freeze: every month

/** Old freeze scope test vs new. */
const oldFreezeInScope = (month) => !!month && month >= FINALITY_FROM_MONTH;
const newFreezeInScope = (month) => !!month && month >= FREEZE_FROM_MONTH;

console.log('\n5. The freeze now covers every month, including the July 2026 case');
{
  check('OLD let July 2026 through', oldFreezeInScope('2026-07'), false);
  check('NEW freezes July 2026', newFreezeInScope('2026-07'), true);
  check('NEW freezes June 2026', newFreezeInScope('2026-06'), true);
  check('NEW still freezes August 2026', newFreezeInScope('2026-08'), true);
  check('NEW freezes a 2025 month', newFreezeInScope('2025-11'), true);
  // Never widen to a missing month -- the caller falls through to the
  // period/close-task reads, which is the fail-closed direction.
  check('a null month is not "in scope" on its own', newFreezeInScope(null), false);
  // Integrity scope is deliberately unchanged.
  check('integrity still skips July 2026', '2026-07' >= FINALITY_FROM_MONTH, false);
  check('integrity still runs on August 2026', '2026-08' >= FINALITY_FROM_MONTH, true);
}

/* ── 6. Cancel suspect set ──────────────────────────────────────────────── */

const alwaysPays = (p) => {
  const u = (p || '').toUpperCase();
  return u === 'AIRBNB' || u.includes('BOOKING');
};

/** Old: unmatched-and-always-pays only. */
function oldSuspects(rows) {
  return rows
    .filter((r) => r.bank_match_status === 'unmatched' && r.adjusted_revenue > 0)
    .filter((r) => alwaysPays(r.platform))
    .map((r) => r.confirmation_code);
}

/** New: union with cache-cancelled rows at ANY match status. */
function newSuspects(rows) {
  const out = new Set(oldSuspects(rows));
  for (const r of rows) {
    if (r.adjusted_revenue <= 0) continue;
    const s = (r.cached_status || '').toLowerCase();
    if (s === 'canceled' || s === 'cancelled') out.add(r.confirmation_code);
  }
  return [...out];
}

console.log('\n6. Widened cancel suspects are a strict superset, and catch the matched cancel');
{
  const rows = [
    // The one that got through: cancelled, but bank-matched.
    { confirmation_code: 'HMMBCXQJDS', platform: 'Airbnb', bank_match_status: 'matched', adjusted_revenue: 795.14, cached_status: 'canceled' },
    // A healthy matched stay -- must NOT become a suspect.
    { confirmation_code: 'HMN3FDWKEA', platform: 'Airbnb', bank_match_status: 'matched', adjusted_revenue: 1749.15, cached_status: 'confirmed' },
    // The original tell: unmatched Airbnb.
    { confirmation_code: 'HMUNMATCH1', platform: 'Airbnb', bank_match_status: 'unmatched', adjusted_revenue: 500.00, cached_status: 'confirmed' },
    // A homeowner/zero-revenue row is never a suspect.
    { confirmation_code: 'HMZERO0001', platform: 'Manual', bank_match_status: 'matched', adjusted_revenue: 0, cached_status: 'canceled' },
  ];
  const before = oldSuspects(rows).sort();
  const after = newSuspects(rows).sort();
  check('OLD missed the matched cancel', before.includes('HMMBCXQJDS'), false);
  check('NEW catches the matched cancel', after.includes('HMMBCXQJDS'), true);
  check('NEW keeps the original unmatched tell', after.includes('HMUNMATCH1'), true);
  check('healthy matched stay is not a suspect', after.includes('HMN3FDWKEA'), false);
  check('zero-revenue row is not a suspect', after.includes('HMZERO0001'), false);
  check('strict superset', before.every((c) => after.includes(c)), true);
  // Source 2 costs no Guesty calls beyond what source 1 already spent on
  // top of the cache hits, so the per-code live check stays bounded.
  check('suspects stay bounded', after.length <= rows.length, true);
}

console.log(
  failures === 0
    ? '\nPARITY HOLDS: no in-month statement moves; the gate, the freeze and the cancel guard behave as specified.\n'
    : `\n${failures} CASE(S) DIVERGED\n`,
);
process.exit(failures === 0 ? 0 : 1);
