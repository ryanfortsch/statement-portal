/**
 * Two readiness trackers, one definition per shared fact.
 *
 * A property carries the 26-step launch checklist and the 108-item
 * onboarding catalog, and several facts appear in both. While each list
 * hand-rolled its own predicate they drifted, quietly:
 *
 *   launch 'bank_last4'                  !!p.bank_last4 && p.bank_last4.length === 4
 *   catalog 'financial.chase_account…'   has(p.bank_last4)
 *
 * A three-digit bank_last4 therefore resolved one list and not the other.
 * Nothing failed; the two counters just disagreed about the same column,
 * which is the worst shape for a number somebody trusts.
 *
 * The behaviour is asserted first (that is what matters), then the source is
 * read to confirm neither file has restated an expression instead of
 * importing it, because a re-inlined predicate is how the drift returns.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasBankLast4,
  hasTaxCert,
  hasExternalTitle,
  hasGuestyListing,
  pricingIsFlowing,
  scaIsLive,
  scaPaymentWired,
} from '../property-facts.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('shared readiness facts', () => {
  test('bank_last4 needs exactly four digits, not merely something', () => {
    assert.equal(hasBankLast4({ bank_last4: '1234' }), true);
    // The case that used to split the two trackers.
    assert.equal(hasBankLast4({ bank_last4: '123' }), false, 'a 3-digit value matches no Chase deposit');
    assert.equal(hasBankLast4({ bank_last4: '12345' }), false);
    assert.equal(hasBankLast4({ bank_last4: ' 1234 ' }), true, 'whitespace should not decide this');
    assert.equal(hasBankLast4({ bank_last4: '' }), false);
    assert.equal(hasBankLast4({ bank_last4: null }), false);
  });

  test('being live and being able to take money are different questions', () => {
    assert.equal(scaIsLive('live'), true);
    assert.equal(scaIsLive('pr_open'), false);
    assert.equal(scaPaymentWired('wired'), true);
    // The 84 Thatcher shape: live, and collecting nothing.
    assert.equal(scaPaymentWired('demo_mode'), false);
    assert.equal(scaPaymentWired('unknown'), false);
    assert.equal(scaPaymentWired(null), false);
  });

  test('one distinct forward price is a flat rate, not dynamic pricing', () => {
    assert.equal(pricingIsFlowing(0), false, 'nothing synced yet');
    assert.equal(pricingIsFlowing(1), false, 'listing live on defaults, the 3 Windward failure');
    assert.equal(pricingIsFlowing(2), true);
  });

  test('the plain filled-in facts trim before deciding', () => {
    assert.equal(hasTaxCert({ tax_cert_id: '  ' }), false);
    assert.equal(hasTaxCert({ tax_cert_id: 'C0584601070' }), true);
    assert.equal(hasExternalTitle({ title: '' }), false);
    assert.equal(hasExternalTitle({ title: 'Stay at Rocky Neck' }), true);
    assert.equal(hasGuestyListing({ guesty_listing_id: null }), false);
    assert.equal(hasGuestyListing({ guesty_listing_id: '66797ba7' }), true);
  });

  test('neither tracker restates a shared predicate inline', () => {
    const launch = read('src/lib/launch-checklist.ts');
    const catalog = read('src/lib/onboarding-catalog.ts');

    for (const [file, src] of [['launch-checklist', launch], ['onboarding-catalog', catalog]] as const) {
      assert.ok(
        src.includes("from '@/lib/property-facts'"),
        `${file} no longer imports the shared facts, so its predicates are free to drift again`,
      );
    }

    // The exact expressions that drifted. Re-inlining any of them is how the
    // two counters start disagreeing about one column.
    const banned: Array<[string, RegExp]> = [
      ['bank_last4 length check', /bank_last4(\?\.)?\s*\.length\s*===\s*4/],
      ['forward price threshold', /forwardDistinctPrices\s*>=\s*2/],
      ["sca 'live' comparison", /scaLaunchStatus\s*===\s*'live'/],
      ['payment signal comparison', /scaPaymentSignal\s*===\s*'wired'/],
    ];
    for (const [label, re] of banned) {
      for (const [file, src] of [['launch-checklist', launch], ['onboarding-catalog', catalog]] as const) {
        assert.ok(!re.test(src), `${file} restates the ${label} inline instead of importing it`);
      }
    }

    // Banning the inline expressions is not enough on its own. The original
    // drift was the catalog using the LOOSE `has(p.bank_last4)`, which
    // matches no banned pattern because it is not a restatement, it is a
    // different and weaker test. So assert the strict predicate is actually
    // called where the shared fact is decided.
    for (const [file, src, names] of [
      ['launch-checklist', launch, ['hasBankLast4(', 'scaIsLive(', 'pricingIsFlowing(']],
      ['onboarding-catalog', catalog, ['hasBankLast4(', 'scaPaymentWired(', 'pricingIsFlowing(']],
    ] as const) {
      for (const name of names) {
        assert.ok(
          src.includes(name),
          `${file} no longer calls ${name.slice(0, -1)}; a shared fact is being decided some other way`,
        );
      }
    }
  });
});
