import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannexAvailabilityClient, type AvailabilityRoute } from '../channex-staging/availability-client.ts';
import { deliverBookingInventoryOnce } from '../channex-staging/booking-inventory-delivery.ts';
import { consumeBookingInventory, type BookingInventoryState, type BookingInventoryConsumerStore } from '../channex-staging/booking-inventory-consumer.ts';
import { emptyInventoryJournal, replayInventoryJournal, recordInventoryCommand } from '../channex-staging/inventory-journal.ts';
import { prepareInventoryDispatch } from '../channex-staging/inventory-worker.ts';
import { bookingInventoryDispatchContext } from '../channex-staging/booking-inventory-consumer.ts';
import { inventoryDigest, type InventoryJob } from '../channex-staging/inventory-outbox.ts';
const NOW = Date.parse('2027-01-01T15:00:00Z');
const propertyId = '11111111-1111-4111-8111-111111111111', roomTypeId = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const route: AvailabilityRoute = { environment: 'staging', helmProperty: 'fixture', connection: 'test', generation: 1,
  propertyId, roomTypeId, propertyTitle: 'Fictional - Isolated Staging' };
const json = (v: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(v), { status, headers });
async function fixture() {
  let now = NOW, failAppend = '', afterRead = () => {}, afterPost = () => {};
  const state: BookingInventoryState = { property: 'fixture', captureEnabled: true, captureVersion: 1, configurationVersion: 1,
    configuration: { environment: 'staging', topology: 'single-unit', connection: 'test', listing: roomTypeId, generation: 1,
      publishEnabled: true, timeZone: 'America/New_York', start: '2027-01-02', end: '2027-01-04', requiredSources: ['canonical'],
      coverage: [{ source: 'canonical', start: '2027-01-02', end: '2027-01-04', complete: true, observedAt: now - 1, freshUntil: now + 100000 }] },
    plannedCaptureVersion: 0, plannedConfigurationVersion: 0, planVersion: 0, journalVersion: 0, journal: emptyInventoryJournal(),
    lastDigest: null, plannedFreshUntil: 0, inputsMatchPlan: false,
    inputs: { authority: 'helm', bookings: [], rateDays: [{ date: '2027-01-03', closed: true }], periods: [],
      plan: { advance_notice_hours: 24, booking_window_days: 365, turnover_buffer_days: 0, checkin_time: '16:00' } } };
  const job = () => replayInventoryJournal(state.journal).queue.list().at(-1)!;
  const store: BookingInventoryConsumerStore = { property: 'fixture', read: async () => structuredClone(state),
    commit: async (e, j, f, d) => {
      if (e.journalVersion !== state.journalVersion) return false;
      state.journal = structuredClone(j); state.journalVersion++; state.planVersion++;
      state.plannedCaptureVersion = state.captureVersion; state.plannedConfigurationVersion = state.configurationVersion;
      state.plannedFreshUntil = f; state.lastDigest = d; state.inputsMatchPlan = true; return true;
    }, journal: { read: async () => ({ version: state.journalVersion, journal: structuredClone(state.journal) }),
      append: async (v, j) => {
        const cmd = j.commands.at(-1)!;
        if (failAppend === cmd.kind) throw new Error('Fictional storage failure');
        if (state.journalVersion !== v) return false;
        if (cmd.kind === 'dispatch' && state.captureVersion !== state.plannedCaptureVersion) return false;
        state.journalVersion++; state.journal = structuredClone(j);
        if (failAppend === `after-${cmd.kind}`) throw new Error('Lost save response');
        return true;
      } } };
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const counts: Record<string, unknown> = { '2027-01-02': 0, '2027-01-03': 0 };
  let response: () => Promise<Response> = async () => json({ data: [{ type: 'task', id: TASK }], meta: { message: 'Success', warnings: [] } });
  const replies = { property: { data: { id: propertyId, attributes: { title: route.propertyTitle, currency: 'USD', timezone: 'America/New_York' } } },
    room: { data: { id: roomTypeId, attributes: { count_of_rooms: 1 }, relationships: { property: { data: { id: propertyId } } } } },
    channels: { data: [] as unknown[], meta: { total: 0, page: 1, limit: 100 } } };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'https://staging.channex.io');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get('user-api-key'), 'test-secret');
    const call = { path: url.pathname, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined }; calls.push(call);
    if (call.method === 'POST') { assert.equal(job().status, 'submitting'); afterPost(); return response(); }
    if (url.pathname.includes('/properties/')) return json(replies.property);
    if (url.pathname.includes('/room_types/')) return json(replies.room);
    if (url.pathname.endsWith('/channels')) return json(replies.channels);
    assert.equal(url.pathname, '/api/v1/availability');
    assert.equal(url.searchParams.get('filter[property_id]'), propertyId);
    const result = json({ data: { [roomTypeId]: { ...counts } } }); afterRead(); return result;
  };
  const clock = () => now, client = new ChannexAvailabilityClient('test-secret', route, fetcher, clock);
  await consumeBookingInventory(store, clock);
  return { state, store, calls, counts, replies, client, job, clock,
    run: () => deliverBookingInventoryOnce(store, client, job().id, clock),
    setResponse: (fn: () => Promise<Response>) => { response = fn; },
    fail: (kind: string) => { failAppend = kind; }, advance: (ms: number) => { now += ms; },
    afterRead: (fn: () => void) => { afterRead = fn; }, afterPost: (fn: () => void) => { afterPost = fn; } };
}
test('delivery saves submitting before one changed-date POST and durably records its task', async () => {
  const f = await fixture(); assert.equal((await f.run()).status, 'submitted');
  const posts = f.calls.filter(c => c.method === 'POST'); assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, { values: [{ property_id: propertyId, room_type_id: roomTypeId, date: '2027-01-02', availability: 1 }] });
  assert.doesNotMatch(JSON.stringify(posts), /stop_sell|rate_plan|rate|min_stay/);
  assert.equal(f.job().task, TASK); assert.equal((await f.run()).status, 'blocked'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('matching room counts cause no POST or false completion', async () => {
  const f = await fixture(); f.counts['2027-01-02'] = 1;
  assert.equal((await f.run()).status, 'already-matches'); assert.equal(f.job().status, 'pending');
  assert.equal(f.state.journalVersion, 1); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
});
test('fresh read-back remains observation, never task settlement or OTA confirmation', async () => {
  const f = await fixture(); await f.run(); f.counts['2027-01-02'] = 1;
  assert.deepEqual(await f.client.observe(f.job()), { complete: true, matches: true, observedAt: NOW, settled: false, canVerify: false });
  delete f.counts['2027-01-03']; assert.equal((await f.client.observe(f.job())).complete, false); assert.equal(f.job().status, 'submitted');
});
test('missing coverage, Guesty authority and disabled publishing stop before provider access', async () => {
  for (const mutate of [(s: BookingInventoryState) => { s.inputs.authority = 'guesty'; },
    (s: BookingInventoryState) => { s.configuration.publishEnabled = false; },
    (s: BookingInventoryState) => { s.configuration.coverage = []; }]) {
    const f = await fixture(); mutate(f.state); assert.equal((await f.run()).status, 'blocked'); assert.equal(f.calls.length, 0);
  }
});
test('route mismatch, connected channel, changed room/property and incomplete read-back cannot submit', async () => {
  for (const mutate of [(f: Awaited<ReturnType<typeof fixture>>) => { f.state.configuration.listing = propertyId; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.channels.meta.total = 1; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.channels.data = [{}]; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.room.data.relationships.property.data.id = roomTypeId; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.room.data.attributes.count_of_rooms = 2; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.property.data.attributes.title = 'Live home'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { delete f.counts['2027-01-03']; }]) {
    const f = await fixture(); mutate(f); await assert.rejects(f.run); assert.equal(f.job().status, 'pending');
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  }
});
test('invalid endpoint configuration and extra fields fail before IO', () => {
  assert.throws(() => new ChannexAvailabilityClient('', route));
  assert.throws(() => new ChannexAvailabilityClient('test', { ...route, environment: 'production' } as unknown as AvailabilityRoute));
  assert.throws(() => new ChannexAvailabilityClient('test', { ...route, baseUrl: 'https://app.channex.io' } as AvailabilityRoute));
});
test('source change during preflight refuses dispatch and no POST follows a failed submitting save', async () => {
  const f = await fixture(); f.afterRead(() => { f.state.captureVersion++; });
  await assert.rejects(f.run); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  for (const kind of ['dispatch', 'after-dispatch']) {
    const x = await fixture(); x.fail(kind); await assert.rejects(x.run);
    assert.equal(x.calls.filter(c => c.method === 'POST').length, 0);
    if (kind === 'after-dispatch') { x.fail(''); assert.equal((await x.run()).status, 'blocked'); }
  }
});
test('timeouts, 5xx, malformed successes, warnings and missing tasks are uncertain with no automatic resend', async () => {
  for (const response of [async () => { throw new Error('test-secret'); }, async () => json({}, 503),
    async () => new Response('not JSON'), async () => json({ meta: { message: 'Success', warnings: [] }, data: [] }),
    async () => json({ meta: { message: 'Success', warnings: [{}] }, data: [{ type: 'task', id: TASK }] }),
    async () => json({ meta: { message: 'Success', warnings: [] }, data: [{ type: 'task', id: TASK }, { type: 'task', id: TASK }] }),
    async () => json({ errors: { code: 'http_too_many_requests' }, data: [{ id: TASK }] }, 429)]) {
    const f = await fixture(); f.setResponse(response); assert.equal((await f.run()).status, 'uncertain');
    f.advance(120000); assert.equal((await f.run()).status, 'blocked'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  }
});
test('documented rate-limit rejection honors Retry-After and a one-minute minimum', async () => {
  for (const [header, delay] of [['120', 120000], ['1', 60000], ['nonsense', 60000], ['172800', 172800000], ['Fri, 01 Jan 2027 15:02:00 GMT', 120000]] as const) {
    const f = await fixture(); f.setResponse(async () => json({ errors: { code: 'http_too_many_requests' } }, 429, { 'Retry-After': header }));
    assert.equal((await f.run()).status, 'retry-pending'); assert.equal(f.job().nextAttemptAt, NOW + delay);
    assert.equal((await f.run()).status, 'blocked'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  }
});
test('documented credential rejection requires review and does not expose response text', async () => {
  const f = await fixture(); f.setResponse(async () => json({ errors: { code: 'unauthorized', title: 'test-secret' } }, 401));
  assert.deepEqual(await f.run(), { status: 'needs-review' }); assert.equal(f.job().status, 'needs-review');
});
test('failed or lost accepted-response save never replays the provider call after restart', async () => {
  for (const kind of ['accepted', 'after-accepted']) {
    const f = await fixture(); f.fail(kind); await assert.rejects(f.run); f.fail('');
    assert.equal((await f.run()).status, 'blocked'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
    assert.equal(f.job().status, kind === 'accepted' ? 'submitting' : 'submitted');
  }
});
test('single-use permit rejects an expired or changed prepared intent', async () => {
  const f = await fixture(), permit = await f.client.prepare(f.job()); f.advance(5000);
  const prepared = { ...f.job(), status: 'submitting', token: 'token', leaseUntil: NOW + 60000 } as InventoryJob;
  await assert.rejects(() => permit.submit(prepared), /permit/);
  const g = await fixture(), next = await g.client.prepare(g.job());
  await assert.rejects(() => next.submit({ ...prepared, digest: 'bad' }), /digest/);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
});

test('competing delivery runners can persist and submit only one attempt', async () => {
  const f = await fixture();
  const results = await Promise.all([f.run(), f.run()]);
  assert.deepEqual(results.map(r => r.status).sort(), ['blocked', 'submitted']);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1); assert.equal(f.job().attempts, 1);
});
test('a consumed transport permit cannot be invoked twice', async () => {
  const f = await fixture(), permit = await f.client.prepare(f.job());
  const prepared = await prepareInventoryDispatch(f.store.journal, f.job().id, f.clock, 60000,
    j => bookingInventoryDispatchContext(f.store, j, f.clock));
  assert.ok(prepared); assert.equal((await permit.submit(prepared)).status, 'accepted');
  await assert.rejects(() => permit.submit(prepared), /permit/); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('expiry during the submitting save cannot lead to a stale provider POST', async () => {
  const f = await fixture(), append = f.store.journal.append;
  f.store.journal.append = async (v, j) => { const ok = await append(v, j); if (j.commands.at(-1)?.kind === 'dispatch') f.advance(60000); return ok; };
  await assert.rejects(f.run, /expired/); assert.equal(f.job().status, 'submitting'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
});
test('invalid payloads and nonconsecutive windows fail before provider IO even with a matching digest', async () => {
  const f = await fixture();
  for (const days of [
    [{ ...f.job().days[0], available: 2 }], [{ ...f.job().days[0], stopSell: true }],
    [{ ...f.job().days[0], rate: 100 }], [{ ...f.job().days[0], date: '2027-02-30' }],
    [f.job().days[0], { ...f.job().days[1], date: '2027-01-05' }],
  ]) {
    const bad = days as InventoryJob['days'];
    await assert.rejects(() => f.client.prepare({ ...f.job(), days: bad, digest: inventoryDigest(bad) }));
  }
  assert.equal(f.calls.length, 0);
});
test('an expired lease that never submitted can recover, while a submitting attempt cannot', async () => {
  const f = await fixture();
  await recordInventoryCommand(f.store.journal, { kind: 'claim', id: f.job().id, now: NOW, leaseMs: 2000 });
  assert.equal((await f.run()).status, 'blocked'); assert.equal(f.calls.length, 0);
  f.advance(2001); assert.equal((await f.run()).status, 'submitted'); assert.equal(f.job().attempts, 1);
});
test('property pacing survives a new runner and blocks a second write within six seconds', async () => {
  const f = await fixture(); await f.run(); const old = f.job();
  // Synthetic terminal evidence only; the HTTP adapter never manufactures this.
  await recordInventoryCommand(f.store.journal, { kind: 'reconcile', id: old.id, token: old.token!,
    evidence: { settled: true, complete: true, digest: old.digest, generation: old.generation } });
  f.state.captureVersion++; f.state.inputs.rateDays = []; await consumeBookingInventory(f.store, f.clock);
  assert.equal((await f.run()).status, 'blocked'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  f.advance(6000); assert.equal((await f.run()).status, 'submitted'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});

test('a newer booking plan cannot bypass property-wide rate-limit backoff', async () => {
  const f = await fixture(); f.setResponse(async () => json({ errors: { code: 'http_too_many_requests' } }, 429, { 'Retry-After': '120' }));
  assert.equal((await f.run()).status, 'retry-pending');
  f.advance(6000); f.state.captureVersion++; f.state.inputs.rateDays = []; await consumeBookingInventory(f.store, f.clock);
  assert.equal(f.job().attempts, 0); assert.equal(f.job().nextAttemptAt, NOW + 6000);
  assert.equal((await f.run()).status, 'blocked'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
