import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ChannexMessageWorker, createChannexJobStore, type ChannexJob, type ChannexJobStore } from '../channex-messaging/worker.ts';
import { ChannexMessageTransport } from '../channex-messaging/transport.ts';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const text = 'HELMTEST synthetic welcome';
const hash = createHash('sha256').update(text).digest('hex');
const job: ChannexJob = { sendId: id(1), environment: 'staging', propertyId: id(2), channelId: id(3), provider: 'Airbnb',
  bookingId: id(4), threadId: id(5), bodySha256: hash, contextRevision: 'a'.repeat(32), state: 'prepared', attemptId: null, providerMessageId: null };
const render = async () => ({ text, contextRevision: job.contextRevision });
const relation = (i: string) => ({ data: { id: i } });
function fixture() {
  let row = { ...job }, posts = 0, reads = 0;
  const store: ChannexJobStore = {
    read: async () => ({ ...row }),
    claim: async (_, attemptId) => {
      if (row.state !== 'prepared') return false;
      row = { ...row, state: 'attempting', attemptId }; return true;
    },
    finish: async (_, attemptId, outcome) => {
      assert.equal(row.attemptId, attemptId);
      row = { ...row, state: outcome.state, providerMessageId: 'providerMessageId' in outcome ? outcome.providerMessageId : null }; return true;
    },
  };
  const client = new ChannexMessageTransport({ scope: job, apiKey: 'HELMTEST', sendEnabled: true, fetcher: async (url, init) => {
    const message = { id: id(9), type: 'message', attributes: { sender: 'property', message: text, attachments: [] },
      relationships: { message_thread: relation(job.threadId) } };
    if (init.method === 'POST') { posts++; return Response.json({ data: message }); }
    reads++;
    if (url.includes('/messages?')) return Response.json({ data: [message], meta: { total: 1, page: 1, limit: 100 } });
    return Response.json({ data: { id: job.threadId, type: 'message_thread', attributes: { is_closed: false, provider: job.provider },
      relationships: { property: relation(job.propertyId), channel: relation(job.channelId), booking: relation(job.bookingId) } } });
  } });
  return { store, client, row: () => row, posts: () => posts, reads: () => reads,
    worker: () => new ChannexMessageWorker({ store, transport: client, enabled: true }) };
}
test('default worker does not read, render, claim or send', async () => {
  const f = fixture();
  assert.deepEqual(await new ChannexMessageWorker({ store: f.store, transport: f.client }).dispatch(job.sendId, async () => { throw Error('not called'); }), { state: 'disabled' });
  assert.equal(f.reads(), 0); assert.equal(f.posts(), 0);
});
test('two concurrent workers produce one claim and one POST; a new worker cannot resend', async () => {
  const f = fixture();
  const results = await Promise.all([f.worker().dispatch(job.sendId, render), f.worker().dispatch(job.sendId, render)]);
  assert.equal(results.filter(r => r.state === 'accepted').length, 1);
  assert.equal(f.posts(), 1);
  assert.equal((await f.worker().dispatch(job.sendId, render)).state, 'needs_reconciliation');
  assert.equal((await f.worker().reconcile(job.sendId)).state, 'recorded');
  assert.equal(f.row().state, 'recorded'); assert.equal(f.posts(), 1);
});
test('renderer revision/body changes block before provider inspection', async () => {
  const f = fixture();
  for (const rendered of [{ text: text + ' changed', contextRevision: job.contextRevision }, { text, contextRevision: 'b'.repeat(32) }]) {
    assert.equal((await f.worker().dispatch(job.sendId, async () => rendered)).state, 'blocked');
  }
  for (const bad of ['Code: ••••', 'Welcome [guest_first]']) {
    const bound = { ...job, bodySha256: createHash('sha256').update(bad).digest('hex') };
    f.store.read = async () => bound;
    assert.equal((await f.worker().dispatch(job.sendId, async () => ({ text: bad, contextRevision: job.contextRevision }))).state, 'blocked');
  }
  assert.equal(f.reads(), 0); assert.equal(f.posts(), 0);
});
test('lost claim acknowledgement never reaches POST and the permanent claim blocks restart', async () => {
  const f = fixture(), original = f.store.claim;
  f.store.claim = async (...args) => { await original(...args); throw Error('HELMTEST private database failure'); };
  assert.equal((await f.worker().dispatch(job.sendId, render)).state, 'ledger_uncertain');
  assert.equal(f.row().state, 'attempting'); assert.equal(f.posts(), 0);
  assert.equal((await f.worker().dispatch(job.sendId, render)).state, 'needs_reconciliation');
});
test('a failed receipt write after provider acceptance cannot cause another POST', async () => {
  const f = fixture(); f.store.finish = async () => { throw Error('lost acknowledgement'); };
  const result = await f.worker().dispatch(job.sendId, render);
  assert.equal(result.state, 'ledger_uncertain');
  assert.ok(result.state === 'ledger_uncertain');
  assert.deepEqual(result.outcome, { state: 'accepted', providerMessageId: id(9) });
  assert.ok(!JSON.stringify(result).includes(text));
  assert.equal(f.posts(), 1); assert.equal(f.row().state, 'attempting');
  assert.equal((await f.worker().dispatch(job.sendId, render)).state, 'needs_reconciliation'); assert.equal(f.posts(), 1);
});
test('POST exception becomes a durable unknown and cannot be retried', async () => {
  const f = fixture();
  const worker = new ChannexMessageWorker({ store: f.store, enabled: true, transport: {
    sendText: async (_, claim) => { await claim(job); throw Error('provider timeout'); }, verifyReceipt: async () => ({ state: 'unconfirmed' }),
  } });
  assert.equal((await worker.dispatch(job.sendId, render)).state, 'unknown');
  assert.equal(f.row().state, 'unknown'); assert.equal((await worker.reconcile(job.sendId)).state, 'needs_reconciliation');
  assert.equal((await worker.dispatch(job.sendId, render)).state, 'needs_reconciliation');
});
test('a mismatched transport scope never claims, even if the thread preflight passes', async () => {
  const f = fixture(); let claims = 0; f.store.claim = async () => { claims++; return true; };
  const worker = new ChannexMessageWorker({ store: f.store, enabled: true, transport: {
    sendText: async (_, claim) => { assert.equal(await claim({ ...job, environment: 'production' }), false); return { state: 'not_sent', reason: 'dispatch_not_authorized' }; },
    verifyReceipt: async () => ({ state: 'unconfirmed' }),
  } });
  assert.equal((await worker.dispatch(job.sendId, render)).state, 'blocked'); assert.equal(claims, 0);
});
test('unconfirmed readback leaves acceptance intact; no resend or delivered claim', async () => {
  const f = fixture(); await f.worker().dispatch(job.sendId, render);
  const worker = new ChannexMessageWorker({ store: f.store, transport: { sendText: f.client.sendText.bind(f.client), verifyReceipt: async () => ({ state: 'unconfirmed' }) } });
  assert.equal((await worker.reconcile(job.sendId)).state, 'unconfirmed'); assert.equal(f.row().state, 'accepted'); assert.equal(f.posts(), 1);
});
test('RPC store enforces response shape and strips unexpected fields', async () => {
  const store = createChannexJobStore(async () => ({ data: { ...job, privateBody: text }, error: null }));
  assert.deepEqual(await store.read(job.sendId), job);
  for (const bad of [{ ...job, state: 'unknown' }, { ...job, state: 'accepted', attemptId: id(6) }, { ...job, propertyId: '../bad' }, { ...job, bodySha256: '' }]) {
    await assert.rejects(createChannexJobStore(async () => ({ data: bad, error: null })).read(job.sendId), /Invalid/);
  }
});
test('RPC adapter passes exact claim/result identities once and rejects ambiguous acknowledgements', async () => {
  const calls: unknown[] = [];
  const store = createChannexJobStore(async (name, args) => { calls.push({ name, args }); return { data: true, error: null }; });
  const attempt = { environment: job.environment, propertyId: job.propertyId, channelId: job.channelId, provider: job.provider,
    bookingId: job.bookingId, threadId: job.threadId, bodySha256: job.bodySha256 };
  assert.equal(await store.claim(job.sendId, id(6), attempt), true);
  assert.equal(await store.finish(job.sendId, id(6), { state: 'accepted', providerMessageId: id(9) }), true);
  assert.deepEqual(calls, [
    { name: 'automation_channex_claim', args: { p_send_id: job.sendId, p_attempt_id: id(6), p_attempt: attempt } },
    { name: 'automation_channex_finish', args: { p_send_id: job.sendId, p_attempt_id: id(6), p_state: 'accepted', p_provider_id: id(9), p_rejection_status: null } },
  ]);
  for (const result of [{ data: null, error: null }, { data: 'true', error: null }, { data: true, error: 'private details' }]) {
    let count = 0;
    const ambiguous = createChannexJobStore(async () => { count++; return result; });
    await assert.rejects(ambiguous.claim(job.sendId, id(6), attempt)); assert.equal(count, 1);
  }
});
