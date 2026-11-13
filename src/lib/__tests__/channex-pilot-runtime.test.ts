import test from 'node:test';
import assert from 'node:assert/strict';
import { runRetainedCalderwoodPilot } from '../channex-messaging/pilot-runtime.ts';
import { retainedPilotConfiguration, hasMessageCronCredential } from '../channex-messaging/runtime-config.ts';
import { retainedGuestSendId } from '../channex-messaging/schedule-coordinator.ts';
import { pilotRuntimeFixture as fixture } from './fixtures/channex-pilot-runtime.ts';
import { scheduleFixtureId as id } from './fixtures/channex-schedule-snapshot.ts';

const at = Date.parse('2026-11-12T16:00:00Z');
test('default off and malformed manifests access no credentials, database or provider', async () => {
  const f = fixture();
  assert.equal((await runRetainedCalderwoodPilot(f.manifest, f.deps)).state, 'disabled');
  for (const m of [null, {}, { ...f.manifest, sendId: id(4) }, { format: 1, stays: [] },
    { format: 1, stays: Array(5).fill(f.request) }, { format: 1, stays: [f.request, f.request] },
    { format: 1, stays: [{ ...f.request, enabled: true }] }])
    assert.equal((await runRetainedCalderwoodPilot(m, f.deps, { enabled: true })).state, 'configuration_required');
  assert.equal(f.calls.length, 0); assert.equal(f.credentials(), 0); assert.equal(f.reads.length, 0);
});
test('activation needs exact production environment, explicit mode and bounded server manifest', () => {
  const f = fixture(), env = { HELM_CHANNEX_MESSAGES_MODE: 'retained-pilot-v1', VERCEL_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: 'https://qjueexujiuticjrtqdyj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    CHANNEX_PRODUCTION_API_KEY: 'synthetic-channex', CRON_SECRET: 'synthetic-cron',
    HELM_CHANNEX_MESSAGES_MANIFEST: JSON.stringify(f.manifest) };
  assert.equal(retainedPilotConfiguration({}), null);
  assert.equal(retainedPilotConfiguration({ ...env, HELM_CHANNEX_MESSAGES_MODE: 'off' }), null);
  assert.deepEqual(retainedPilotConfiguration(env), f.manifest);
  for (const change of [{ VERCEL_ENV: 'preview' }, { HELM_CHANNEX_MESSAGES_MODE: 'true' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://staging.supabase.co' }, { CRON_SECRET: '' }, { CHANNEX_PRODUCTION_API_KEY: ' ' },
    { SUPABASE_SERVICE_ROLE_KEY: '' }, { HELM_ISOLATED_CALENDAR_ENABLED: 'true' }, { CHANNEX_WORKER_MODE: 'isolated-staging' },
    { HELM_CHANNEX_MESSAGES_MANIFEST: '{' }, { HELM_CHANNEX_MESSAGES_MANIFEST: ' '.repeat(4097) }])
    assert.throws(() => retainedPilotConfiguration({ ...env, ...change }));
});
test('cron authentication has no browser-session, query or missing-secret fallback', () => {
  const req = (authorization?: string) => new Request('https://helm.synthetic.test/api/cron/channex-messages?token=synthetic-cron',
    { headers: { cookie: 'owner-session=synthetic', ...(authorization ? { authorization } : {}) } });
  for (const value of [undefined, 'Bearer wrong', 'bearer synthetic-cron', 'synthetic-cron'])
    assert.equal(hasMessageCronCredential(req(value), 'synthetic-cron'), false);
  assert.equal(hasMessageCronCredential(req('Bearer synthetic-cron'), undefined), false);
  assert.equal(hasMessageCronCredential(req('Bearer synthetic-cron'), 'synthetic-cron'), true);
});
test('one automatic tick registers four future jobs, idle ticks skip providers, then due dispatch and receipt', async () => {
  const f = fixture();
  const first = await f.tick(); assert.equal(first.ok, true); assert.equal(first.stays[0].action, 'schedule');
  assert.equal(f.jobs.size, 4); assert.equal(f.writes.length, 4); assert.equal(f.counts().posts, 0);
  const idle = await f.tick(); assert.equal(idle.ok, true); assert.equal(idle.stays[0].action, 'idle');
  assert.equal(idle.stays[0].providerReads, 0);
  f.time(at + 25 * 60_000);
  const due = await f.tick(); assert.equal(due.stays[0].state, 'accepted'); assert.equal(due.stays[0].providerReads, 17);
  assert.equal(f.counts().posts, 1);
  const receipt = await f.tick(); assert.equal(receipt.stays[0].receiptState, 'recorded'); assert.equal(receipt.stays[0].providerReads, 2);
  assert.equal(f.counts().posts, 1); assert.equal((await f.tick()).stays[0].providerReads, 0);
  assert.ok(!JSON.stringify([first, idle, due, receipt]).includes('PRIVATE'));
  assert.ok(!JSON.stringify(due).includes(f.request.bookingId));
});
test('overlapping ticks have one SQL claim winner and exactly one provider POST', async () => {
  const f = fixture(); await f.tick(); f.time(at + 25 * 60_000);
  const out = await Promise.all([f.tick(), f.tick()]);
  assert.equal(out.filter(r => r.stays[0].state === 'accepted').length, 1);
  assert.equal(f.counts().posts, 1); assert.equal(f.jobs.get(retainedGuestSendId(f.request.bookingId, 'booking_confirmed'))!.state, 'accepted');
  await f.tick(); assert.equal(f.counts().posts, 1);
});
test('uncertain claim or provider response never retries a message on later ticks', async () => {
  for (const fail of ['claim', 'post']) {
    const f = fixture(); await f.tick(); f.time(at + 25 * 60_000);
    const rpc = f.deps.rpc, fetcher = f.deps.fetcher;
    f.deps.rpc = async (name, args) => { const out = await rpc(name, args);
      if (fail === 'claim' && name === 'helm_channex_message_claim') throw Error('PRIVATE'); return out; };
    f.deps.fetcher = async (url, init) => { const out = await fetcher(url, init);
      if (fail === 'post' && init?.method === 'POST') throw Error('PRIVATE'); return out; };
    assert.equal((await f.tick()).ok, false);
    await f.tick(); await f.tick(); assert.equal(f.counts().posts, fail === 'post' ? 1 : 0);
    assert.equal(f.counts().claims, 1);
  }
});
test('expired older job does not block a later due workflow; past times are never recreated', async () => {
  const f = fixture(); await f.tick(); f.time(Date.parse('2026-11-23T21:05:00Z'));
  const out = await f.tick(); assert.equal(out.stays[0].state, 'accepted'); assert.equal(out.ok, false);
  assert.equal(f.jobs.get(retainedGuestSendId(f.request.bookingId, 'booking_confirmed'))!.state, 'prepared');
  assert.equal(f.jobs.get(retainedGuestSendId(f.request.bookingId, 'pre_arrival'))!.state, 'accepted');
  assert.equal(f.counts().posts, 1); assert.equal(f.writes.length, 4);
});
test('cancellation or unavailable binding still permits receipt recovery, never a fresh send', async () => {
  const f = fixture(); await f.tick(); f.time(at + 25 * 60_000); await f.tick();
  const rpc = f.deps.rpc;
  f.deps.rpc = async (name, args) => name === 'helm_channex_message_schedule_inputs' ? { data: null, error: null } : rpc(name, args);
  const out = await f.tick(); assert.equal(out.stays[0].receiptState, 'recorded'); assert.equal(out.ok, false);
  assert.equal(f.counts().posts, 1); assert.equal(f.writes.length, 4);
});
test('missing provider receipt stays unconfirmed and never causes resend', async () => {
  const f = fixture(); await f.tick(); f.time(at + 25 * 60_000); await f.tick();
  const [message] = f.messages.splice(0);
  const missing = await f.tick(); assert.equal(missing.stays[0].receiptState, 'unconfirmed'); assert.equal(missing.ok, false);
  assert.equal(f.counts().posts, 1);
  f.messages.push(message);
  assert.equal((await f.tick()).stays[0].receiptState, 'recorded'); assert.equal(f.counts().posts, 1);
});
test('provider drift, archived template changes and holds stop automatic dispatch', async () => {
  for (const change of ['provider', 'template', 'hold']) {
    const f = fixture(); await f.tick(); f.time(at + 25 * 60_000);
    if (change === 'provider') f.provider.v2.plannedArrival = '21:00';
    if (change === 'template') f.s.capturedRules[0].body += ' changed';
    if (change === 'hold') f.s.ledger[0].status = 'cancelled';
    assert.equal((await f.tick()).ok, false); assert.equal(f.counts().posts, 0);
  }
});
test('four-stay batch isolates unavailable stays and never auto-enrolls a fifth', async () => {
  const f = fixture();
  const manifest = { format: 1, stays: [f.request, ...[201, 202, 203].map(n => ({ ...f.request, bookingId: id(n) }))] };
  const out = await runRetainedCalderwoodPilot(manifest, f.deps, { enabled: true });
  assert.equal(out.stays.length, 4); assert.equal(out.stays[0].action, 'schedule');
  assert.ok(out.stays.slice(1).every(s => s.attention && s.providerReads === 0));
  assert.equal(f.jobs.size, 4); assert.equal(f.counts().posts, 0);
});
test('receipt recovery does not starve behind a future rule that cannot render', async () => {
  const f = fixture(); f.s.merge = {}; // Actual private input reader still supplies the valid synthetic booking fields.
  const rpc = f.deps.rpc;
  f.deps.rpc = async (name, args) => {
    const out = await rpc(name, args);
    if (name === 'helm_channex_message_schedule_inputs') (out.data as { lockMapped: boolean }).lockMapped = true;
    return out;
  };
  await f.tick(); assert.equal(f.jobs.size, 3); f.time(at + 25 * 60_000); await f.tick();
  assert.equal(f.counts().posts, 1);
  const out = await f.tick(); assert.equal(out.stays[0].action, 'idle');
  assert.equal(out.stays[0].receiptState, 'recorded'); assert.equal(f.counts().posts, 1);
  assert.equal(out.stays[0].providerReads, 2); // No repeated scan for the missing per-stay code.
  assert.equal(out.ok, false); // Per-stay code support remains an explicit review issue.
});
