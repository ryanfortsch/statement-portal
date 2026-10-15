import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleanerDeliveryDb } from '../calderwood-rehearsal/cleaner-delivery-db.ts';
import type { DeliveryRecord } from '../calderwood-rehearsal/cleaner-delivery-history.ts';
const url = 'https://jgkblfozftcvymvwhhii.supabase.co';
const initial = () => ({ format: 1, mode: 'cleaner-delivery-synthetic', version: 0, messageId: 'HELMTEST-cleaner-message', recipientIds: ['HELMTEST-cleaner-a', 'HELMTEST-cleaner-b'], records: [] as DeliveryRecord[] });
const claim: DeliveryRecord = { id: 'claim', event: { type: 'start', recipientId: 'HELMTEST-cleaner-a', attemptId: 'attempt-a' } };
test('database adapter refuses other hosts, missing data and wrong fixture identities', async () => {
  assert.throws(() => createCleanerDeliveryDb('https://production.example', 'synthetic'));
  assert.throws(() => createCleanerDeliveryDb(url, ' '));
  for (const data of [null, { ...initial(), messageId: 'other' }, { ...initial(), version: 1 }, { ...initial(), recipientIds: ['other'] }]) {
    const store = createCleanerDeliveryDb(url, 'synthetic', async () => Response.json(data));
    await assert.rejects(store.read());
  }
});
test('fresh adapter resumes committed claim and cannot create another in-flight attempt', async () => {
  let history = initial(); let writes = 0;
  const transport: typeof fetch = async (input, init) => {
    assert.ok(String(input).startsWith(url + '/rest/v1/rpc/helm_pilot_cleaner_delivery_'));
    if (String(input).endsWith('_read')) return Response.json(history);
    const payload = JSON.parse(String(init?.body)); writes++;
    assert.equal(payload.expected_version, history.version);
    history = payload.next_history; return Response.json(true);
  };
  const a = createCleanerDeliveryDb(url, 'synthetic', transport);
  const saved = await a.append(0, claim);
  assert.equal(saved.canSend, false);
  const b = createCleanerDeliveryDb(url, 'synthetic', transport);
  assert.deepEqual(await b.read(), saved.state);
  assert.equal((await b.append(1, claim)).appended, false);
  await assert.rejects(b.append(1, { id: 'retry', event: { ...claim.event, attemptId: 'second' } }), /Reconcile/);
  assert.equal(writes, 1);
});
test('uncertain commit response is not retried and readback reveals the committed attempt', async () => {
  let history = initial(); let writes = 0;
  const store = createCleanerDeliveryDb(url, 'synthetic', async (input, init) => {
    if (String(input).endsWith('_read')) return Response.json(history);
    writes++; history = JSON.parse(String(init?.body)).next_history;
    return Response.json({ unexpected: true });
  });
  await assert.rejects(store.append(0, claim), /uncertain/);
  assert.equal(writes, 1);
  assert.equal((await store.read()).ledger.recipients[0].attempts[0].state, 'sending');
  await assert.rejects(store.append(0, claim), /version changed/);
  assert.equal(writes, 1);
});
test('competing snapshot rejection and malformed evidence fail closed', async () => {
  const store = createCleanerDeliveryDb(url, 'synthetic', async input => Response.json(String(input).endsWith('_read') ? initial() : false));
  await assert.rejects(store.append(0, claim), /version changed/);
  await assert.rejects(store.append(0, { id: 'bad', event: { ...claim.event, type: 'result', state: 'delivered' } }), /no matching attempt/);
});
