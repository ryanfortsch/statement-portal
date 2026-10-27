import { test } from 'node:test';
import { reconcileBookingInventoryOnce, runBookingInventoryCycle } from '../channex-staging/booking-inventory-cycle.ts';
import assert from 'node:assert/strict';
import { ChannexAvailabilityClient, type AvailabilityRoute } from '../channex-staging/availability-client.ts';
import { deliverBookingInventoryOnce } from '../channex-staging/booking-inventory-delivery.ts';
import { consumeBookingInventory, type BookingInventoryState, type BookingInventoryConsumerStore } from '../channex-staging/booking-inventory-consumer.ts';
import { emptyInventoryJournal, replayInventoryJournal, recordInventoryCommand, inventoryAttemptAudit } from '../channex-staging/inventory-journal.ts';
import { prepareInventoryDispatch } from '../channex-staging/inventory-worker.ts';
import { bookingInventoryDispatchContext } from '../channex-staging/booking-inventory-consumer.ts';
import { inventoryDigest, type InventoryJob } from '../channex-staging/inventory-outbox.ts';
const NOW = Date.parse('2027-01-01T15:00:00Z');
const propertyId = '11111111-1111-4111-8111-111111111111', roomTypeId = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const TASK2 = '44444444-4444-4444-8444-444444444444';
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
  const calls: { path: string; method: string; body?: unknown; rawBody?: string }[] = [];
  const counts: Record<string, unknown> = { '2027-01-02': 0, '2027-01-03': 0 };
  let response: () => Promise<Response> = async () => json({ data: [{ type: 'task', id: TASK }], meta: { message: 'Success', warnings: [] } });
  const replies = { property: { data: { id: propertyId, attributes: { title: route.propertyTitle, currency: 'USD', timezone: 'America/New_York' } } },
    room: { data: { id: roomTypeId, attributes: { count_of_rooms: 1 }, relationships: { property: { data: { id: propertyId } } } } },
    channels: { data: [] as unknown[], meta: { total: 0, page: 1, limit: 100 } },
    task: { data: { type: 'task', id: TASK, attributes: { id: TASK, task: 'Property.UpdateAvailability',
      success: true as boolean | null, errors: [] as unknown[], channel_events: [] as unknown[],
      received_at: '2027-01-01T15:00:00.000000', executed_at: '2027-01-01T15:00:00.000000' as string | null,
      finished_at: '2027-01-01T15:00:00.000000' as string | null,
      payload: { values: [{ property_id: propertyId, room_type_id: roomTypeId, date: '2027-01-02', availability: 1 }] },
      user_email: 'discard-this@example.invalid', ip_address: 'discard-this-address',
    } } } };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'https://staging.channex.io');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get('user-api-key'), 'test-secret');
    const call = { path: url.pathname, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, rawBody: init?.body ? String(init.body) : undefined }; calls.push(call);
    if (call.method === 'POST') { assert.equal(job().status, 'submitting'); assert.equal(job().request?.body, init?.body); afterPost(); return response(); }
    if (url.pathname.includes('/properties/')) return json(replies.property);
    if (url.pathname.includes('/room_types/')) return json(replies.room);
    if (url.pathname.endsWith('/channels')) return json(replies.channels);
    if (url.pathname.startsWith('/api/v1/tasks/')) return json(replies.task);
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
test('actual staging success may omit warnings but malformed or nonempty warnings stay uncertain', async () => {
  for (const meta of [{ message: 'Success' }, { message: 'Success', warnings: [] }]) {
    const f = await fixture();
    f.setResponse(async () => json({ data: [{ type: 'task', id: TASK }], meta }));
    assert.equal((await f.run()).status, 'submitted');
    assert.equal(f.job().task, TASK);
    assert.equal(f.job().status, 'submitted'); // Acceptance still does not prove completion.
    assert.equal((await f.run()).status, 'blocked');
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  }
  for (const warnings of [null, false, '', {}, ['partial']]) {
    const f = await fixture();
    f.setResponse(async () => json({ data: [{ type: 'task', id: TASK }], meta: { message: 'Success', warnings } }));
    assert.equal((await f.run()).status, 'uncertain');
    assert.equal((await f.run()).status, 'blocked');
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  }
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
  const f = await fixture(), permit = await f.client.prepare(f.job()); f.advance(30000);
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
    j => bookingInventoryDispatchContext(f.store, j, f.clock), permit.request!);
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
    evidence: { settled: true, complete: true, digest: old.digest, generation: old.generation, task: old.task, requestDigest: old.request!.digest } });
  f.state.captureVersion++; f.state.inputs.rateDays = []; await consumeBookingInventory(f.store, f.clock);
  assert.equal((await f.run()).status, 'blocked'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  f.setResponse(async () => json({ data: [{ type: 'task', id: TASK2 }], meta: { message: 'Success', warnings: [] } }));
  f.advance(6000); assert.equal((await f.run()).status, 'submitted'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});

