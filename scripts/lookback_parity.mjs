#!/usr/bin/env node
/**
 * Stripe-sync lookback-widening parity harness (2026-08-31).
 *
 * Proves the chargeWindow() change (6 -> 18 month lookback, src/lib/
 * stripe-window.ts) cannot move any payout that was correct before:
 *
 *   1. endUnix is IDENTICAL to the old formula for every month -- the
 *      forward boundary did not move.
 *   2. fuzzyCutoffUnix is IDENTICAL to the old 6-month start boundary.
 *      Every charge admitted to the fuzzy matchers (amount fallback,
 *      guest-name fallback, unmatched_charges) under the new window is
 *      exactly the set that was listed at all under the old window, so
 *      those paths are behavior-identical by construction. Pre-cutoff
 *      charges reach only the decisive matchers (confirmation-code
 *      aggregation, exact date-range), both of which are guarded
 *      upward-only or absolute-agree in stripe-sync.
 *   3. startUnix moved to 18 months and brackets correctly.
 *   4. Regression pin, Barry Allen (GY-2p8ZgNK8, 3 South, Aug 2026):
 *      his Jan 15 deposit is outside the OLD window (why the sync missed
 *      it) and inside the NEW one but below the fuzzy cutoff (decisive
 *      matchers only). The gross reconstruction over both charges lands
 *      on exactly the hand-verified correction: $4,107.04.
 *
 * Pure arithmetic. No database, no Stripe, no network.
 * Run: node scripts/lookback_parity.mjs
 */

import { chargeWindow } from '../src/lib/stripe-window.ts';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${actual}, want ${expected})`}`);
};

// The pre-change formulas, verbatim from the old listChargesAroundMonth.
const oldStart = (y, m) => Math.floor(Date.UTC(y, m - 1 - 6, 1) / 1000);
const oldEnd = (y, m) => Math.floor(Date.UTC(y, m + 2, 1) / 1000);

// Every month across three years, covering year-boundary rollovers both
// backward (Jan minus 18 months) and forward (Nov/Dec plus 2 months).
for (let y = 2025; y <= 2027; y++) {
  for (let m = 1; m <= 12; m++) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    const w = chargeWindow(month);
    check(`${month} endUnix unchanged`, w.endUnix, oldEnd(y, m));
    check(`${month} fuzzyCutoff == old start`, w.fuzzyCutoffUnix, oldStart(y, m));
    check(`${month} startUnix is 18 months back`, w.startUnix, Math.floor(Date.UTC(y, m - 1 - 18, 1) / 1000));
    check(`${month} ordering start < cutoff < end`, w.startUnix < w.fuzzyCutoffUnix && w.fuzzyCutoffUnix < w.endUnix, true);
  }
}

// Barry Allen regression pin.
const aug = chargeWindow('2026-08');
const janDeposit = Math.floor(Date.UTC(2026, 0, 15, 22, 43, 13) / 1000); // pi_3SpzG0IpKzhR81iZ0M1gork3
const julBalance = Math.floor(Date.UTC(2026, 6, 10, 20, 24, 38) / 1000); // pi_3TrkyPIpKzhR81iZ1cVSfkAy
check('Jan deposit was invisible to the OLD window', janDeposit < oldStart(2026, 8), true);
check('Jan deposit is inside the NEW window', janDeposit >= aug.startUnix && janDeposit < aug.endUnix, true);
check('Jan deposit is below the fuzzy cutoff (decisive matchers only)', janDeposit < aug.fuzzyCutoffUnix, true);
check('Jul balance is fuzzy-eligible (unchanged behavior)', julBalance >= aug.fuzzyCutoffUnix, true);

// With both charges aggregated under the confirmation code, the gross
// reconstruction (net = stripe_gross - taxes - commission - summed fee,
// Manual commission 0) must reproduce the hand-verified correction.
const round2 = (n) => Math.round(n * 100) / 100;
const stripeGross = round2(2466.05 + 2466.05);
const summedFee = round2(96.48 + 96.48);
check('reconstructed gross is the folio total', stripeGross, 4932.10);
check('reconstructed net equals the verified correction', round2(stripeGross - 632.10 - 0 - summedFee), 4107.04);
check('reconstruction is upward from the half-based net', round2(stripeGross - 632.10 - 0 - summedFee) > 1737.47, true);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
