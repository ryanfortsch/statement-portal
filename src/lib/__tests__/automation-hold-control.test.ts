import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeAutomationHold, holdReleaseBlockReason, automationHoldsEnabled, type HoldRequest } from '../automation-hold-control.ts';
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

test('held queue explains blocked releases and permits only unchanged canonical confirmed stays', () => {
 const send = { property_id: 'home', planned_check_in: '2027-01-01', planned_check_out: '2027-01-04' };
 const booking = { property_id: 'home', status: 'confirmed', duplicate_of: null, check_in: '2027-01-01', check_out: '2027-01-04' };
 assert.equal(holdReleaseBlockReason(send, booking), null);
 assert.match(holdReleaseBlockReason(send, undefined)!, /could not be verified/);
 assert.match(holdReleaseBlockReason(send, { ...booking, status: 'cancelled' })!, /cancelled/);
 assert.match(holdReleaseBlockReason(send, { ...booking, status: 'pending' })!, /not confirmed/);
 assert.match(holdReleaseBlockReason(send, { ...booking, duplicate_of: 'canonical' })!, /duplicate/);
 assert.match(holdReleaseBlockReason(send, { ...booking, property_id: 'other' })!, /property changed/);
 assert.match(holdReleaseBlockReason(send, { ...booking, check_in: '2027-01-02' })!, /dates changed/);
 assert.match(holdReleaseBlockReason(send, { ...booking, check_out: '2027-01-05' })!, /dates changed/);
});

test('pilot hold controls require both non-production runtime and exact isolated database', () => {
 const env = { HELM_AUTOMATION_HOLDS_ENABLED: 'true', VERCEL_ENV: 'preview', NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://jgkblfozftcvymvwhhii.supabase.co' };
 assert.equal(automationHoldsEnabled(env), true);
 for (const over of [
  { HELM_AUTOMATION_HOLDS_ENABLED: undefined }, { VERCEL_ENV: 'production' },
  { VERCEL_ENV: undefined }, { NEXT_PUBLIC_SUPABASE_URL: undefined },
  { NEXT_PUBLIC_SUPABASE_URL: 'https://another-project.supabase.co' },
  { NEXT_PUBLIC_SUPABASE_URL: 'https://jgkblfozftcvymvwhhii.supabase.co.attacker.example' },
 ]) assert.equal(automationHoldsEnabled({ ...env, ...over }), false);
 assert.equal(automationHoldsEnabled({ ...env, VERCEL_ENV: undefined, NODE_ENV: 'development' }), true);
});