test('a newer booking plan cannot bypass property-wide rate-limit backoff', async () => {
  const f = await fixture(); f.setResponse(async () => json({ errors: { code: 'http_too_many_requests' } }, 429, { 'Retry-After': '120' }));
  assert.equal((await f.run()).status, 'retry-pending');
  f.advance(6000); f.state.captureVersion++; f.state.inputs.rateDays = []; await consumeBookingInventory(f.store, f.clock);
  assert.equal(f.job().attempts, 0); assert.equal(f.job().nextAttemptAt, NOW + 6000);
  assert.equal((await f.run()).status, 'blocked'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});


test('exact request and its task receipt survive serialization without credentials', async () => {
  const f = await fixture(); await f.run();
  const history = JSON.parse(JSON.stringify(f.state.journal));
  const audit = inventoryAttemptAudit(history);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].request!.body, f.calls.find(c => c.method === 'POST')!.rawBody);
  assert.equal(audit[0].receipt!.task, TASK);
  assert.equal(audit[0].receipt!.binding!.requestDigest, audit[0].request!.digest);
  assert.equal(audit[0].receipt!.binding!.receivedAt, NOW);
  assert.equal(audit[0].desiredDigest, f.job().digest); assert.equal(audit[0].canVerify, false);
  assert.doesNotMatch(JSON.stringify(history), /test-secret|user-api-key|guest_name|rate_plan|min_stay/);
  audit[0].request!.body = 'changed copy';
  assert.notEqual(f.job().request!.body, 'changed copy');
});

test('request changes after prepare cannot authorize a different POST', async () => {
  for (const change of ['missing', 'body', 'digest', 'time']) {
    const f = await fixture(), permit = await f.client.prepare(f.job());
    const prepared = await prepareInventoryDispatch(f.store.journal, f.job().id, f.clock, 60000,
      j => bookingInventoryDispatchContext(f.store, j, f.clock), permit.request!);
    assert.ok(prepared);
    if (change === 'missing') delete prepared.request;
    if (change === 'body') prepared.request!.body += ' ';
    if (change === 'digest') prepared.request!.digest = '0'.repeat(64);
    if (change === 'time') { prepared.request!.preparedAt++; prepared.request!.expiresAt++; }
    await assert.rejects(() => permit.submit(prepared));
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  }
});

test('wrong request, token, timestamp or missing receipt cannot bind an accepted task', async () => {
  const f = await fixture(); f.fail('accepted'); await assert.rejects(f.run); f.fail('');
  const job = f.job(), receipt = { requestDigest: job.request!.digest, receivedAt: NOW };
  for (const change of [{ token: 'wrong' }, { receipt: undefined }, { task: 'not-a-task' },
    { receipt: { ...receipt, requestDigest: '0'.repeat(64) } }, { receipt: { ...receipt, receivedAt: NOW - 1 } }]) {
    await assert.rejects(recordInventoryCommand(f.store.journal, { kind: 'accepted', id: job.id, token: job.token!, task: TASK, receipt, ...change }));
    assert.equal(f.job().status, 'submitting');
  }
});

