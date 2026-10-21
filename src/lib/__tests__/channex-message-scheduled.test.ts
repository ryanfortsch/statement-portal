import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { messageCronConfig, renderScheduledMessage, runScheduledChannexMessages } from '../channex-messaging/scheduled.ts';
import type { ChannexJob, MessageRpc } from '../channex-messaging/worker.ts';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const config = { propertyId: 'HELMTEST-home', environment: 'staging' as const, apiKey: 'HELMTEST-key' };
const env = { CHANNEX_MESSAGES_ENABLED: 'true', CHANNEX_MESSAGES_ENVIRONMENT: 'staging',
  CHANNEX_MESSAGES_PROPERTY_ID: config.propertyId, CHANNEX_MESSAGES_API_KEY: config.apiKey };
function snapshot() {
  return { propertyId: config.propertyId, environment: config.environment, status: 'scheduled', revision: 'a'.repeat(32),
    fireAt: '2027-01-01T20:00:00Z', renderAt: '2027-01-01T20:00:01Z',
    body: 'Hello {{guest_first}}, {{arrival_when}} at {{check_in_time}}. Code {{door_code}}.',
    input: { booking: { guest_name: 'HELMTEST Guest', check_in: '2027-01-01', check_out: '2027-01-04' },
      guest: { first_name: 'HELMTEST', full_name: null },
      property: { name: 'HELMTEST-home', title: null, address: null, wifi_name: null, parking: null },
      plan: { checkin_time: '16:00:00', checkout_time: '11:00' },
      access: { smart_lock_code: 'HELMTEST-code', key_code_location: null, wifi_password: null },
      stayCode: null, lockMapped: false, trashDay: null, timeZone: 'America/New_York' } };
}
function fixture() {
  const snap = snapshot(), calls: string[] = [];
  let posts = 0, gets = 0;
  let job: ChannexJob = { sendId: id(1), environment: config.environment, propertyId: id(2), channelId: id(3),
    provider: 'Airbnb', bookingId: id(4), threadId: id(5), bodySha256: 'b'.repeat(64), contextRevision: 'b'.repeat(32),
    state: 'prepared', attemptId: null, providerMessageId: null };
  const rpc: MessageRpc = async (name, args) => {
    calls.push(name);
    let data: unknown = null;
    if (name === 'automation_channex_candidates') { assert.equal(args.p_property_id, config.propertyId); assert.equal(args.p_environment, config.environment); data = [id(1)]; }
    else if (name === 'automation_channex_snapshot') data = snap;
    else if (name === 'automation_channex_read') data = { ...job };
    else if (name === 'automation_channex_refresh') {
      job = { ...job, bodySha256: args.p_body_sha256 as string, contextRevision: args.p_revision as string }; data = true;
    } else if (name === 'automation_channex_claim') {
      data = job.state === 'prepared'; if (data) job = { ...job, state: 'attempting', attemptId: args.p_attempt_id as string };
    } else if (name === 'automation_channex_finish') {
      job = { ...job, state: args.p_state as ChannexJob['state'], providerMessageId: args.p_provider_id as string | null }; data = true;
    } else if (name !== 'automation_channex_checked') assert.fail('Unexpected RPC');
    return { data, error: null };
  };
  const factory: NonNullable<Parameters<typeof runScheduledChannexMessages>[0]['transportFactory']> = () => ({
    sendText: async (input, claim) => {
      assert.equal(input.text, renderScheduledMessage(snap).text);
      const attempt = { environment: job.environment, propertyId: job.propertyId, channelId: job.channelId, provider: job.provider,
        bookingId: job.bookingId, threadId: job.threadId, bodySha256: job.bodySha256 };
      if (!await claim(attempt)) return { state: 'not_sent', reason: 'dispatch_not_authorized' };
      posts++; return { state: 'accepted', receipt: { ...attempt, providerMessageId: id(9) } };
    },
    verifyReceipt: async () => { gets++; return { state: 'recorded' }; },
  });
  return { snap, rpc, factory, calls, posts: () => posts, gets: () => gets,
    run: (override: Partial<Parameters<typeof runScheduledChannexMessages>[0]> = {}) =>
      runScheduledChannexMessages({ config, rpc, transportFactory: factory, ...override }) };
}
test('cron configuration requires exact enable flag and explicit property, environment and key', () => {
  for (const enabled of [undefined, 'false', '1', 'TRUE']) assert.equal(messageCronConfig({ ...env, CHANNEX_MESSAGES_ENABLED: enabled }), null);
  assert.deepEqual(messageCronConfig(env), config);
  for (const key of ['CHANNEX_MESSAGES_ENVIRONMENT', 'CHANNEX_MESSAGES_PROPERTY_ID', 'CHANNEX_MESSAGES_API_KEY']) {
    assert.throws(() => messageCronConfig({ ...env, [key]: '' }), /configuration incomplete/);
  }
});
test('disabled or differently scoped cron performs no database/provider work', async () => {
  const f = fixture(); await f.run({ config: null }); await f.run({ propertyId: 'HELMTEST-other' });
  assert.equal(f.calls.length, 0); assert.equal(f.posts(), 0);
});
test('dry cron only counts bounded candidates without loading access data', async () => {
  const f = fixture(); assert.equal((await f.run({ dry: true })).candidates, 1);
  assert.deepEqual(f.calls, ['automation_channex_candidates']); assert.equal(f.posts(), 0);
});
test('render uses verified times, current context and the actual body digest', () => {
  const snap = snapshot(); snap.input.plan.checkin_time = '18:00';
  const rendered = renderScheduledMessage(snap);
  assert.match(rendered.text, /today at 6:00 PM/);
  assert.equal(rendered.bodySha256, createHash('sha256').update(rendered.text).digest('hex'));
});
test('unknown times, missing fields, invalid dates and unfilled placeholders block rather than falling back', () => {
  for (const change of [
    (s: ReturnType<typeof snapshot>) => { s.input.plan.checkin_time = ''; },
    (s: ReturnType<typeof snapshot>) => { s.input.plan.checkout_time = '99:00'; },
    (s: ReturnType<typeof snapshot>) => { s.input.booking.check_in = '2027-02-30'; },
    (s: ReturnType<typeof snapshot>) => { s.input.booking.check_out = '2026-01-01'; },
    (s: ReturnType<typeof snapshot>) => { s.input.access.smart_lock_code = ''; },
    (s: ReturnType<typeof snapshot>) => { s.body = 'Hello {{missing_field}}'; },
    (s: ReturnType<typeof snapshot>) => { s.body = 'Code ••••'; },
  ]) { const snap = snapshot(); change(snap); assert.throws(() => renderScheduledMessage(snap)); }
});
test('scheduled path refreshes before claim, sends once and next pass only reconciles', async () => {
  const f = fixture(); assert.equal((await f.run()).accepted, 1); assert.equal(f.posts(), 1);
  assert.ok(f.calls.indexOf('automation_channex_refresh') < f.calls.indexOf('automation_channex_claim'));
  assert.equal((await f.run()).recorded, 1); assert.equal(f.posts(), 1); assert.equal(f.gets(), 1);
});
test('held and future jobs refresh without any provider calls', async () => {
  for (const mode of ['held', 'future']) {
    const f = fixture();
    if (mode === 'held') f.snap.status = 'held'; else f.snap.fireAt = '2027-01-02T20:00:00Z';
    const result = await f.run(); assert.equal(result.refreshed, 1); assert.equal(f.posts(), 0); assert.equal(f.gets(), 0);
    assert.ok(!f.calls.includes('automation_channex_claim'));
  }
});
test('a lost refresh race or foreign property never authorizes a provider POST', async () => {
  const f = fixture();
  const result = await f.run({ rpc: async (name, args) => name === 'automation_channex_refresh' ? { data: false, error: null } : f.rpc(name, args) });
  assert.equal(result.blocked, 1); assert.equal(f.posts(), 0);
  f.snap.propertyId = 'HELMTEST-other'; assert.equal((await f.run()).blocked, 1); assert.equal(f.posts(), 0);
});
test('cancelled sends do not refresh, and blocked candidates are stamped for fair rotation', async () => {
  const f = fixture(); f.snap.status = 'cancelled'; assert.equal((await f.run()).blocked, 1);
  assert.ok(!f.calls.includes('automation_channex_refresh')); assert.equal(f.calls.at(-1), 'automation_channex_checked');
});
test('ledger errors and render failures never leak source values or credentials', async () => {
  const f = fixture(); f.snap.input.access.smart_lock_code = '';
  const result = await f.run(); assert.equal(result.attention, 1); assert.ok(!JSON.stringify(result).includes('HELMTEST'));
  await assert.rejects(f.run({ rpc: async () => { throw Error('HELMTEST secret failure'); } }), e =>
    e instanceof Error && e.message === 'Channex message ledger unavailable');
});
test('a receipt write failure retries only the database save, not the provider send', async () => {
  const f = fixture(); let saves = 0;
  const result = await f.run({ rpc: async (name, args) => {
    if (name === 'automation_channex_finish' && saves++ === 0) return { data: false, error: 'HELMTEST temporary failure' };
    return f.rpc(name, args);
  } });
  assert.equal(result.accepted, 1); assert.equal(saves, 2); assert.equal(f.posts(), 1);
});
