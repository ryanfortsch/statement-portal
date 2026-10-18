/**
 * One store for house policy (UI/UX audit 2026-10-17, Properties, Phase 3).
 *
 * The nine House policy columns on properties are the only home for checkout,
 * pets, quiet hours, max occupancy, cancellation and house rules. The rate
 * plan and the listing record read them through src/lib/house-policy.ts, and
 * the two forms that kept their own copies no longer edit those fields.
 *
 * The overlay is pinned on its arithmetic, and the "no second writer" half by
 * reading the source of every form, action and reader that used to touch a
 * duplicate: that is the half a later edit puts back without noticing.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyHousePolicy,
  applyHousePolicyToListing,
  clockHHMM,
  petsAllowedBy,
  type HousePolicy,
} from '../house-policy.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** Code only: comments may name a retired column to explain it. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const plan = {
  property_id: 'x',
  checkin_time: '16:00',
  checkout_time: '11:00',
  max_occupancy: 8,
  pets_allowed: true,
  quiet_hours: 'plan quiet',
  cancellation_policy_key: 'sca_50_30',
  cancellation_terms: 'plan terms',
  house_rules: 'plan rules',
};

const policy: HousePolicy = {
  id: 'x',
  default_checkout_time: '10:00 AM',
  max_occupancy: 6,
  pet_policy: 'No pets.',
  quiet_hours: '10pm to 8am',
  cancellation_policy: 'Full refund up to 30 days before arrival.',
  house_rules: 'No parties.',
};

describe('the rate plan reads the House policy columns', () => {
  test('every policy field comes from properties; pricing and the guest check-in stay the plan own', () => {
    const out = applyHousePolicy(plan, policy);
    assert.equal(out.checkout_time, '10:00');
    assert.equal(out.max_occupancy, 6);
    assert.equal(out.pets_allowed, false);
    assert.equal(out.quiet_hours, '10pm to 8am');
    assert.equal(out.cancellation_policy_key, 'custom');
    assert.equal(out.cancellation_terms, 'Full refund up to 30 days before arrival.');
    assert.equal(out.house_rules, 'No parties.');
    // The guest check-in is the one policy value the plan still owns.
    assert.equal(out.checkin_time, '16:00');
  });

  test('a blank on properties is a blank, never the retired copy', () => {
    const out = applyHousePolicy(plan, {
      id: 'x',
      default_checkout_time: null,
      max_occupancy: null,
      pet_policy: ' ',
      quiet_hours: null,
      cancellation_policy: null,
      house_rules: '',
    });
    assert.equal(out.checkout_time, '11:00', 'the default every reader already used');
    assert.equal(out.max_occupancy, null);
    assert.equal(out.pets_allowed, false);
    assert.equal(out.quiet_hours, null);
    assert.equal(out.cancellation_terms, null);
    assert.equal(out.house_rules, null);
  });

  test('a failed properties read leaves the plan as stored rather than blanking a quote', () => {
    assert.deepEqual(applyHousePolicy(plan, null), plan);
  });

  test('the listing record reads house rules and occupancy the same way', () => {
    const content = { house_rules: 'listing rules', accommodates: 9, title: 't' };
    assert.deepEqual(applyHousePolicyToListing(content, policy), { house_rules: 'No parties.', accommodates: 6, title: 't' });
    assert.deepEqual(applyHousePolicyToListing(content, null), content);
  });
});

describe('clock and pet parsing', () => {
  test('free-text clock values land as HH:MM', () => {
    assert.equal(clockHHMM('10:00 AM'), '10:00');
    assert.equal(clockHHMM('10am'), '10:00');
    assert.equal(clockHHMM('4 p.m.'), '16:00');
    assert.equal(clockHHMM('16:00:00'), '16:00');
    assert.equal(clockHHMM('12 AM'), '00:00');
    assert.equal(clockHHMM('noonish'), null);
    assert.equal(clockHHMM(null), null);
  });

  test('only a clear refusal reads as no pets', () => {
    assert.equal(petsAllowedBy('Two dogs under 40lb, $250 non-refundable.'), true);
    assert.equal(petsAllowedBy('Not more than two dogs.'), true);
    assert.equal(petsAllowedBy('No pets.'), false);
    assert.equal(petsAllowedBy('No dogs or cats, please.'), false);
    assert.equal(petsAllowedBy('Sorry, pets are not allowed.'), false);
    assert.equal(petsAllowedBy('No'), false);
    assert.equal(petsAllowedBy(null), false);
  });
});

describe('no second writer or reader of a retired copy', () => {
  test('the rate plan form and its action edit only the guest check-in', () => {
    const panel = code(read('src/app/properties/[id]/RatesPanel.tsx'));
    const action = code(read('src/app/properties/[id]/rates-actions.ts'));
    for (const name of ['checkout_time', 'max_occupancy', 'pets_allowed', 'quiet_hours', 'cancellation_policy_key', 'cancellation_terms', 'house_rules']) {
      assert.doesNotMatch(panel, new RegExp(`name="${name}"`), `RatesPanel still edits ${name}`);
      assert.doesNotMatch(action, new RegExp(`\\b${name}:`), `saveRatePlanAction still writes ${name}`);
    }
    assert.match(panel, /name="checkin_time"/);
    assert.match(panel, /Guest check-in/);
  });

  test('the listing form and its action leave house rules and accommodates alone', () => {
    const panel = code(read('src/app/properties/[id]/ListingPanel.tsx'));
    const action = code(read('src/app/properties/[id]/listing-actions.ts'));
    for (const name of ['house_rules', 'accommodates']) {
      assert.doesNotMatch(panel, new RegExp(`name="${name}"`), `ListingPanel still edits ${name}`);
      assert.doesNotMatch(action, new RegExp(`\\b${name}:`), `saveListingContentAction still writes ${name}`);
    }
  });

  test('every loader of the plan and the listing record overlays properties', () => {
    assert.match(code(read('src/lib/property-rates.ts')), /applyHousePolicy\(shapeRatePlan/);
    assert.match(code(read('src/lib/listing-content.ts')), /applyHousePolicyToListing\(content/);
  });

  test('the guest AI, the automations and climate read checkout from properties', () => {
    const kb = code(read('src/app/api/kb-facts/route.ts'));
    assert.doesNotMatch(kb, /select\('property_id, checkin_time, checkout_time'\)/);
    assert.match(kb, /check_out_time: normalizeTime\(p\.default_checkout_time\)/);
    const automations = code(read('src/lib/automations.ts'));
    assert.match(automations, /loadGuestTimes\(\[propertyId\]\)/);
    assert.doesNotMatch(automations, /select\('checkin_time, checkout_time'\)/);
    const climate = code(read('src/lib/climate.ts'));
    assert.match(climate, /withGuestHours/);
    assert.doesNotMatch(code(read('src/app/properties/[id]/ClimatePanel.tsx')), /name="check(in|out)_hour"/);
  });
});