test('lost receipt save retains the exact request but invents no task reference', async () => {
  const f = await fixture(); f.fail('accepted'); await assert.rejects(f.run);
  const audit = inventoryAttemptAudit(f.state.journal)[0];
  assert.equal(audit.receipt, null); assert.equal(audit.outcome, 'unresolved');
  assert.equal(audit.request!.body, f.calls.find(c => c.method === 'POST')!.rawBody);
  f.fail(''); f.advance(61000); assert.equal((await f.run()).status, 'blocked');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});

test('a clean late receipt can be recorded after lease expiry without clearing uncertainty evidence', async () => {
  const f = await fixture();
  f.setResponse(async () => {
    f.advance(61000);
    await recordInventoryCommand(f.store.journal, { kind: 'expire', now: f.clock() });
    assert.equal(f.job().status, 'uncertain');
    return json({ data: [{ type: 'task', id: TASK }], meta: { message: 'Success', warnings: [] } });
  });
  assert.equal((await f.run()).status, 'submitted');
  assert.equal(inventoryAttemptAudit(f.state.journal)[0].receipt!.task, TASK);
  assert.equal((await f.run()).status, 'blocked'); assert.equal(f.job().status, 'uncertain');
});

test('retries retain each exact request and distinct attempt token', async () => {
  const f = await fixture();
  f.setResponse(async () => json({ errors: { code: 'http_too_many_requests' } }, 429));
  await f.run(); f.advance(60000);
  // Refresh a plan for the same date window; the prior rejected attempt stays auditable.
  f.state.captureVersion++; await consumeBookingInventory(f.store, f.clock);
  f.counts['2027-01-03'] = 1;
  f.setResponse(async () => json({ data: [{ type: 'task', id: TASK }], meta: { message: 'Success', warnings: [] } }));
  assert.equal((await f.run()).status, 'submitted');
  const audit = inventoryAttemptAudit(f.state.journal);
  assert.equal(audit.length, 2); assert.equal(audit[0].outcome, 'rejected'); assert.equal(audit[0].receipt, null);
  assert.notEqual(audit[0].token, audit[1].token); assert.notEqual(audit[0].request!.digest, audit[1].request!.digest);
  assert.equal(audit[1].receipt!.binding!.requestDigest, audit[1].request!.digest);
});

test('an accepted task cannot be attached to a newer attempt even after restart', async () => {
  const f = await fixture(); await f.run(); const old = f.job();
  await recordInventoryCommand(f.store.journal, { kind: 'reconcile', id: old.id, token: old.token!, evidence: {
    settled: true, complete: true, digest: old.digest, generation: old.generation, task: old.task, requestDigest: old.request!.digest } });
  f.advance(6000); f.state.captureVersion++; f.state.inputs.rateDays = []; await consumeBookingInventory(f.store, f.clock);
  await assert.rejects(f.run, /already bound/); assert.equal(f.job().status, 'submitting');
  assert.equal(inventoryAttemptAudit(f.state.journal).filter(a => a.receipt).length, 1);
  assert.equal((await f.run()).status, 'blocked');
});

test('calendar match, wrong task or wrong request digest cannot reconcile a bound attempt', async () => {
  const f = await fixture(); await f.run(); const job = f.job();
  const base = { settled: true, complete: true, digest: job.digest, generation: job.generation };
  for (const evidence of [base, { ...base, task: TASK2, requestDigest: job.request!.digest },
    { ...base, task: TASK, requestDigest: '0'.repeat(64) }]) {
    const result = await recordInventoryCommand(f.store.journal, { kind: 'reconcile', id: job.id, token: job.token!, evidence });
    assert.equal(result.saved, false); assert.equal(f.job().status, 'submitted');
  }
});


