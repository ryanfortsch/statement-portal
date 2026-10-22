import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffPlan, isProviderManagedSend, isResumablePause, keyDecided, resumableKeys,
  stayCancelPausedKeys, withdrawnSends, PAUSE_REASON_STAY_CANCELLED,
  PAUSE_REASON_SUPERSEDED, PAUSE_REASON_NO_LONGER_APPLIES,
  type ExistingSend, type PlannedSend,
} from '../automations-core.ts';

const plan: PlannedSend = { booking_id: 'HELMTEST-stay', automation_id: 'HELMTEST-rule',
  automation_key: 'pre_arrival', property_id: 'HELMTEST-home', fire_at: '2027-01-02T16:00:00Z',
  status: 'scheduled', error: null, planned_check_in: '2027-01-03', planned_check_out: '2027-01-06' };
const row: ExistingSend = { ...plan, id: 'HELMTEST-send', fire_at: '2027-01-01T16:00:00Z',
  planned_check_in: '2027-01-02', planned_check_out: '2027-01-05' };
const rails = ['channex', 'quo_cleaner', 'guesty_history'];

test('native replanning never retimes, revives or counts provider-owned jobs as native changes', () => {
  for (const delivery_used of rails) for (const status of ['scheduled','held','sent','sending','failed','cancelled','awaiting_approval','skipped_dates_moved']) {
    const existing = { ...row, delivery_used, status, error: PAUSE_REASON_STAY_CANCELLED };
    const before = structuredClone(existing);
    const result = diffPlan([plan], [existing]);
    assert.deepEqual(result, { inserts: [], updates: [], unchanged: 0, frozen: 1, resumed: 0, keyed: 0 });
    assert.deepEqual(existing, before);
  }
});
test('a replacement or deleted rule cannot create a second delivery for a reserved message key', () => {
  for (const delivery_used of rails) for (const status of ['scheduled','held','failed','cancelled','sending','sent']) {
    for (const automation_id of ['HELMTEST-retired-rule', null]) {
      const existing = { ...row, automation_id, delivery_used, status, error: PAUSE_REASON_SUPERSEDED };
      assert.equal(keyDecided(existing), true);
      const result = diffPlan([plan], [existing]);
      assert.equal(result.keyed, 1);
      assert.deepEqual(result.inserts, []);
    }
  }
});
test('source and provider reservations do not block other stays or other workflow keys', () => {
  for (const delivery_used of rails) {
    assert.equal(diffPlan([plan], [{ ...row, automation_id: null, delivery_used, booking_id: 'HELMTEST-other-stay' }]).inserts.length, 1);
    assert.equal(diffPlan([plan], [{ ...row, automation_id: null, delivery_used, automation_key: 'pre_checkout' }]).inserts.length, 1);
  }
});
test('provider cancellations never enter native revival or first-confirmation catch-up paths', () => {
  for (const delivery_used of rails) for (const error of [PAUSE_REASON_STAY_CANCELLED, PAUSE_REASON_SUPERSEDED, PAUSE_REASON_NO_LONGER_APPLIES, 'automations disabled by HELMTEST']) {
    const existing = { ...row, delivery_used, status: 'cancelled', error };
    assert.equal(isResumablePause(existing), false);
    assert.equal(resumableKeys([existing]).size, 0);
    assert.equal(stayCancelPausedKeys([existing]).size, 0);
  }
});
test('native withdrawal leaves provider reminders to their final eligibility checks', () => {
  const rows = [...rails.map(delivery_used => ({ ...row, id: delivery_used, delivery_used })), row];
  assert.deepEqual(withdrawnSends([], rows, [{ id: plan.automation_id, trigger: 'pre_arrival' }], new Set([plan.automation_id])), [row.id]);
});
test('ordinary native jobs retain their retiming, retry, withdrawal and revival behavior', () => {
  for (const delivery_used of [undefined, null, 'sms', 'email', 'ota_manual']) {
    const existing = { ...row, delivery_used };
    assert.equal(isProviderManagedSend(existing), false);
    assert.equal(diffPlan([plan], [existing]).updates.length, 1);
    assert.equal(diffPlan([plan], [{ ...existing, automation_id: null, status: 'failed' }]).inserts.length, 1);
    const paused = { ...existing, status: 'cancelled', error: PAUSE_REASON_STAY_CANCELLED };
    assert.equal(diffPlan([plan], [paused]).resumed, 1);
    assert.equal(resumableKeys([paused]).size, 1);
    assert.equal(stayCancelPausedKeys([paused]).size, 1);
  }
});
