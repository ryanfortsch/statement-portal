import test from 'node:test';
import assert from 'node:assert/strict';
import { sendReviewedRetryOnce, checkReviewedRetry, type RetryRecord, type RetrySnapshot, type ReviewedRetryStore } from '../channex-staging/inventory-reviewed-retry.ts';
import { ChannexAvailabilityClient } from '../channex-staging/availability-client.ts';
import { createAvailabilityRequest } from '../channex-staging/availability-request.ts';
import { inventoryDigest } from '../channex-staging/inventory-outbox.ts';
import { replayInventoryJournal, type InventoryJournal } from '../channex-staging/inventory-journal.ts';
const NOW = Date.parse('2027-01-01T15:00:00Z');
const propertyId = '11111111-1111-4111-8111-111111111111', roomTypeId = '22222222-2222-4222-8222-222222222222';
const task = '33333333-3333-4333-8333-333333333333';
function fixture() {
  let now = NOW, posts = 0, loss = '', outcome = 'accepted', count = 0;
  let afterPrepare = () => {};
  const days = [{ date: '2027-10-29', available: 1 as const, stopSell: false }];
  const intent = { id: 'original', environment: 'staging' as const, connection: 'fixture', property: 'fixture', generation: 1, version: 1, days };
  const request = createAvailabilityRequest([{ property_id: propertyId, room_type_id: roomTypeId, date: days[0].date, availability: 1 }], NOW - 60000);
  const journal: InventoryJournal = { format: 1, commands: [
    { kind: 'enqueue', intent, now: NOW - 60000 },
    { kind: 'claim', id: intent.id, now: NOW - 60000, leaseMs: 30000 },
    { kind: 'dispatch', id: intent.id, token: 'original:1', now: NOW - 60000, request,
      context: { environment: 'staging', connection: 'fixture', property: 'fixture', generation: 1, version: 1,
        digest: inventoryDigest(days), authority: 'helm', enabled: true, complete: true, freshUntil: NOW } },
    { kind: 'expire', now: NOW },
  ] };
  const state: RetrySnapshot = { revision: 0, journal, records: [], current: { authority: 'helm', complete: true,
    freshUntil: NOW + 60000, workerPaused: true, generation: 1, connection: 'fixture', property: 'fixture',
    propertyId, roomTypeId, date: days[0].date, available: 1 } };
  const history: RetryRecord[] = [];
  const store: ReviewedRetryStore = {
    read: async () => structuredClone(state),
    reserve: async (expected, record, time) => {
      if (loss === 'before-reserve') throw Error('storage unavailable');
      if (JSON.stringify(expected) !== JSON.stringify(state) || !state.current.workerPaused || time >= state.current.freshUntil ||
          state.records.some(r => r.originalId === record.originalId && r.originalToken === record.originalToken)) return false;
      state.records.push(structuredClone(record)); state.revision++; history.push(structuredClone(record));
      if (loss === 'after-reserve') throw Error('response lost');
      if (loss === 'expiry') now += 60000;
      return true;
    },
    update: async (expected, record) => {
      if (loss === 'outcome') throw Error('outcome response lost');
      if (expected.revision !== state.revision) return false;
      state.records = state.records.map(r => r.id === record.id ? structuredClone(record) : r);
      history.push(structuredClone(record)); state.revision++; return true;
    },
  };
  const route = { environment: 'staging' as const, helmProperty: 'fixture', connection: 'fixture', generation: 1,
    propertyId, roomTypeId, propertyTitle: 'Fictional - Isolated Staging' };
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  const client = new ChannexAvailabilityClient('synthetic-key', route, async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'https://staging.channex.io');
    if (init?.method === 'POST') {
      posts++; assert.equal(state.records.length, 1); assert.equal(state.records[0].outcome, 'submitting');
      assert.equal(init.body, request.body);
      if (outcome === 'timeout') throw Error('synthetic timeout');
      if (outcome === 'rejected') return json({ errors: { code: 'http_too_many_requests' } }, 429);
      count = 1; return json({ data: [{ id: task, type: 'task' }], meta: { message: 'Success' } });
    }
    if (url.pathname.includes('/properties/')) return json({ data: { id: propertyId, attributes: { title: route.propertyTitle, currency: 'USD', timezone: 'America/New_York' } } });
    if (url.pathname.includes('/room_types/')) return json({ data: { id: roomTypeId, attributes: { count_of_rooms: 1 }, relationships: { property: { data: { id: propertyId } } } } });
    if (url.pathname.endsWith('/channels')) return json({ data: [], meta: { total: 0, page: 1, limit: 100 } });
    if (url.pathname.includes('/tasks/')) return json({ data: { type: 'task', id: task, attributes: { id: task,
      task: 'Property.UpdateAvailability', success: true, errors: [], channel_events: [], received_at: new Date(now).toISOString(),
      executed_at: new Date(now).toISOString(), finished_at: new Date(now).toISOString(), payload: JSON.parse(request.body) } } });
    assert.equal(url.pathname, '/api/v1/availability');
    afterPrepare(); return json({ data: { [roomTypeId]: { [days[0].date]: count } } });
  }, () => now);
  const review = { originalId: 'original', originalToken: 'original:1', requestDigest: request.digest,
    reviewedBy: 'reviewer@example.invalid', reason: 'Explicit isolated test recovery', reviewedAt: NOW, expiresAt: NOW + 60000 };
  return { state, store, client, review, history, journalBefore: JSON.stringify(journal),
    run: () => sendReviewedRetryOnce(store, client, review, () => now), posts: () => posts,
    loss: (v: string) => { loss = v; }, outcome: (v: string) => { outcome = v; }, count: (v: number) => { count = v; },
    afterPrepare: (fn: () => void) => { afterPrepare = fn; } };
}
test('exact-value retry has distinct durable audit and verifies only its own task', async () => {
  const f = fixture(); assert.equal((await f.run()).status, 'submitted');
  assert.equal(f.posts(), 1); assert.notEqual(f.state.records[0].job.id, 'original');
  assert.equal((await checkReviewedRetry(f.store, f.client, f.state.records[0].id)).status, 'verified');
  assert.deepEqual(f.history.map(r => r.outcome), ['submitting', 'submitted', 'verified']);
  assert.equal(JSON.stringify(f.state.journal), f.journalBefore);
  assert.equal(replayInventoryJournal(f.state.journal).queue.list()[0].status, 'uncertain');
  await assert.rejects(f.run(), /already has/); assert.equal(f.posts(), 1);
});
test('concurrent callers reserve only one send', async () => {
  const f = fixture(); await Promise.allSettled([f.run(), f.run(), f.run()]);
  assert.equal(f.posts(), 1); assert.equal(f.state.records.length, 1);
});
test('storage failures and post-reservation expiry cannot send', async () => {
  for (const mode of ['before-reserve', 'after-reserve', 'expiry']) {
    const f = fixture(); f.loss(mode); await assert.rejects(f.run()); assert.equal(f.posts(), 0);
    if (mode !== 'before-reserve') {
      f.loss(''); await assert.rejects(f.run()); assert.equal(f.posts(), 0);
      assert.equal(f.state.records[0].outcome, 'submitting');
    }
  }
});
test('timeout, rejection, and lost outcome save never create an automatic second send', async () => {
  for (const mode of ['timeout', 'rejected', 'outcome']) {
    const f = fixture(); mode === 'outcome' ? f.loss(mode) : f.outcome(mode);
    await f.run().catch(() => {});
    assert.equal(f.posts(), 1); f.loss(''); await assert.rejects(f.run(), /already has/);
    assert.equal(f.posts(), 1);
    assert.equal((await checkReviewedRetry(f.store, f.client, f.state.records[0].id)).status, 'blocked');
  }
});
test('changed desired value, route, source freshness, worker state, or review blocks before POST', async () => {
  const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.state.current.available = 0; }, f => { f.state.current.propertyId = roomTypeId; },
    f => { f.state.current.complete = false; }, f => { f.state.current.workerPaused = false; },
    f => { f.state.current.freshUntil = NOW; }, f => { f.state.current.generation = 2; },
    f => { f.state.current.authority = 'guesty'; }, f => { f.review.expiresAt = NOW; },
    f => { f.review.originalToken = 'wrong'; },
  ];
  for (const change of changes) { const f = fixture(); change(f); await assert.rejects(f.run()); assert.equal(f.posts(), 0); }
});
test('source changes during provider preflight block the second validation', async () => {
  const f = fixture(); f.afterPrepare(() => { f.state.current.available = 0; f.state.revision++; });
  await assert.rejects(f.run(), /desired value changed/); assert.equal(f.posts(), 0);
});
test('matching readback is not proof of original settlement', async () => {
  const f = fixture(); f.count(1);
  assert.deepEqual(await f.run(), { status: 'already-matches', originalSettled: false });
  assert.equal(f.posts(), 0); assert.equal(f.state.records.length, 0);
  assert.equal(JSON.stringify(f.state.journal), f.journalBefore);
});
