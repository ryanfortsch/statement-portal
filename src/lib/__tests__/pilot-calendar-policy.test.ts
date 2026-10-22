import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRole } from '../helm-access.ts';
import { applyHousePolicy, clockHHMM, type HousePolicy } from '../house-policy.ts';

// The pilot incorporates these current-main policies without changing sign-in.
describe('pilot calendar current-main policies', () => {
  it('unknown staff and an owner viewing as staff cannot acquire owner privileges', () => {
    assert.equal(effectiveRole('ryan@risingtidestr.com', undefined), 'owner');
    assert.equal(effectiveRole('ryan@risingtidestr.com', 'staff'), 'staff');
    assert.equal(effectiveRole('unlisted@risingtidestr.com', 'owner'), 'staff');
    assert.equal(effectiveRole(undefined, 'owner'), 'staff');
  });
  it('uses property checkout/policy while retaining guest check-in and all prices', () => {
    const plan = { checkin_time: '16:00', checkout_time: '11:00', base_nightly_cents: 12345,
      min_nights_default: 2, max_occupancy: 6, pets_allowed: true, quiet_hours: 'old',
      cancellation_policy_key: 'standard', cancellation_terms: null, house_rules: 'old' };
    const policy: HousePolicy = { id: 'fictional', default_checkout_time: '10:30 AM', max_occupancy: 4,
      pet_policy: 'No pets', quiet_hours: '10pm–8am', cancellation_policy: 'Reviewed policy', house_rules: 'Reviewed rules' };
    const result = applyHousePolicy(plan, policy);
    assert.equal(result.checkin_time, '16:00');
    assert.equal(result.checkout_time, '10:30');
    assert.equal(result.base_nightly_cents, plan.base_nightly_cents);
    assert.equal(result.min_nights_default, 2);
    assert.equal(result.max_occupancy, 4);
    assert.equal(result.pets_allowed, false);
    assert.equal(result.cancellation_terms, 'Reviewed policy');
    assert.deepEqual(applyHousePolicy(plan, null), plan);
    assert.equal(clockHHMM('25:00'), null);
  });
});
