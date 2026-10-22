/**
 * The Books categorizer's vendor hints name the right key on each LLC.
 *
 * On 2026-10-21 the Goose Chase activity for January to October 2026 was
 * categorized and then corrected by hand, and the corrections traced back
 * to the hints: Rocket Mortgage is the Florida house loan (the NSM /
 * Willow loan renamed), not 3 Locust's; a mortgage payment files whole to
 * the loan and the 1098's interest moves by a year-end journal entry;
 * 11 Rockholm is no longer Goose of Calderwood's, so its bills paid from
 * Calderwood are partner distributions; and a Stripe deposit is a payout,
 * never a Stripe fee. These pin each of those so the next upload files on
 * its own.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHART_OF_ACCOUNTS, LLC_ACCOUNTS, LLC_ENTITY_IDS, coaAccountFor } from '../books.ts';
import { COMPANY_BANK_LAST4, VENDOR_HINTS, hintCategoryFor, vendorHintsForPrompt, type VendorHint } from '../books-vendor-hints.ts';

function hint(matcher: string): VendorHint {
  const h = VENDOR_HINTS.find((v) => v.matcher === matcher);
  assert.ok(h, `no vendor hint for "${matcher}"`);
  return h;
}

/** [matcher, entity, the key it must file to]. */
const EXPECTED: [string, string, string][] = [
  // The Florida house loan, under each of its servicer names.
  ['rocket mortgage', 'goose_astoria', 'due_from_florida_property'],
  ['nsm dba', 'goose_astoria', 'due_from_florida_property'],
  ['willow servicing', 'goose_astoria', 'due_from_florida_property'],
  // A loan payment files whole to the loan's liability.
  ['guild mortgage', 'goose_astoria', 'mortgage_3_locust'],
  ['carrington mortgage', 'goose_calderwood', 'mortgage_65_calderwood'],
  // 11 Rockholm's bills paid from Goose of Calderwood.
  ['guild mortgage', 'goose_calderwood', 'owner_draw'],
  ['national grid', 'goose_calderwood', 'owner_draw'],
  ['ngrid', 'goose_calderwood', 'owner_draw'],
  ['comcast', 'goose_calderwood', 'owner_draw'],
  ['xfinity', 'goose_calderwood', 'owner_draw'],
  ['eastern propane', 'goose_calderwood', 'owner_draw'],
  ['city of gloucester', 'goose_calderwood', 'owner_draw'],
  // Astoria's own National Grid and Comcast are 3 Locust utilities.
  ['national grid', 'goose_astoria', 'utilities_electricity'],
  ['ngrid', 'goose_astoria', 'utilities_electricity'],
  ['comcast', 'goose_astoria', 'utilities_internet_tv'],
  ['xfinity', 'goose_astoria', 'utilities_internet_tv'],
  // A Stripe deposit is a payout.
  ['stripe', 'goose_astoria', 'rental_income'],
  ['stripe', 'goose_calderwood', 'str_income'],
  ['stripe', 'rising_tide', 'accommodation_fares'],
  // Rising Tide 2026 review (10/21): the fee sweep into x5130 is the
  // statement's management fee, and the occupancy tax x9928 pays the
  // state is guest money passing through a liability.
  ['online transfer from chk', 'rising_tide', 'property_management_income'],
  ['online transfer from chk', 'goose_astoria', 'intercompany_due'],
  ['massachusetts dor', 'rising_tide', 'sales_tax_payable'],
  ['massachusetts dor', 'goose_astoria', 'sales_tax_payable'],
  ['ma dor pay', 'rising_tide', 'sales_tax_payable'],
  ['comm of mass eft', 'rising_tide', 'sales_tax_payable'],
];

