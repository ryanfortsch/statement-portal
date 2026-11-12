import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalderwoodTemplateCaptureReader } from '../channex-messaging/template-retention.ts';
import { syntheticScheduleSnapshot, scheduleFixtureId as id } from './fixtures/channex-schedule-snapshot.ts';
const now = Date.parse('2026-11-12T15:00:00Z'), digest = 'a'.repeat(64);
function fixture() {
  return { format: 1, captureId: id(901), propertyId: '65_calderwood', capturedAt: new Date(now).toISOString(),
    rulesSha256: digest, rules: syntheticScheduleSnapshot(now).capturedRules };
}
test('retained reader is default off and selects the explicit receipt', async () => {
  let calls = 0;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls++; assert.equal(name, 'helm_channex_read_template_capture');
    assert.deepEqual(args, { p_capture_id: id(901), p_rules_sha256: digest });
    return { data: fixture(), error: null };
  };
  assert.equal(await createCalderwoodTemplateCaptureReader(rpc).load('bad', 'bad'), null); assert.equal(calls, 0);
  const loaded = await createCalderwoodTemplateCaptureReader(rpc, { enabled: true }).load(id(901), digest, now);
  assert.equal(loaded?.capturedRules.length, 6); assert.ok(loaded?.capturedRules.every(r => !r.enabled));
});
test('missing capture stays missing; malformed, active, partial or altered captures fail closed', async () => {
  assert.equal(await createCalderwoodTemplateCaptureReader(async () => ({ data: null, error: null }), { enabled: true }).load(id(901), digest, now), null);
  for (const mutate of [
    (c: ReturnType<typeof fixture>) => { c.captureId = id(902); },
    (c: ReturnType<typeof fixture>) => { c.rulesSha256 = 'b'.repeat(64); },
    (c: ReturnType<typeof fixture>) => { c.capturedAt = new Date(now + 1).toISOString(); },
    (c: ReturnType<typeof fixture>) => { c.rules.pop(); },
    (c: ReturnType<typeof fixture>) => { c.rules[0].enabled = true; },
    (c: ReturnType<typeof fixture>) => { c.rules[0].body += 'PRIVATE altered content'; },
    (c: ReturnType<typeof fixture>) => { c.rules[0].migration_policy = null; },
  ]) {
    const c = fixture(); mutate(c);
    await assert.rejects(createCalderwoodTemplateCaptureReader(async () => ({ data: c, error: null }), { enabled: true }).load(id(901), digest, now),
      { message: 'Retained message templates unavailable' });
  }
});
test('database errors and invalid caller identities reveal no private details', async () => {
  let calls = 0;
  const reader = createCalderwoodTemplateCaptureReader(async () => { calls++; throw Error('PRIVATE SQL details'); }, { enabled: true });
  await assert.rejects(reader.load('invalid', digest, now), { message: 'Retained message templates unavailable' }); assert.equal(calls, 0);
  await assert.rejects(reader.load(id(901), digest, now), { message: 'Retained message templates unavailable' }); assert.equal(calls, 1);
});
