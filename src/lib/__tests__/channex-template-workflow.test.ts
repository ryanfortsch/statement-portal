import test from 'node:test';
import assert from 'node:assert/strict';
import { runCalderwoodTemplateWorkflow as run, reviewCalderwoodTemplateRelease as review } from '../channex-messaging/template-workflow.ts';
import { syntheticScheduleSnapshot, scheduleFixtureId as id } from './fixtures/channex-schedule-snapshot.ts';
const at = Date.parse('2026-11-12T16:00:00Z'), options = { enabled: true };
function fixture() {
  const s = syntheticScheduleSnapshot(at), ref = { captureId: id(91), rulesSha256: 'a'.repeat(64) };
  const release = { action: 'release', ...ref, releaseId: id(92), confirmation: 'release_four_guest_templates_only' };
  let current = { authority: 'guesty' as 'guesty' | 'helm', automationsEnabled: false, rules: structuredClone(s.capturedRules) };
  const calls: string[] = [];
  const deps = { clock: () => at, current: async () => current, rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push(name);
    if (name === 'helm_channex_read_template_capture') return { data: { format: 1, ...ref, capturedAt: new Date(at).toISOString(),
      propertyId: '65_calderwood', rules: s.capturedRules }, error: null };
    if (name === 'helm_channex_capture_templates') { assert.deepEqual(args, { p_actor: 'owner' }); return { data: { ...ref, count: 6, reused: false }, error: null }; }
    assert.equal(name, 'helm_channex_release_templates');
    assert.deepEqual(args, { p_release_id: release.releaseId, p_capture_id: ref.captureId, p_rules_sha256: ref.rulesSha256, p_actor: 'owner' });
    const reused = current.rules[0].enabled;
    current = { ...current, rules: structuredClone(s.currentRules) };
    return { data: { ...ref, releaseId: release.releaseId, guestRules: 4, reused }, error: null };
  } };
  return { s, ref, release, deps, calls, setCurrent: (v: typeof current) => { current = v; } };
}
test('owner workflow is default off; malformed actions and missing acknowledgment perform no calls', async () => {
  const f = fixture(); assert.equal((await run({ action: 'capture' }, 'owner', f.deps)).state, 'disabled');
  for (const raw of [null, {}, { ...f.release, confirmation: false }, { ...f.release, body: 'PRIVATE' }])
    assert.equal((await run(raw, 'owner', f.deps, options)).state, 'invalid');
  assert.deepEqual(f.calls, []);
});
test('capture and review cannot release, schedule or send and expose only safe summaries', async () => {
  const f = fixture();
  const capture = await run({ action: 'capture' }, ' owner ', f.deps, options);
  assert.deepEqual(capture, { state: 'captured', reference: f.ref, reused: false, canSend: false });
  const out = await review(f.ref, f.deps);
  assert.equal(out.configuration, 'prepared'); assert.equal(out.workflows.length, 6); assert.equal(out.canSend, false);
  assert.deepEqual(out.workflows.map(w => w.timing), ['30 minutes after confirmation', '1 day before arrival',
    '60 minutes before arrival', '1 day before departure', '10 days before arrival', '7 hours before arrival']);
  assert.deepEqual(f.calls, ['helm_channex_capture_templates', 'helm_channex_read_template_capture']);
  for (const word of ['body"', 'migration_policy', '{{', 'Synthetic Guest', 'password', 'PRIVATE']) assert.ok(!JSON.stringify(out).includes(word));
});
test('explicit release rechecks originals, records four guests, and same request reconciles after handover', async () => {
  const f = fixture();
  assert.equal((await run(f.release, 'owner', f.deps, options)).state, 'released');
  assert.equal((await review(f.ref, f.deps)).configuration, 'released');
  f.setCurrent({ authority: 'helm', automationsEnabled: true, rules: f.s.currentRules });
  assert.equal((await run(f.release, 'owner', f.deps, options)).state, 'existing');
  assert.ok(f.calls.every(n => ['helm_channex_read_template_capture', 'helm_channex_release_templates'].includes(n)));
});
test('modified rules or active source state block a new release', async () => {
  for (const changed of ['body', 'enabled', 'authority', 'automations']) {
    const f = fixture(), rules = structuredClone(f.s.capturedRules);
    if (changed === 'body') rules[0].body += ' changed';
    if (changed === 'enabled') rules[0].enabled = true;
    f.setCurrent({ authority: changed === 'authority' ? 'helm' : 'guesty', automationsEnabled: changed === 'automations', rules });
    assert.equal((await run(f.release, 'owner', f.deps, options)).state, 'blocked');
    assert.ok(!f.calls.includes('helm_channex_release_templates'));
  }
});
test('lost capture response returns uncertainty without retry or private exception', async () => {
  const f = fixture(); let calls = 0;
  f.deps.rpc = async () => { calls++; throw Error('PRIVATE'); };
  assert.deepEqual(await run({ action: 'capture' }, 'owner', f.deps, options), { state: 'uncertain', canSend: false });
  assert.equal(calls, 1);
});
