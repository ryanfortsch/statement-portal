import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChannexJobStore } from '../channex-messaging/store.ts';
import type { ChannexJob, AttemptOutcome } from '../channex-messaging/worker.ts';
import type { MessageAttempt } from '../channex-messaging/transport.ts';
const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const attempt: MessageAttempt = { environment: 'production', propertyId: '320c5cb5-91e0-46af-b9b3-a3fc20b4631e',
  channelId: id(3), provider: 'Airbnb', bookingId: id(4), threadId: id(5), bodySha256: 'a'.repeat(64) };
const job: ChannexJob = { ...attempt, sendId: id(1), contextRevision: 'a'.repeat(32), state: 'prepared', attemptId: null, providerMessageId: null };
test('production store rejects wrong scope, malformed states and incomplete receipts', async () => {
  for (const patch of [ { environment: 'staging' }, { propertyId: id(2) }, { provider: 'BookingCom' },
    { threadId: 'invalid' }, { bodySha256: null }, { contextRevision: null }, { state: 'sent' },
    { state: 'attempting' }, { attemptId: id(7) }, { providerMessageId: id(8) },
    { state: 'accepted', attemptId: id(7) }, { state: 'recorded', attemptId: id(7) } ]) {
    const store = createChannexJobStore(async () => ({ data: { ...job, ...patch }, error: null }));
    await assert.rejects(store.read(id(1)), /Invalid message ledger response/);
  }
});
test('ledger results and claim input discard unexpected sensitive fields', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const store = createChannexJobStore(async (name, args) => {
    calls.push(args); return { data: name.endsWith('read') ? { ...job, body: 'HELMTEST secret' } : true, error: null };
  });
  const result = await store.read(id(1));
  assert.deepEqual(result, job); assert.ok(Object.isFrozen(result));
  const extra = { ...attempt, body: 'HELMTEST secret' };
  assert.equal(await store.claim(id(1), id(9), extra), true);
  assert.deepEqual(calls[1].p_attempt, attempt);
  assert.ok(!JSON.stringify(calls).includes('HELMTEST secret'));
});
test('store errors never reveal raw database diagnostics', async () => {
  for (const mode of ['throw', 'error', 'bad-envelope']) {
    const store = createChannexJobStore(async () => {
      if (mode === 'throw') throw Error('HELMTEST secret connection details');
      return { data: true, error: mode === 'error' ? { message: 'HELMTEST secret' } : undefined };
    });
    await assert.rejects(store.read(id(1)), { message: 'Message ledger unavailable' });
    await assert.rejects(store.claim(id(1), id(9), attempt), { message: 'Message ledger unavailable' });
    await assert.rejects(store.finish(id(1), id(9), { state: 'unknown' }), { message: 'Message ledger unavailable' });
  }
});
test('nonboolean claim/finish replies cannot authorize sending or receipt success', async () => {
  for (const data of [null, undefined, 'true', 1, [], {}]) {
    const store = createChannexJobStore(async () => ({ data, error: null }));
    await assert.rejects(store.claim(id(1), id(9), attempt), /Uncertain message claim/);
    await assert.rejects(store.finish(id(1), id(9), { state: 'unknown' }), /Uncertain message receipt/);
  }
});
test('invalid identities, scopes and outcomes never call RPC', async () => {
  let calls = 0;
  const store = createChannexJobStore(async () => { calls++; return { data: true, error: null }; });
  await assert.rejects(store.read('invalid'));
  await assert.rejects(store.claim(id(1), 'invalid', attempt));
  for (const patch of [{ environment: 'staging' }, { propertyId: id(2) }, { provider: 'BookingCom' }, { threadId: '' }]) {
    await assert.rejects(store.claim(id(1), id(9), { ...attempt, ...patch } as MessageAttempt));
  }
  for (const outcome of [{ state: 'sent' }, { state: 'unknown', providerMessageId: id(8) },
    { state: 'unknown', status: 422 }, { state: 'rejected', status: 429 }, { state: 'accepted' },
    { state: 'recorded', providerMessageId: 'invalid' }]) {
    await assert.rejects(store.finish(id(1), id(9), outcome as AttemptOutcome));
  }
  assert.equal(calls, 0);
});
test('missing job is null; false claim/receipt stays false', async () => {
  const store = createChannexJobStore(async name => ({ data: name.endsWith('read') ? null : false, error: null }));
  assert.equal(await store.read(id(1)), null);
  assert.equal(await store.claim(id(1), id(9), attempt), false);
  assert.equal(await store.finish(id(1), id(9), { state: 'unknown' }), false);
});
