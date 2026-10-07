/**
 * Vrbo's flat 12% commission must survive the legacy-kludge stripper.
 *
 * Every Vrbo recompute site strips the pre-overhaul 4.4% kludge by ratio:
 * real Vrbo commission was 5%, so anything above 7% of the pre-tax total was
 * rewritten to 5%. From 2026-10-29 Vrbo charges a flat 12%, which that rule
 * would cut to 5%, overstating owner revenue by about 7% of the booking and
 * overpaying the owner. The line is drawn on guesty_reservations.booked_at
 * (lib/vrbo-commission.ts).
 *
 * Two kinds of check:
 *   1. Behaviour of the shared predicate and of the revenue-math UI mirror,
 *      including PARITY: for every booking without a post-cutoff booked_at,
 *      the result is identical to the rule as it stood before this change.
 *   2. Source guards on the three statement routes (/api/ingest,
 *      /api/refresh-statement, /api/fill-gap), whose strip helpers are
 *      private copies. Each must consult the predicate, select booked_at,
 *      and pass it at every call. A copy that loses one line silently goes
 *      back to cutting 12% to 5% on that route alone.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isVrboFlatCommissionBooking, VRBO_FLAT_COMMISSION_FROM } from '../vrbo-commission.ts';
import { effectiveCommission, wasCommissionStripped } from '../revenue-math.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** The Vrbo/Manual rule exactly as it stood before the flat-commission line. */
function legacyRule(platform: string, totalPaid: number, taxes: number, commission: number, folioPreTax?: number | null): number {
  if (!commission || commission <= 0) return 0;
  const base = folioPreTax && folioPreTax > 0 ? folioPreTax : Math.max(totalPaid - taxes, 0);
  if (base <= 0) return commission;
  const ratio = commission / base;
  const p = platform.toUpperCase();
  if (p === 'MANUAL' || p === 'DIRECT') return ratio > 0.02 ? 0 : commission;
  if (p.includes('HOMEAWAY') || p === 'VRBO') return ratio > 0.07 ? Math.round(base * 0.05 * 100) / 100 : commission;
  return commission;
}

const BEFORE = '2026-10-28T23:59:59-04:00';
const AT = '2026-10-29T00:00:00-04:00';
const AFTER = '2026-11-14T15:30:00Z';

describe('the flat-commission cutoff', () => {
  test('is midnight Eastern on 2026-10-29', () => {
    assert.equal(new Date(VRBO_FLAT_COMMISSION_FROM).toISOString(), '2026-10-29T04:00:00.000Z');
  });

  test('applies from the cutoff on, and never to an unknown booking date', () => {
    assert.equal(isVrboFlatCommissionBooking(AT), true);
    assert.equal(isVrboFlatCommissionBooking(AFTER), true);
    assert.equal(isVrboFlatCommissionBooking(BEFORE), false);
    for (const unknown of [null, undefined, '', 'not a date']) {
      assert.equal(isVrboFlatCommissionBooking(unknown), false, String(unknown));
    }
  });
});

describe('revenue-math mirror', () => {
  // $3,000 pre-tax Vrbo stay, 11.7% tax, real 12% commission = $360.
  const base = 3000, taxes = 351, totalPaid = base + taxes, commission = 360;

  test('keeps a real 12% on a booking made after the cutoff', () => {
    assert.equal(effectiveCommission('HomeAway', totalPaid, taxes, commission, base, AFTER), 360);
    assert.equal(wasCommissionStripped('HomeAway', totalPaid, taxes, commission, base, AFTER), false);
  });

  test('still cuts it to 5% when the booking date is unknown or earlier (old regime)', () => {
    assert.equal(effectiveCommission('HomeAway', totalPaid, taxes, commission, base, null), 150);
    assert.equal(effectiveCommission('HomeAway', totalPaid, taxes, commission, base, BEFORE), 150);
  });

  test('a legacy kludged booking (5% + 4.4%) is still restored to 5%', () => {
    assert.equal(effectiveCommission('VRBO', totalPaid, taxes, 282, base, BEFORE), 150);
  });

  test('the booking date never touches Manual, Airbnb or Booking.com', () => {
    assert.equal(effectiveCommission('MANUAL', totalPaid, taxes, 132, base, AFTER), 0);
    assert.equal(effectiveCommission('Airbnb', totalPaid, taxes, 465, base, AFTER), 465);
    assert.equal(effectiveCommission('Booking.com', totalPaid, taxes, 450, base, AFTER), 450);
  });

  test('PARITY: no post-cutoff booked_at means the old answer, on a broad grid', () => {
    const platforms = ['HomeAway', 'VRBO', 'homeaway2', 'MANUAL', 'DIRECT', 'Airbnb', 'Booking.com'];
    const bases = [0, 1, 250, 999.99, 3000, 12345.67];
    const ratios = [0, 0.01, 0.02, 0.021, 0.05, 0.069, 0.07, 0.071, 0.094, 0.12, 0.2];
    let checked = 0;
    for (const p of platforms) {
      for (const b of bases) {
        for (const r of ratios) {
          const c = Math.round(b * r * 100) / 100;
          const tx = Math.round(b * 0.117 * 100) / 100;
          for (const folio of [null, b]) {
            for (const bookedAt of [null, undefined, BEFORE, '2026-09-02T12:00:00Z']) {
              assert.equal(
                effectiveCommission(p, b + tx, tx, c, folio, bookedAt),
                legacyRule(p, b + tx, tx, c, folio),
                `${p} base=${b} ratio=${r} folio=${folio} bookedAt=${bookedAt}`,
              );
              checked++;
            }
          }
        }
      }
    }
    assert.ok(checked > 3000);
  });
});

describe('statement routes consult the booking date', () => {
  const routes: Array<{ file: string; calls: number }> = [
    { file: 'src/app/api/ingest/route.ts', calls: 2 },
    { file: 'src/app/api/refresh-statement/route.ts', calls: 1 },
    { file: 'src/app/api/fill-gap/route.ts', calls: 1 },
  ];
  for (const { file, calls } of routes) {
    test(file, () => {
      const src = read(file);
      assert.ok(src.includes("import { isVrboFlatCommissionBooking } from '@/lib/vrbo-commission';"), 'imports the predicate');
      assert.ok(src.includes('isVrboFlatCommissionBooking(bookedAt)'), 'the strip helper checks the booking date');
      assert.ok(src.includes('bookedAt?: string | null'), 'the strip helper accepts a booking date');
      const strips = src.match(/stripLegacyCommissionKludge\(\{[\s\S]*?\}\)/g) ?? [];
      assert.equal(strips.length, calls, 'call-site count changed; re-check each passes bookedAt');
      for (const call of strips) assert.ok(/bookedAt:/.test(call), `a call does not pass bookedAt:\n${call}`);
      assert.ok(/booked_at/.test(src), 'booked_at is read from guesty_reservations');
    });
  }
});
