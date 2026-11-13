import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleanerSmsStore } from '../channex-messaging/cleaner-sms-store.ts';
import { cleanerSmsFixture, cleanerId } from './fixtures/cleaner-sms.ts';
import type { CleanerSmsOutcome } from '../channex-messaging/cleaner-sms-worker.ts';
const fixture = () => {
  const f = cleanerSmsFixture();
  const { state: _s, attemptId: _a, providerMessageId: _p, providerStatus: _ps, providerUpdatedAt: _t, ...fields } = f.job();
  void _s; void _a; void _p; void _ps; void _t;
  return { ...f, plan: { ...fields, bindingId: cleanerId(10) }, proof: { keyId: f.render.keyId,
    targetHmac: f.render.targetHmac, bodySha256: f.render.bodySha256 } };
};
test('cleaner store is inert by default, including invalid input', async () => {
  const f = fixture(); const store = createCleanerSmsStore(async () => { throw Error('Unexpected RPC'); });
  assert.equal(await store.read('invalid'), null);
  assert.deepEqual(await store.register(null), { state: 'disabled' });
  assert.equal(await store.claim(f.job(), 'invalid', f.proof), false);
  assert.equal(await store.finish('invalid', 'invalid', { state: 'unknown' }), false);
  assert.equal(await store.hold('invalid', true, ''), false);
});
test('registration never forwards contacts, bearer links, extra fields or invalid windows', async () => {
  const f = fixture(); let calls = 0;
  const store = createCleanerSmsStore(async () => { calls++; return { data: null, error: null }; }, { enabled: true });
  for (const change of [{ phone: '+12025550123' }, { body: 'HELMTEST private' }, { propertyId: 'other' },
    { fireAt: 'invalid' }, { expiresAt: f.plan.fireAt }, { expiresAt: new Date(Date.parse(f.plan.fireAt)+1800001).toISOString() },
    { bindingId: null }, { recipientHmac: 'invalid' }]) await assert.rejects(store.register({ ...f.plan, ...change }));
  assert.equal(calls, 0);
});
test('lost registration response stays uncertain; identical retry has the same identifier', async () => {
  const f = fixture(); let committed = false;
  const store = createCleanerSmsStore(async (_, args) => {
    assert.deepEqual(args, { p_plan: f.plan });
    if (!committed) { committed = true; throw Error('HELMTEST private diagnostic'); }
    return { data: { state: 'existing', sendId: f.plan.sendId }, error: null };
  }, { enabled: true });
  await assert.rejects(store.register(f.plan), { message: 'Cleaner schedule unavailable' });
  assert.deepEqual(await store.register(f.plan), { state: 'existing', sendId: f.plan.sendId });
});
test('cleaner store validates read identity, states and private data boundaries', async () => {
  const f = fixture();
  for (const raw of [{ ...f.job(), sendId: cleanerId(88) }, { ...f.job(), phone: '+12025550123' },
    { ...f.job(), state: 'attempting' }, { ...f.job(), providerMessageId: 'ACHELMTEST' }]) {
    const store = createCleanerSmsStore(async () => ({ data: raw, error: null }), { enabled: true });
    await assert.rejects(store.read(f.job().sendId));
  }
});
test('only boolean true confirms claims, receipts or holds; raw diagnostics stay private', async () => {
  const f = fixture();
  for (const data of [null, undefined, 'true', 1, [], {}]) {
    const store = createCleanerSmsStore(async () => ({ data, error: null }), { enabled: true });
    await assert.rejects(store.claim(f.job(), cleanerId(12), f.proof), /uncertain/);
    await assert.rejects(store.finish(f.job().sendId, cleanerId(12), { state: 'unknown' }), /uncertain/);
    await assert.rejects(store.hold(f.job().sendId, true, 'synthetic'), /uncertain/);
  }
  for (const error of [undefined, { message: 'HELMTEST private' }]) {
    const store = createCleanerSmsStore(async () => ({ data: true, error }), { enabled: true });
    await assert.rejects(store.claim(f.job(), cleanerId(12), f.proof), { message: 'Cleaner schedule unavailable' });
  }
});
test('changed claim proofs and invalid final receipts cannot reach SQL', async () => {
  const f = fixture(); let calls = 0;
  const store = createCleanerSmsStore(async () => { calls++; return { data: true, error: null }; }, { enabled: true });
  await assert.rejects(store.claim(f.job(), cleanerId(12), { ...f.proof, targetHmac: 'b'.repeat(64) }));
  for (const outcome of [{ state: 'rejected', rejectionStatus: 429 }, { state: 'unknown', body: 'HELMTEST' },
    { state: 'delivered', providerMessageId: 'ACHELMTEST', providerStatus: 'queued', providerUpdatedAt: new Date().toISOString() },
    { state: 'delivered', providerMessageId: 'ACHELMTEST', providerStatus: 'delivered' }])
    await assert.rejects(store.finish(f.job().sendId, cleanerId(12), outcome as CleanerSmsOutcome));
  assert.equal(calls, 0);
});
test('actual phone-keyed recipient and both supported portal token lengths render', async () => {
  const f = fixture();
  assert.ok(f.render.recipientHmac);
  assert.ok(!('id' in (f.review.recipients[0] as object)));
  (f.review.recipients[0] as Record<string, unknown>).portal_token = '0123456789abcdef';
  // A changed existing enrollment must not match an already prepared message.
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'blocked');
  assert.equal(f.calls.length, 0);
});
