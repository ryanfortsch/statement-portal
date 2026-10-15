import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createCleanerDeliveryDb } from '../calderwood-rehearsal/cleaner-delivery-db.ts';
import { runCleanerDeliveryRehearsal as run, createCleanerDeliverySimulator, type CleanerRehearsalPlan,
  type CleanerDispatchContext, type CleanerSimulation } from '../calderwood-rehearsal/cleaner-delivery-worker.ts';
import { reconcileCleanerDeliveryReceipt as receipt } from '../calderwood-rehearsal/cleaner-delivery-receipts.ts';
import type { Envelope } from '../calderwood-rehearsal/cleaner-delivery-history.ts';
const NOW = Date.parse('2030-01-10T14:00:00Z');
const KEY = Buffer.alloc(32, 7).toString('base64'); // Fictional signing key, never a provider credential.
const plan = (recipient = 'a'): CleanerRehearsalPlan => ({ messageId: 'HELMTEST-cleaner-message',
  recipientId: `HELMTEST-cleaner-${recipient}`, attemptId: `HELMTEST-attempt-${recipient}`,
  bookingRevision: 'fictional-booking-v1', contentRevision: 'fictional-template-v1', fireAt: NOW, expiresAt: NOW + 60000 });
const context = (): CleanerDispatchContext => ({ messageId: plan().messageId,
  bookingRevision: plan().bookingRevision, contentRevision: plan().contentRevision,
  status: 'confirmed', held: false, owner: 'helm', previousSenderStopped: true,
  observedAt: NOW - 1000, validUntil: NOW + 60000 });
function harness() {
  let history: Envelope = { format: 1, mode: 'cleaner-delivery-synthetic', version: 0,
    messageId: plan().messageId, recipientIds: ['HELMTEST-cleaner-a', 'HELMTEST-cleaner-b'], records: [] };
  let writes = 0, reads = 0;
  let loseVersion: number | null = null;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith('_read')) { reads++; return Response.json(history); }
    const { expected_version, next_history } = JSON.parse(String(init?.body));
    if (history.version !== expected_version) return Response.json(false);
    history = structuredClone(next_history); writes++;
    return Response.json(history.version === loseVersion ? { responseLost: true } : true);
  };
  const fresh = () => createCleanerDeliveryDb('https://jgkblfozftcvymvwhhii.supabase.co', 'synthetic', fetcher);
  return { fresh, store: fresh(), history: () => structuredClone(history), writes: () => writes, reads: () => reads,
    loseResponseAt: (version: number) => { loseVersion = version; } };
}
function worker(store: ReturnType<typeof harness>['store'], recipient = 'a', overrides: Partial<Parameters<typeof run>[0]> = {}) {
  return run({ store, plan: plan(recipient), simulation: createCleanerDeliverySimulator(),
    readContext: async () => context(), now: () => NOW, ...overrides });
}
function bodyFor(providerId: string, recipient = 'a', id = `HELMTEST-receipt-${recipient}`) {
  return { id, type: 'message.delivered', data: { object: { id: providerId, phoneNumberId: 'HELMTEST-ops-line',
    direction: 'outgoing', status: 'delivered', to: [`HELMTEST-cleaner-${recipient}`] } } };
}
function signed(body: unknown, timestamp = NOW, key = KEY) {
  const signature = `hmac;1;${timestamp};${createHmac('sha256', Buffer.from(key, 'base64')).update(`${timestamp}.${JSON.stringify(body)}`).digest('base64')}`;
  return { rawBody: JSON.stringify(body), signature, testSigningKey: KEY, now: NOW };
}
const providerFor = async (store: ReturnType<typeof harness>['store'], recipient = 'a') =>
  (await store.read()).ledger.recipients.find(r => r.recipientId === `HELMTEST-cleaner-${recipient}`)!.attempts[0].providerId!;

