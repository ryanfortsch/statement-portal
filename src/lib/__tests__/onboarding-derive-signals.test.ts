/**
 * An onboarding item must derive from the fact it claims, not a nearby one.
 *
 * `financial.sca_payment_wiring` asks whether the property's own Stripe keys
 * are wired into staycapeann. It derived from `ctx.scaLive`, which only says
 * the page is up. A demo-mode listing is up and collects nothing, so the
 * item ticked itself green on exactly the properties where it was false.
 * That is the 84 Thatcher failure written into the checklist: four bookings,
 * $41,917, and onboarding reporting the payment wiring as done.
 *
 * The rule this guards is narrow and worth stating: when two items derive
 * from the identical expression, at least one of them is answering a
 * question it was not asked. One fact must not resolve two different claims.
 *
 * Source-reading, like shoot-offer-optin.test.ts, because the derives are
 * one-line closures with nothing else holding them in place.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const CATALOG = 'src/lib/onboarding-catalog.ts';

/** key -> derive expression, for every catalog item that has one. */
function derives(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/key: '([^']+)',/g)) {
    const seg = src.slice(m.index, m.index + 1400);
    const end = seg.indexOf('\n  {');
    const body = end > 0 ? seg.slice(0, end) : seg;
    const d = body.match(/derive: (.+?),?\n/);
    if (d) out.set(m[1], d[1].trim().replace(/,$/, ''));
  }
  return out;
}

describe('onboarding derives answer their own question', () => {
  test('SCA payment wiring reads the payment probe, never "the page is live"', () => {
    const d = derives(read(CATALOG));
    const wiring = d.get('financial.sca_payment_wiring');
    assert.ok(wiring, 'financial.sca_payment_wiring lost its derive');
    assert.ok(
      wiring.includes('scaPaymentSignal'),
      `sca_payment_wiring derives from ${wiring}. A live listing in demo mode collects nothing, ` +
        'so anything but the payment probe ticks this green on the properties where it is false.',
    );
    assert.ok(
      !/\bctx\.scaLive\b/.test(wiring),
      'sca_payment_wiring is back on scaLive, which cannot distinguish demo mode from wired',
    );
  });

  test('a test booking is not derived from the page being live', () => {
    const d = derives(read(CATALOG));
    assert.equal(
      d.get('financial.sca_test_booking'),
      undefined,
      'financial.sca_test_booking has a derive again. Nothing in the database records that a ' +
        'human ran a test booking, so any derive here is a guess presented as a fact.',
    );
  });

  test('no two items claim to be resolved by the identical expression', () => {
    const d = derives(read(CATALOG));
    const byExpr = new Map<string, string[]>();
    for (const [key, expr] of d) {
      byExpr.set(expr, [...(byExpr.get(expr) ?? []), key]);
    }
    const shared = [...byExpr.entries()].filter(([, keys]) => keys.length > 1);
    assert.deepEqual(
      shared.map(([expr, keys]) => `${keys.join(' + ')} both derive from ${expr}`),
      [],
      'One fact is resolving two different claims, so at least one of them is answering a ' +
        'question it was not asked.',
    );
  });
});