describe('books vendor hints', () => {
  for (const [matcher, entity, key] of EXPECTED) {
    test(`"${matcher}" on ${entity} files to ${key}`, () => {
      const h = hint(matcher);
      assert.equal(hintCategoryFor(h, entity), key);
      assert.ok(coaAccountFor(entity, key), `${key} is not on ${entity}'s chart`);
      assert.ok(h.rule.includes(key), `the "${matcher}" rule never names ${key}`);
      assert.ok(
        vendorHintsForPrompt(entity).includes(`"${matcher}" → ${key} |`),
        `${entity}'s prompt does not show "${matcher}" → ${key}`,
      );
    });
  }

  test('every key a hint names is on the chart it applies to', () => {
    const keys = new Set(CHART_OF_ACCOUNTS.map((a) => a.key));
    for (const h of VENDOR_HINTS) {
      assert.ok(keys.has(h.default_category), `"${h.matcher}" defaults to ${h.default_category}, not a chart key`);
      for (const [entity, key] of Object.entries(h.entity_category ?? {})) {
        assert.ok(LLC_ENTITY_IDS.includes(entity), `"${h.matcher}" names an unknown entity ${entity}`);
        assert.ok(coaAccountFor(entity, key), `"${h.matcher}" files to ${key}, not on ${entity}'s chart`);
      }
    }
  });

  test('no loan payment is expensed: the interest moves by journal entry', () => {
    for (const h of VENDOR_HINTS.filter((v) => /mortgage|servicing|nsm dba/.test(v.matcher))) {
      for (const entity of LLC_ENTITY_IDS) {
        const key = hintCategoryFor(h, entity);
        const account = CHART_OF_ACCOUNTS.find((a) => a.key === key);
        assert.ok(account, `"${h.matcher}" files to ${key}, not a chart key`);
        assert.ok(
          !['expense', 'other_expense', 'cogs'].includes(account.type),
          `"${h.matcher}" on ${entity} files a loan payment to ${key}, an expense`,
        );
      }
    }
  });

  test('Rocket Mortgage is the Florida house loan, not 3 Locust\'s', () => {
    const rule = hint('rocket mortgage').rule;
    assert.match(rule, /FLORIDA/);
    assert.match(rule, /0000452701/);
    assert.match(hint('nsm dba').rule, /ROCKET MORTGAGE/);
  });

  test('a Stripe hint never files to Stripe Fees, and the prompt says why', () => {
    const stripe = VENDOR_HINTS.filter((v) => v.matcher.includes('stripe'));
    for (const h of stripe) {
      for (const entity of LLC_ENTITY_IDS) {
        assert.notEqual(hintCategoryFor(h, entity), 'host_channel_stripe', `"${h.matcher}" on ${entity}`);
      }
    }
    const src = readFileSync(new URL('../books-categorizer.ts', import.meta.url), 'utf8');
    assert.match(src, /vendorHintsForPrompt\(entityId\)/, 'the prompt must show each entity its own hint keys');
    assert.match(src, /Money IN from a payment processor or booking channel \(Stripe/);
    assert.match(src, /never a fee account/);
  });

  test('a transfer into x5130 or x9928 says which leg it is', () => {
    const rule = hint('online transfer from chk').rule;
    for (const key of ['property_management_income', 'pt_host_channel_fees', 'sales_tax_payable', 'intercompany_due']) {
      assert.ok(rule.includes(key), `the transfer rule never names ${key}`);
    }
    assert.match(rule, /x5130/);
    assert.match(rule, /x9928/);
    // x5130 also takes real owner reimbursements, so the rule may never
    // file every transfer into it as a fee.
    assert.match(rule, /reimbursing/);
  });

  test('the company accounts the transfer rule names are LLC_ACCOUNTS\' own', () => {
    const own = LLC_ACCOUNTS.filter((a) => a.kind === 'bank' && !a.property_id).map((a) => a.last4).sort();
    assert.deepEqual([...COMPANY_BANK_LAST4].sort(), own);
    const rule = hint('online transfer from chk').rule;
    for (const last4 of COMPANY_BANK_LAST4) assert.ok(rule.includes(`x${last4}`), `rule never names x${last4}`);
  });

  test('no MA tax remittance hint expenses the occupancy tax on x9928', () => {
    for (const matcher of ['massachusetts dor', 'ma dor pay', 'comm of mass eft']) {
      const h = hint(matcher);
      assert.equal(h.default_category, 'sales_tax_payable', `"${matcher}" defaults to ${h.default_category}`);
      assert.match(h.rule, /x9928/, `"${matcher}" never names the tax account`);
    }
  });

  test('an Airbnb deposit into x5130 is the Florida house, not Rising Tide income', () => {
    const rule = hint('airbnb').rule;
    assert.match(rule, /x5130/);
    assert.match(rule, /intercompany_due/);
  });
});