test('worker tracks two recipients separately, resumes acceptance and deduplicates signed delivery receipts', async () => {
  const h = harness(); let calls = 0;
  const fake = createCleanerDeliverySimulator();
  const simulation: CleanerSimulation = { mode: 'synthetic', dispatch: async p => { calls++; return fake.dispatch(p); } };
  const accepted = await worker(h.store, 'a', { simulation });
  assert.equal(accepted.status, 'accepted'); assert.equal(accepted.canSend, false);
  assert.equal((await worker(h.fresh(), 'a', { simulation })).status, 'await-delivery');
  assert.equal(calls, 1);
  const a = signed(bodyFor(await providerFor(h.store)));
  const delivered = await receipt({ store: h.fresh(), ...a });
  assert.equal(delivered.status, 'recorded');
  assert.equal(delivered.summary?.allDelivered, false);
  assert.equal((await receipt({ store: h.fresh(), ...a })).status, 'duplicate');
  assert.equal(h.history().version, 3);
  await worker(h.fresh(), 'b', { simulation });
  const complete = await receipt({ store: h.fresh(), ...signed(bodyFor(await providerFor(h.store, 'b'), 'b')) });
  assert.equal(complete.summary?.allDelivered, true); assert.equal(complete.canSend, false);
  assert.equal((await worker(h.fresh(), 'a', { simulation })).status, 'delivered'); assert.equal(calls, 2);
});

