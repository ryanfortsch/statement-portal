import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseCalderwoodGuestTemplates as release } from '../channex-messaging/template-release.ts';
import { resolveAutomationsFor, planAutomationSends, decideDispatch } from '../automations-core.ts';
import { syntheticScheduleSnapshot, scheduleFixtureId as id } from './fixtures/channex-schedule-snapshot.ts';
const request = { releaseId: id(91), captureId: id(92), rulesSha256: 'a'.repeat(64) };
const options = { enabled: true };
test('release default off and invalid identity perform no database call', async () => {
  const rpc = async () => { throw Error('MUST NOT CALL'); };
  assert.equal((await release(request, 'owner', rpc)).state, 'disabled');
  for (const r of [null, {}, { ...request, releaseId: 'bad' }, { ...request, rulesSha256: 'bad' }, { ...request, body: 'PRIVATE' }])
    assert.equal((await release(r, 'owner', rpc, options)).state, 'invalid');
  for (const actor of ['', ' ', 'a'.repeat(201)]) assert.equal((await release(request, actor, rpc, options)).state, 'invalid');
});
test('release passes exact receipt identity, returns metadata only, and reuses the same request', async () => {
  for (const reused of [false, true]) {
    let calls = 0;
    const result = await release(request, ' owner ', async (name, args) => {
      calls++; assert.equal(name, 'helm_channex_release_templates');
      assert.deepEqual(args, { p_release_id: request.releaseId, p_capture_id: request.captureId, p_rules_sha256: request.rulesSha256, p_actor: 'owner' });
      return { data: { ...request, guestRules: 4, reused }, error: null };
    }, options);
    assert.deepEqual(result, { state: reused ? 'existing' : 'released', releaseId: request.releaseId, guestRules: 4, canSend: false });
    assert.equal(calls, 1);
  }
});
test('ambiguous response never retries, clears identity, or returns database errors', async () => {
  for (const data of [null, {}, { ...request, guestRules: 6, reused: false }, { ...request, releaseId: id(99), guestRules: 4, reused: false },
    { ...request, guestRules: 4, reused: false, body: 'PRIVATE' }]) {
    let calls = 0;
    assert.deepEqual(await release(request, 'owner', async () => { calls++; return { data, error: null }; }, options), { state: 'uncertain', canSend: false });
    assert.equal(calls, 1);
  }
  assert.deepEqual(await release(request, 'owner', async () => { throw Error('PRIVATE'); }, options), { state: 'uncertain', canSend: false });
});
test('released, replaced and fleet rules never enter generic Calderwood scheduling or approved sending', () => {
  const at = Date.parse('2026-11-12T16:00:00Z'), s = syntheticScheduleSnapshot(at);
  const booking = { id: s.booking.id, property_id: '65_calderwood', status: 'confirmed', duplicate_of: null,
    guest_name: 'Synthetic', guest_phone: null, guest_email: null, channel: 'airbnb', check_in: s.booking.start, check_out: s.booking.end, first_seen_at: new Date(at).toISOString(), booked_at: new Date(at).toISOString() };
  for (const rule of s.currentRules.map(r => ({ ...r, enabled: true, migration_policy: null }))) {
    for (const r of [rule, { ...rule, id: id(99) }, { ...rule, property_id: null }]) {
      assert.deepEqual(resolveAutomationsFor('65_calderwood', [r]), []);
      assert.deepEqual(planAutomationSends({ bookings: [booking], rules: [r], plans: {}, adjustments: {}, now: new Date(at) }), []);
      const decision = decideDispatch({ row: { planned_check_in: booking.check_in, planned_check_out: booking.check_out },
        booking, rule: r, property: { automations_enabled: true, calendar_authority: 'helm' }, guest: null, recipients: [],
        rendered: { missing: [] }, lockMapped: false, approved: true });
      assert.equal(decision.outcome, 'awaiting_approval'); assert.equal(decision.rail, null);
    }
    assert.equal(resolveAutomationsFor('another_home', [{ ...rule, property_id: null }]).length, 1);
  }
});
