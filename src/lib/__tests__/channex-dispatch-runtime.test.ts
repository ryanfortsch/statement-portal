import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dispatchRetainedCalderwoodMessage as dispatch } from '../channex-messaging/dispatch-runtime.ts';
import { renderTemplate } from '../automations-core.ts';
import { retainedRuntimeFixture } from './fixtures/channex-retained-runtime.ts';
import { scheduleFixtureId as id } from './fixtures/channex-schedule-snapshot.ts';
import type { ChannexJob } from '../channex-messaging/worker.ts';

const at = Date.parse('2026-11-12T16:00:00Z'), options = { enabled: true };
function fixture() {
  const f = retainedRuntimeFixture(); f.time(at + 25 * 60000);
  const text = renderTemplate(f.s.capturedRules[0].body, { ...f.s.merge, guest_first: 'Synthetic' }).text;
  const job: ChannexJob = { ...f.review.scope, provider: 'Airbnb', environment: 'production', sendId: id(89),
    bookingId: f.s.route.remoteBookingId, threadId: f.s.route.threadId, bodySha256: createHash('sha256').update(text).digest('hex'),
    contextRevision: f.context.contextRevision, state: 'prepared', attemptId: null, providerMessageId: null };
  f.s.ledger.push({ id: job.sendId, booking_id: f.request.bookingId, property_id: '65_calderwood', automation_id: f.s.capturedRules[0].id,
    automation_key: 'booking_confirmed', fire_at: new Date(at + 20 * 60000).toISOString(), status: 'scheduled',
    planned_check_in: f.s.booking.start, planned_check_out: f.s.booking.end, sent_at: null, provider_message_id: null });
  const rpc = f.deps.rpc, fetcher = f.deps.fetcher;
  let claims = 0, posts = 0, finishes = 0, gets = 0;
  const request = { ...f.request, sendId: job.sendId };
  f.deps.rpc = async (name, args) => {
    if (name === 'helm_channex_message_read') return { data: structuredClone(job), error: null };
    if (name === 'helm_channex_message_claim') {
      claims++; assert.equal(job.state, 'prepared'); assert.equal(gets, 17);
      Object.assign(job, { state: 'attempting', attemptId: args.p_attempt_id }); return { data: true, error: null };
    }
    if (name === 'helm_channex_message_finish') {
      finishes++; Object.assign(job, { state: args.p_state, providerMessageId: args.p_provider_id }); return { data: true, error: null };
    }
    assert.notEqual(name, 'helm_channex_message_register');
    return rpc(name, args);
  };
  f.deps.fetcher = async (url, init) => {
    if (init?.method === 'POST') {
      posts++; assert.equal(job.state, 'attempting'); assert.equal(claims, 1);
      assert.equal(String(url), `https://app.channex.io/api/v1/message_threads/${job.threadId}/messages`);
      return Response.json({ data: { type: 'message', id: id(90), attributes: { sender: 'property', message: text, attachments: [] },
        relationships: { message_thread: { data: { type: 'message_thread', id: job.threadId } } } } });
    }
    gets++; return fetcher(url, init);
  };
  return { ...f, job, request, counts: () => ({ claims, posts, finishes, gets }),
    run: () => dispatch(request, f.deps, options) };
}
test('dispatch is default off and rejects unreviewed/extra input before any reads', async () => {
  const f = fixture();
  assert.equal((await dispatch(f.request, f.deps)).state, 'disabled');
  for (const raw of [null, {}, { ...f.request, text: 'PRIVATE' }, { ...f.request, sendId: 'bad' }])
    assert.equal((await dispatch(raw, f.deps, options)).state, 'blocked');
  assert.deepEqual(f.counts(), { claims: 0, posts: 0, finishes: 0, gets: 0 });
});
test('two fresh provider reviews and exact render precede one claim, one POST and receipt; no repeat', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.state, 'accepted'); assert.equal(result.providerReads, 17); assert.equal(result.providerPosts, 1);
  assert.deepEqual(f.counts(), { claims: 1, posts: 1, finishes: 1, gets: 17 });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal((await f.run()).state, 'needs_reconciliation'); assert.equal(f.counts().posts, 1);
});
test('wrong job, digest, schedule, frozen templates or not-yet-due blocks before claim', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => Object.assign(f.job, { bodySha256: 'f'.repeat(64) }),
    (f: ReturnType<typeof fixture>) => Object.assign(f.job, { threadId: id(98) }),
    (f: ReturnType<typeof fixture>) => { f.s.ledger[0].fire_at = new Date(at).toISOString(); },
    (f: ReturnType<typeof fixture>) => { f.s.currentRules = structuredClone(f.s.capturedRules); },
    (f: ReturnType<typeof fixture>) => { f.time(at); },
  ]) { const f = fixture(); mutate(f); assert.equal((await f.run()).state, 'blocked'); assert.equal(f.counts().claims, 0); assert.equal(f.counts().posts, 0); }
});
test('provider change or hold after first review blocks the final claim', async () => {
  for (const failure of ['clock', 'revision', 'closed', 'hold', 'render']) {
    const f = fixture(), fetcher = f.deps.fetcher, rpc = f.deps.rpc;
    f.deps.fetcher = async (url, init) => {
      const out = await fetcher(url, init);
      if (f.counts().gets === 9) {
        if (failure === 'clock') f.provider.v2.plannedArrival = '19:00';
        if (failure === 'revision') f.provider.booking.data.attributes.revision_id = id(97);
        if (failure === 'closed') f.provider.thread.data.attributes.is_closed = true;
        if (failure === 'hold') f.s.ledger[0].status = 'cancelled';
      }
      return out;
    };
    if (failure === 'render') f.deps.rpc = async (name, args) => {
      const out = await rpc(name, args);
      if (name === 'helm_channex_message_schedule_inputs' && f.counts().gets >= 9) {
        (out.data as { booking: { guestName: string } }).booking.guestName = 'Different Guest';
      } return out;
    };
    assert.equal((await f.run()).state, 'blocked', failure);
    assert.equal(f.counts().claims, 0); assert.equal(f.counts().posts, 0);
  }
});
test('previously scheduled confirmation cannot send fixed arrival wording for a verified early arrival', async () => {
  const f = fixture();
  f.s.clocks.plannedArrival = f.evidence.row.clocks.plannedArrival = f.provider.v2.plannedArrival = '13:00';
  assert.equal((await f.run()).state, 'blocked');
  assert.equal(f.counts().claims, 0); assert.equal(f.counts().posts, 0);
});
test('previously scheduled checkout cannot send fixed 11 AM wording for a verified late departure', async () => {
  const f = fixture(), rule = f.s.capturedRules.find(r => r.key === 'pre_checkout')!;
  f.s.clocks.plannedDeparture = f.evidence.row.clocks.plannedDeparture = f.provider.v2.plannedDeparture = '13:00';
  f.time(Date.parse('2026-11-27T18:05:00Z'));
  Object.assign(f.s.ledger[0], { automation_id: rule.id, automation_key: rule.key, fire_at: '2026-11-27T18:00:00Z' });
  Object.assign(f.job, { bodySha256: createHash('sha256').update(renderTemplate(rule.body, { guest_first: 'Synthetic' }).text).digest('hex') });
  assert.equal((await f.run()).state, 'blocked');
  assert.equal(f.counts().claims, 0); assert.equal(f.counts().posts, 0);
});
test('lost claim response never POSTs; lost provider response records unknown without retry', async () => {
  const f = fixture(), rpc = f.deps.rpc;
  f.deps.rpc = async (name, args) => { const out = await rpc(name, args); if (name === 'helm_channex_message_claim') throw Error('PRIVATE'); return out; };
  assert.equal((await f.run()).state, 'ledger_uncertain'); assert.equal(f.counts().posts, 0);
  assert.equal((await f.run()).state, 'needs_reconciliation');
  const g = fixture(), fetcher = g.deps.fetcher;
  g.deps.fetcher = async (url, init) => { const out = await fetcher(url, init); if (init?.method === 'POST') throw Error('PRIVATE'); return out; };
  assert.equal((await g.run()).state, 'unknown'); assert.equal(g.job.state, 'unknown');
  assert.equal((await g.run()).state, 'needs_reconciliation'); assert.equal(g.counts().posts, 1);
});
test('post-claim timeout preserves outcome; ledger failure is reported without provider retry', async () => {
  const f = fixture(), fetcher = f.deps.fetcher;
  f.deps.fetcher = async (url, init) => { const out = await fetcher(url, init); if (init?.method === 'POST') f.time(at + 30 * 60000); return out; };
  assert.equal((await f.run()).state, 'accepted'); assert.equal(f.counts().finishes, 1);
  const g = fixture(), rpc = g.deps.rpc;
  g.deps.rpc = async (name, args) => { if (name === 'helm_channex_message_finish') throw Error('PRIVATE'); return rpc(name, args); };
  const out = await g.run(); assert.equal(out.state, 'ledger_uncertain'); assert.equal(g.counts().posts, 1);
  assert.ok(!JSON.stringify(out).includes('PRIVATE')); assert.equal((await g.run()).state, 'needs_reconciliation');
});
