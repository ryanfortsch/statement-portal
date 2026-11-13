import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanerSmsFixture, cleanerId } from './fixtures/cleaner-sms.ts';
import { CleanerSmsWorker, renderRetainedCleanerSms } from '../channex-messaging/cleaner-sms-worker.ts';
import type { CleanerSmsStatus } from '../channex-messaging/cleaner-sms-transport.ts';

test('cleaner protocol defaults off before reads, reviews, claims and provider calls', async () => {
  const f = cleanerSmsFixture();
  const worker = new CleanerSmsWorker({ store: f.store, transport: f.transport });
  assert.equal((await worker.dispatch(f.job().sendId, f.load)).state, 'disabled');
  assert.equal((await worker.reconcile(f.job().sendId)).state, 'disabled');
  assert.deepEqual(f.counts(), { reads: 0, claims: 0, finishes: 0 }); assert.equal(f.calls.length, 0);
});
test('two cleaner workers with an atomic fake store make one POST, acceptance is not delivery', async () => {
  const f = cleanerSmsFixture();
  const results = await Promise.all([f.worker().dispatch(f.job().sendId, f.load), f.worker().dispatch(f.job().sendId, f.load)]);
  assert.equal(results.filter(r => r.state === 'accepted').length, 1);
  assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1);
  assert.equal(f.job().providerStatus, 'queued');
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'needs_reconciliation');
  for (const [status, expected] of [['queued', 'accepted'], ['sent', 'accepted'], ['delivered', 'delivered']] as const) {
    f.advance(1000); f.status(status); assert.equal((await f.worker().reconcile(f.job().sendId)).state, expected);
  }
  assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1);
  assert.equal(f.job().state, 'delivered');
});
test('cleaner advance reminder uses exact source dates and only the scoped portal URL', async () => {
  const f = cleanerSmsFixture('cleaner_reminder');
  assert.equal(f.render.fireAt, '2026-11-14T21:00:00.000Z');
  assert.match(f.render.text, /Nov 24th, 2026/); assert.match(f.render.text, /Nov 28th, 2026/);
  assert.match(f.render.text, /https:\/\/helm.risingtidestr.com\/c\/[a-f0-9]{32}\/stays/);
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'accepted');
});
test('missing original confirmation does not prevent the independent cleaner arrival clock', () => {
  const f = cleanerSmsFixture(); assert.equal(f.review.clocks.confirmedAt, null);
  assert.equal(f.render.fireAt, '2026-11-24T14:00:00.000Z');
});
test('DST disagreement, omitted arrival override and changed hardcoded arrival wording stop SMS', () => {
  for (const patch of [{ start: '2026-11-02', end: '2026-11-08' }, { plannedArrival: undefined }, { defaultArrival: '15:00' }]) {
    const f = cleanerSmsFixture(patch.start ? 'cleaner_reminder' : 'cleaner_arrival');
    Object.assign(f.review.clocks, patch);
    assert.throws(() => renderRetainedCleanerSms(f.review, f.transport, f.now()));
  }
});
test('recipient revocation, rotation, region, language and extra coverage block before claim', async () => {
  const mutations = [
    (r: Record<string, unknown>) => { r.enabled = false; },
    (r: Record<string, unknown>) => { r.portal_token = 'f'.repeat(32); },
    (r: Record<string, unknown>) => { r.phone = '+12025550124'; },
    (r: Record<string, unknown>) => { r.region = 'cape_ann'; },
    (r: Record<string, unknown>) => { r.language = 'pt'; },
    (r: Record<string, unknown>) => { r.property_ids = ['65_calderwood', 'another']; },
  ];
  for (const mutate of mutations) {
    const f = cleanerSmsFixture(); let reviews = 0;
    const result = await f.worker().dispatch(f.job().sendId, async () => {
      const r = structuredClone(f.review); if (++reviews === 2) mutate(r.recipients[0] as Record<string, unknown>); return r;
    });
    assert.equal(result.state, 'blocked'); assert.equal(f.counts().claims, 0); assert.equal(f.calls.length, 0);
  }
  const f = cleanerSmsFixture();
  f.review.recipients = [...f.review.recipients, { ...(f.review.recipients[0] as object), phone: '+12025550124', property_ids: [] }];
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'blocked');
});
test('body, booking context, immutable due time and rule identity must still match', async () => {
  for (const patch of [{ contextRevision: 'b'.repeat(32) }, { bodySha256: 'b'.repeat(64) },
    { fireAt: '2026-11-24T13:59:00Z' }, { automationId: cleanerId(99) }]) {
    const f = cleanerSmsFixture(); f.changeJob(patch);
    assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'blocked');
    assert.equal(f.counts().claims, 0); assert.equal(f.calls.length, 0);
  }
});
test('future, expired, overlong windows and malformed jobs make no provider request', async () => {
  for (const delta of [-1, 1800000]) {
    const f = cleanerSmsFixture(); f.advance(delta);
    assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'blocked'); assert.equal(f.calls.length, 0);
  }
  const f = cleanerSmsFixture(); f.changeJob({ expiresAt: '2026-11-24T15:00:00Z' });
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'blocked');
  f.store.read = async () => ({ ...f.job(), body: 'unexpected private value' });
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'blocked');
});
test('lost committed claim acknowledgement never posts and is not retried', async () => {
  const f = cleanerSmsFixture(), claim = f.store.claim;
  f.store.claim = async (...args) => { await claim(...args); throw Error('HELMTEST private reply lost'); };
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'ledger_uncertain');
  assert.equal(f.job().state, 'attempting'); assert.equal(f.calls.length, 0);
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'needs_reconciliation');
});
test('claim finishes outside the freshness window: record an abort without sending', async () => {
  const f = cleanerSmsFixture(), claim = f.store.claim;
  f.store.claim = async (...args) => { const won = await claim(...args); f.advance(11000); return won; };
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'aborted');
  assert.equal(f.job().state, 'aborted'); assert.equal(f.calls.length, 0);
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'needs_reconciliation');
});
test('failed outcome persistence leaves a permanent attempt, no second POST', async () => {
  const f = cleanerSmsFixture(); f.store.finish = async () => { throw Error('HELMTEST private failure'); };
  const result = await f.worker().dispatch(f.job().sendId, f.load);
  assert.equal(result.state, 'ledger_uncertain');
  assert.ok(!JSON.stringify(result).includes('2025550123')); assert.ok(!JSON.stringify(result).includes('HELMTEST arrival'));
  assert.ok(!JSON.stringify(result).includes('0123456789abcdef'));
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'needs_reconciliation'); assert.equal(f.calls.length, 1);
});
test('uncertain provider acceptance and explicit refusal are saved without opening a retry path', async () => {
  for (const [failure, expected] of [['response_lost', 'unknown'], ['rejected', 'rejected']] as const) {
    const f = cleanerSmsFixture('cleaner_arrival', failure);
    assert.deepEqual(await f.worker().dispatch(f.job().sendId, f.load), { state: expected });
    assert.equal(f.job().state, expected); assert.ok(f.job().attemptId); assert.equal(f.job().providerMessageId, null);
    assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'needs_reconciliation');
    assert.equal((await f.worker().reconcile(f.job().sendId)).state, 'needs_reconciliation');
    assert.equal(f.calls.length, 1); assert.equal(f.counts().finishes, 1);
  }
});
test('receipt verification survives recipient revocation and never renders or sends again', async () => {
  const f = cleanerSmsFixture(); await f.worker().dispatch(f.job().sendId, f.load);
  f.review.recipients = []; f.advance(1000); f.status('delivered');
  assert.equal((await f.worker().reconcile(f.job().sendId)).state, 'delivered');
  assert.equal(f.calls.at(-1)?.init.method, 'GET');
  const count = f.calls.length;
  assert.equal((await f.worker().reconcile(f.job().sendId)).state, 'delivered'); assert.equal(f.calls.length, count);
});
test('undelivered is a terminal review state and never an automatic retry', async () => {
  const f = cleanerSmsFixture(); await f.worker().dispatch(f.job().sendId, f.load);
  f.status('undelivered'); assert.equal((await f.worker().reconcile(f.job().sendId)).state, 'undelivered');
  assert.equal((await f.worker().dispatch(f.job().sendId, f.load)).state, 'needs_reconciliation');
  assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1);
});
test('out-of-order status and older receipt observations cannot regress delivery history', async () => {
  const f = cleanerSmsFixture(); await f.worker().dispatch(f.job().sendId, f.load);
  f.status('sent'); f.advance(1000); await f.worker().reconcile(f.job().sendId);
  f.status('queued'); f.advance(1000);
  assert.equal((await f.worker().reconcile(f.job().sendId)).state, 'unconfirmed');
  assert.equal(f.job().providerStatus, 'sent');
  f.status('delivered'); f.advance(-2000);
  assert.equal((await f.worker().reconcile(f.job().sendId)).state, 'unconfirmed');
});
test('already reported terminal provider status cannot flip to its opposite', async () => {
  for (const initial of ['delivered', 'undelivered'] as CleanerSmsStatus[]) {
    const f = cleanerSmsFixture(); f.status(initial); await f.worker().dispatch(f.job().sendId, f.load);
    f.status(initial === 'delivered' ? 'undelivered' : 'delivered');
    assert.equal((await f.worker().reconcile(f.job().sendId)).state, 'unconfirmed');
  }
});
