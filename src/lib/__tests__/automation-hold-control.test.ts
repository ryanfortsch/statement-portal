import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeAutomationHold, type HoldRequest } from '../automation-hold-control.ts';
const request: HoldRequest = { propertyId: 'home', sendId: '00000000-0000-0000-0000-000000000002',
 actor: 'operator', hold: true, expectedUpdatedAt: '2026-10-08T12:00:00.123456Z' };
test('disabled or invalid hold operations never reach the database', async () => {
 const unreachable = async () => { throw new Error('must not call'); };
 assert.equal((await changeAutomationHold(request, false, unreachable)).ok, false);
 let calls = 0;
 const rpc = async () => { calls++; return { data: true, error: null }; };
 for (const over of [{ actor: '' }, { propertyId: '' }, { sendId: 'bad' }, { expectedUpdatedAt: 'bad' }]) {
  assert.equal((await changeAutomationHold({ ...request, ...over }, true, rpc)).ok, false);
 }
 assert.equal(calls, 0);
});
test('property identity, actor and full timestamp reach atomic RPC unchanged', async () => {
 assert.deepEqual(await changeAutomationHold(request, true, async args => {
  assert.deepEqual(args, { p_send_id: request.sendId, p_property_id: 'home', p_actor: 'operator',
   p_hold: true, p_expected_updated_at: request.expectedUpdatedAt });
  return { data: true, error: null };
 }), { ok: true, status: 'held' });
 assert.deepEqual(await changeAutomationHold({ ...request, hold: false }, true,
  async () => ({ data: true, error: null })), { ok: true, status: 'scheduled' });
});
test('lost CAS and uncertain outcomes never report success or retry', async () => {
 for (const result of [{ data: false, error: null }, { data: null, error: null },
  { data: true, error: { message: 'failure' } }]) {
  let calls = 0;
  const response = await changeAutomationHold(request, true, async () => { calls++; return result; });
  assert.equal(response.ok, false);
  assert.equal(calls, 1);
 }
 let calls = 0;
 const response = await changeAutomationHold(request, true, async () => { calls++; throw new Error('timeout after commit'); });
 assert.equal(response.ok, false);
 assert.equal(calls, 1);
});