test('competing workers invoke the simulator only for the committed claim', async () => {
  const h = harness(); let calls = 0;
  const simulation: CleanerSimulation = { mode: 'synthetic', dispatch: async () => { calls++; return { state: 'accepted', providerId: 'HELMTEST-provider-a' }; } };
  const results = await Promise.allSettled([worker(h.store, 'a', { simulation }), worker(h.fresh(), 'a', { simulation })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(calls, 1); assert.equal(h.history().version, 2);
});

test('missing, held, changed, stale and Guesty-owned context blocks before any claim', async () => {
  const h = harness();
  const invalid: Array<CleanerDispatchContext | null> = [null, { ...context(), held: true }, { ...context(), status: 'cancelled' },
    { ...context(), owner: 'guesty' }, { ...context(), previousSenderStopped: false },
    { ...context(), bookingRevision: 'changed' }, { ...context(), contentRevision: 'changed' },
    { ...context(), messageId: 'other' }, { ...context(), validUntil: NOW }, { ...context(), observedAt: NOW + 1 }];
  const simulation: CleanerSimulation = { mode: 'synthetic', dispatch: async () => { assert.fail('must not dispatch'); } };
  for (const value of invalid) await worker(h.store, 'a', { simulation, readContext: async () => value });
  for (const now of [NOW - 1, NOW + 60000, NaN]) await worker(h.store, 'a', { simulation, now: () => now });
  assert.equal(h.writes(), 0);
});

test('a hold arriving after claim blocks dispatch and requires review before another attempt', async () => {
  const h = harness(); let reads = 0;
  const result = await worker(h.store, 'a', { readContext: async () => ({ ...context(), held: ++reads === 2 }),
    simulation: { mode: 'synthetic', dispatch: async () => { assert.fail('hold must block dispatch'); } } });
  assert.equal(result.status, 'cancelled-or-held');
  assert.equal((await worker(h.fresh())).status, 'retry-review');
  assert.equal(h.history().records[1].event.type, 'result');
});

test('death after committed claim never starts another attempt on restart', async () => {
  const h = harness(); let reads = 0;
  await assert.rejects(worker(h.store, 'a', { readContext: async () => {
    if (++reads === 2) throw Error('simulated process exit'); return context();
  } }), /process exit/);
  assert.equal(h.history().version, 1);
  assert.equal((await worker(h.fresh())).status, 'reconcile');
});

test('provider timeout stays unknown and an unbound receipt cannot guess the attempt from the recipient', async () => {
  const h = harness();
  assert.equal((await worker(h.store, 'a', { simulation: createCleanerDeliverySimulator('timeout') })).status, 'unknown');
  assert.equal((await worker(h.fresh())).status, 'reconcile');
  assert.equal((await receipt({ store: h.fresh(), ...signed(bodyFor('HELMTEST-unbound-provider')) })).status, 'unmatched-provider');
  assert.equal(h.history().version, 2);
});

test('lost commit response after provider acceptance is recovered by readback, never another dispatch', async () => {
  const h = harness(); h.loseResponseAt(2);
  await assert.rejects(worker(h.store), /uncertain/);
  assert.equal((await worker(h.fresh())).status, 'await-delivery');
  assert.equal(h.history().version, 2);
  assert.equal((await receipt({ store: h.fresh(), ...signed(bodyFor(await providerFor(h.store))) })).status, 'recorded');
});

test('unsigned, tampered, old, future and wrong-key receipts cannot read or change delivery storage', async () => {
  const h = harness(); await worker(h.store);
  const valid = signed(bodyFor(await providerFor(h.store)));
  const reads = h.reads();
  for (const invalid of [ { ...valid, signature: null }, { ...valid, rawBody: valid.rawBody.replace('delivered', 'received') },
    signed(bodyFor('HELMTEST-provider-a'), NOW - 300001), signed(bodyFor('HELMTEST-provider-a'), NOW + 300001),
    signed(bodyFor('HELMTEST-provider-a'), NOW, Buffer.alloc(32, 8).toString('base64')),
    { ...valid, now: NaN }, { ...valid, testSigningKey: '' }, { ...valid, rawBody: '{' } ]) {
    await assert.rejects(receipt({ store: h.store, ...invalid }));
  }
  assert.equal(h.reads(), reads); assert.equal(h.history().version, 2);
});

test('authenticated wrong-line, incoming, failed and mismatched-recipient receipts do not mark delivery', async () => {
  const h = harness(); await worker(h.store); const body = bodyFor(await providerFor(h.store));
  for (const patch of [{ phoneNumberId: 'HELMTEST-other-line' }, { direction: 'incoming' }, { status: 'failed' },
    { to: ['HELMTEST-cleaner-b'] }, { to: ['HELMTEST-cleaner-a', 'HELMTEST-cleaner-b'] }, { to: ['+15555550123'] }]) {
    await assert.rejects(receipt({ store: h.store, ...signed({ ...body, data: { object: { ...body.data.object, ...patch } } }) }));
  }
  assert.equal(h.history().version, 2);
});

test('concurrent duplicate receipts reconcile on replay without growing the event history twice', async () => {
  const h = harness(); await worker(h.store); const valid = signed(bodyFor(await providerFor(h.store)));
  const outcomes = await Promise.allSettled([receipt({ store: h.store, ...valid }), receipt({ store: h.fresh(), ...valid })]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await receipt({ store: h.fresh(), ...valid })).status, 'duplicate');
  assert.equal(h.history().version, 3);
});

test('malformed simulator acceptance cannot become delivery evidence', async () => {
  const h = harness();
  const result = await worker(h.store, 'a', { simulation: { mode: 'synthetic', dispatch: async () => ({ state: 'accepted', providerId: 'real-looking-id' }) } });
  assert.equal(result.status, 'unknown'); assert.equal((await worker(h.fresh())).status, 'reconcile');
});

test('uncertain claim commit never invokes the simulator, even when the claim was saved', async () => {
  const h = harness(); h.loseResponseAt(1);
  const simulation: CleanerSimulation = { mode: 'synthetic', dispatch: async () => { assert.fail('uncertain claim cannot dispatch'); } };
  await assert.rejects(worker(h.store, 'a', { simulation }), /uncertain/);
  assert.equal((await worker(h.fresh(), 'a', { simulation })).status, 'reconcile');
  assert.equal(h.history().version, 1);
});

test('a receipt arriving before acceptance is unmatched until replay after the provider ID is saved', async () => {
  const h = harness(); const incoming = signed(bodyFor('HELMTEST-early-provider'));
  await worker(h.store, 'a', { simulation: { mode: 'synthetic', dispatch: async () => {
    assert.equal((await receipt({ store: h.fresh(), ...incoming })).status, 'unmatched-provider');
    return { state: 'accepted', providerId: 'HELMTEST-early-provider' };
  } } });
  assert.equal((await receipt({ store: h.fresh(), ...incoming })).status, 'recorded');
  assert.equal(h.history().version, 3);
});

test('one authenticated receipt ID cannot be reused to mark a different recipient delivered', async () => {
  const h = harness(); await worker(h.store); await worker(h.store, 'b');
  await receipt({ store: h.store, ...signed(bodyFor(await providerFor(h.store))) });
  await assert.rejects(receipt({ store: h.fresh(), ...signed(bodyFor(await providerFor(h.store, 'b'), 'b', 'HELMTEST-receipt-a')) }), /Conflicting/);
  assert.equal((await h.store.read()).ledger.recipients[1].attempts[0].state, 'accepted');
});