test('successful exact task is followed by full calendar read-back and durable verification', async () => {
  const f = await fixture(); await f.run(); f.counts['2027-01-02'] = 1;
  assert.equal((await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id)).status, 'verified');
  assert.equal(f.job().status, 'verified'); assert.equal(f.job().attempts, 1);
  const calls = f.calls.slice(-2).map(c => c.path);
  assert.deepEqual(calls, [`/api/v1/tasks/${TASK}`, '/api/v1/availability']);
  const journal = replayInventoryJournal(f.state.journal).journal;
  assert.deepEqual(journal.commands.at(-1), { kind: 'reconcile', id: f.job().id, token: f.job().token,
    evidence: { settled: true, complete: true, digest: f.job().digest, generation: 1, task: TASK,
      requestDigest: f.job().request!.digest,
      completion: { receivedAt: NOW, executedAt: NOW, finishedAt: NOW, observedAt: NOW } } });
  assert.doesNotMatch(JSON.stringify(journal), /discard-this|user_email|ip_address/);
  assert.equal((await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id)).status, 'blocked');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('unfinished or failed tasks cannot settle even when calendar counts match', async () => {
  for (const failed of [false, true]) {
    const f = await fixture(); await f.run(); f.counts['2027-01-02'] = 1;
    if (failed) f.replies.task.data.attributes.success = false;
    else f.replies.task.data.attributes.finished_at = null;
    const before = f.calls.length;
    assert.equal((await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id)).status, failed ? 'failed' : 'pending');
    assert.equal(f.job().status, 'submitted');
    assert.ok(!f.calls.slice(before).some(c => c.path === '/api/v1/availability'));
  }
});
test('task IDs, exact payload, type, timestamps and isolated channel scope must all match', async () => {
  const changes = [
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.id = TASK2; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.id = TASK2; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.task = 'Property.UpdateRestrictions'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.payload.values[0].availability = 0; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.payload.values[0].date = '2027-01-03'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.payload.values[0].property_id = roomTypeId; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.payload.values[0].room_type_id = propertyId; },
    (f: Awaited<ReturnType<typeof fixture>>) => { Object.assign(f.replies.task.data.attributes.payload.values[0], { rate: 100 }); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.payload.values.push(f.replies.task.data.attributes.payload.values[0]); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.received_at = '2026-12-31T15:00:00'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.finished_at = '2027-01-02T15:00:00'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.executed_at = null; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.finished_at = '2027-02-30T15:00:00'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.task.data.attributes.channel_events.push({}); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.replies.channels.data.push({}); },
  ];
  for (const change of changes) {
    const f = await fixture(); await f.run(); f.counts['2027-01-02'] = 1; change(f);
    const version = f.state.journalVersion;
    await assert.rejects(() => reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id));
    assert.equal(f.state.journalVersion, version); assert.equal(f.job().status, 'submitted');
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  }
});
test('terminal errors and incomplete read-back remain unresolved; complete mismatch requires review', async () => {
  const f = await fixture(); await f.run(); f.replies.task.data.attributes.errors.push({});
  assert.equal((await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id)).status, 'failed');
  f.replies.task.data.attributes.errors = []; delete f.counts['2027-01-03'];
  assert.equal((await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id)).status, 'incomplete');
  assert.equal(f.job().status, 'submitted'); f.counts['2027-01-03'] = 0;
  assert.equal((await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id)).status, 'needs-review');
  assert.equal(f.job().status, 'needs-review');
});
test('task evidence supports expired accepted attempts without reposting', async () => {
  const f = await fixture(); await f.run(); f.counts['2027-01-02'] = 1; f.advance(120000);
  await recordInventoryCommand(f.store.journal, {kind:'expire',now:f.clock()});
  assert.equal(f.job().status, 'uncertain');
  assert.equal((await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id)).status, 'verified');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('missing task receipts and failed completion saves never authorize another submission', async () => {
  for (const failure of ['accepted','reconcile','after-reconcile']) {
    const f = await fixture(); f.fail(failure);
    if (failure === 'accepted') {
      await assert.rejects(f.run); f.fail('');
      assert.equal((await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id)).status, 'blocked');
    } else {
      await f.run(); f.counts['2027-01-02'] = 1;
      await assert.rejects(() => reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id)); f.fail('');
      const next = await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id);
      assert.equal(next.status, failure === 'after-reconcile' ? 'blocked' : 'verified');
    }
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  }
});
test('bounded canonical cycle verifies prior work before planning a newer booking change', async () => {
  const f = await fixture();
  assert.equal((await runBookingInventoryCycle(f.store, f.client, f.clock)).status, 'submitted');
  const old = f.job().id; f.counts['2027-01-02'] = 1; f.advance(6000);
  f.state.inputs.bookings.push({ id:'synthetic-new-stay', status:'confirmed', check_in:'2027-01-02',check_out:'2027-01-03',duplicate_of:null,hold_kind:null,source:'manual',channel:'other' });
  f.state.captureVersion++; f.state.inputsMatchPlan = false;
  f.setResponse(async () => json({data:[{type:'task',id:TASK2}],meta:{message:'Success'}}));
  assert.equal((await runBookingInventoryCycle(f.store, f.client, f.clock)).status, 'submitted');
  const jobs = replayInventoryJournal(f.state.journal).queue.list();
  assert.equal(jobs.find(j => j.id === old)!.status, 'verified');
  assert.equal(f.job().days[0].available, 0); assert.equal(f.job().task, TASK2);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});
