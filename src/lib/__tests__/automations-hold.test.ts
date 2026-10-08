import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPlan, keyDecided, sendStatusLabel, type PlannedSend } from '../automations-core.ts';
const plan: PlannedSend = { booking_id: 'stay', automation_id: 'rule', automation_key: 'code',
 property_id: 'home', fire_at: '2027-01-02T20:00:00Z', status: 'scheduled', error: null,
 planned_check_in: '2027-01-02', planned_check_out: '2027-01-04' };
const held = { ...plan, id: 'send', status: 'held', planned_check_in: '2027-01-01' };
test('held messages survive date replanning and still block replacement-rule duplicate sends', () => {
 assert.equal(diffPlan([plan], [held]).updates.length, 0);
 assert.equal(diffPlan([{ ...plan, automation_id: 'replacement' }], [held]).inserts.length, 0);
 assert.equal(keyDecided(held), true);
 assert.equal(sendStatusLabel('held'), 'Held by operator');
});