test('bounded canonical cycle waits for unresolved tasks and refuses changed routes', async () => {
  const f = await fixture(); await f.run(); f.replies.task.data.attributes.finished_at = null;
  f.state.captureVersion++; f.state.inputsMatchPlan = false;
  assert.deepEqual(await runBookingInventoryCycle(f.store, f.client, f.clock), {phase:'reconcile',status:'pending'});
  assert.equal(f.state.planVersion, 1); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  f.state.configuration.generation++;
  await assert.rejects(() => runBookingInventoryCycle(f.store, f.client, f.clock), /route mismatch/);
});

function refreshFixture(f: Awaited<ReturnType<typeof fixture>>) {
  f.store.refreshPlan = async (e, until, digest) => {
    if (e.captureVersion !== f.state.captureVersion || e.configurationVersion !== f.state.configurationVersion ||
        e.journalVersion !== f.state.journalVersion || digest !== f.state.lastDigest || until <= f.state.plannedFreshUntil) return false;
    f.state.plannedFreshUntil = until; return true;
  };
}
test('settled calendar observation and expired-plan refresh preserve the original completed task', async () => {
  const f = await fixture(); refreshFixture(f); await f.run(); f.counts['2027-01-02'] = 1;
  await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id);
  const history = structuredClone(f.state.journal), job = f.job(); f.advance(60000);
  assert.deepEqual(await runBookingInventoryCycle(f.store, f.client, f.clock), { phase: 'plan', status: 'unchanged' });
  assert.deepEqual(f.state.journal, history); assert.deepEqual(f.job(), job);
  assert.equal(f.state.plannedFreshUntil, NOW + 100000); // Still capped by the original source expiry.
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('drift after task settlement produces a new bound attempt and retains the old receipt', async () => {
  const f = await fixture(); refreshFixture(f); await f.run(); f.counts['2027-01-02'] = 1;
  await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id);
  const original = f.job(); f.advance(60000); f.counts['2027-01-02'] = 0;
  f.setResponse(async () => json({ data: [{ type: 'task', id: TASK2 }], meta: { message: 'Success' } }));
  assert.equal((await runBookingInventoryCycle(f.store, f.client, f.clock)).status, 'submitted');
  assert.equal(f.state.planVersion, 2); assert.equal(f.job().task, TASK2); assert.notEqual(f.job().id, original.id);
  assert.deepEqual(replayInventoryJournal(f.state.journal).queue.list()[0], original);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});
test('missing provider counts after settlement cannot refresh or manufacture recovery evidence', async () => {
  const f = await fixture(); refreshFixture(f); await f.run(); f.counts['2027-01-02'] = 1;
  await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id);
  const history = structuredClone(f.state.journal), until = f.state.plannedFreshUntil;
  f.advance(60000); delete f.counts['2027-01-03'];
  assert.deepEqual(await runBookingInventoryCycle(f.store, f.client, f.clock), { phase: 'observe', status: 'incomplete' });
  assert.deepEqual(f.state.journal, history); assert.equal(f.state.plannedFreshUntil, until);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('an idle refresh retains rate-limit backoff and cannot convert an uncertain attempt into pending', async () => {
  const f = await fixture(); refreshFixture(f);
  f.setResponse(async () => json({ errors: { code: 'http_too_many_requests' } }, 429, { 'Retry-After': '120' }));
  await f.run(); const original = f.job(); f.advance(60000);
  assert.equal((await runBookingInventoryCycle(f.store, f.client, f.clock)).status, 'blocked');
  assert.deepEqual(f.job(), original); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  const g = await fixture(); refreshFixture(g); g.setResponse(async () => { throw Error('Timeout'); }); await g.run();
  const history = structuredClone(g.state.journal); g.advance(60000);
  assert.deepEqual(await runBookingInventoryCycle(g.store, g.client, g.clock), { phase: 'reconcile', status: 'blocked' });
  assert.deepEqual(g.state.journal, history); assert.equal(g.calls.filter(c => c.method === 'POST').length, 1);
});

test('a changed window replans without requiring read-back of the retired window', async () => {
  const f = await fixture(); refreshFixture(f); await f.run(); f.counts['2027-01-02'] = 1;
  await reconcileBookingInventoryOnce(f.store.journal, f.client, f.job().id);
  f.advance(6000); f.state.configuration.start = '2027-01-03'; f.state.configuration.end = '2027-01-05';
  f.state.configuration.coverage[0].end = '2027-01-05'; f.state.configurationVersion++;
  delete f.counts['2027-01-02']; f.counts['2027-01-04'] = 0;
  f.setResponse(async () => json({ data: [{ type: 'task', id: TASK2 }], meta: { message: 'Success' } }));
  assert.equal((await runBookingInventoryCycle(f.store, f.client, f.clock)).status, 'submitted');
  assert.deepEqual(f.job().days.map(d => d.date), ['2027-01-03', '2027-01-04']);
  assert.equal(f.job().task, TASK2); assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});


test('500-day availability travels through durable delivery and task reconciliation in one request', async () => {
  const f = await fixture();
  const start = '2027-01-01', end = new Date(Date.parse(start)+500*86400000).toISOString().slice(0,10);
  Object.assign(f.state.configuration,{start,end}); f.state.configurationVersion++;
  for (const c of f.state.configuration.coverage) Object.assign(c,{start,end});
  assert.equal((await consumeBookingInventory(f.store,f.clock)).status,'queued');
  const desired=f.job().days;
  assert.equal(desired.length,500);
  for (const d of desired) f.counts[d.date]=d.available ? 0 : 1;
  assert.equal((await f.run()).status,'submitted');
  const posts=f.calls.filter(c=>c.method==='POST');
  assert.equal(posts.length,1);
  const payload=JSON.parse(posts[0].rawBody!) as typeof f.replies.task.data.attributes.payload;
  assert.equal(payload.values.length,500);
  assert.doesNotMatch(posts[0].rawBody!,/rate|min_stay|stop_sell/);
  f.replies.task.data.attributes.payload=payload;
  for (const d of desired) f.counts[d.date]=d.available;
  const result=await reconcileBookingInventoryOnce(f.store.journal,f.client,f.job().id);
  assert.equal(result.status,'verified');
  assert.equal(f.job().status,'verified');
});


test('durable preflight can take six seconds without expiring the exact request', async () => {
  const f = await fixture(), append = f.store.journal.append;
  f.store.journal.append = async (version, journal) => {
    const result = await append(version, journal);
    if (journal.commands.at(-1)?.kind === 'claim') f.advance(6000);
    return result;
  };
  assert.equal((await f.run()).status, 'submitted');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal((await f.run()).status, 'blocked');
});


test('preflight at the thirty-second expiry never crosses the submitting barrier', async () => {
  const f = await fixture(), append = f.store.journal.append;
  f.store.journal.append = async (version, journal) => {
    const result = await append(version, journal);
    if (journal.commands.at(-1)?.kind === 'claim') f.advance(30000);
    return result;
  };
  await assert.rejects(f.run(), /Invalid availability request binding/);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(replayInventoryJournal(f.state.journal).journal.commands.some(c => c.kind === 'dispatch'), false);
});
