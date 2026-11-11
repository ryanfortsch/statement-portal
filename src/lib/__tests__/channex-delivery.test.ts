import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createUnmappedInventoryTransport, deliverInventoryOnce, type DeliveryAttempt,
  type DeliveryOutcome, type InventoryDeliveryStore } from '../channex-inventory/delivery.ts';
import { createInventoryDeliveryStore } from '../channex-inventory/delivery-store.ts';
import { inventoryDigest } from '../channex-inventory/planner.ts';
import { CALDERWOOD_PRODUCTION as m } from '../channex-production-preflight.ts';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { shiftIsoDay } from '../sca-quotes-types.ts';
const now = Date.parse('2026-11-06T15:00:00Z'), taskId = randomUUID();
const success = { data: [{ id: taskId, type: 'task' }], meta: { message: 'Success', warnings: [] } };
function fixture(): DeliveryAttempt {
  const days = Array.from({ length: 500 }, (_, n) => ({ date: shiftIsoDay('2026-11-06', n), available: (n % 2) as 0 | 1 }));
  const requestBody = JSON.stringify({ values: days.map(d => ({ property_id: m.propertyId, room_type_id: m.roomTypeId, date: d.date, availability: d.available })) });
  return { token: randomUUID(), planVersion: 1, planId: 'a'.repeat(64), planDigest: inventoryDigest(days),
    start: days[0].date, end: shiftIsoDay(days[0].date, 500), requestBody,
    requestDigest: createHash('sha256').update(requestBody).digest('hex'), expiresAt: now + 30000, state: 'leased' };
}
function provider(post: () => Response | Promise<Response> = () => Response.json(success)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const relation = (id: string) => ({ data: { id } });
  const reads = [
    { data: { id: m.propertyId, attributes: { title: m.propertyTitle, currency: 'USD', timezone: 'America/New_York', property_type: 'holiday_home' } } },
    { data: { id: m.roomTypeId, attributes: { title: m.roomTitle, count_of_rooms: 1, occ_adults: 6, occ_children: 0, occ_infants: 0 }, relationships: { property: relation(m.propertyId) } } },
    { data: { id: m.ratePlanId, attributes: { title: m.rateTitle, currency: 'USD', sell_mode: 'per_room', rate_mode: 'manual', stop_sell: Array(7).fill(true) }, relationships: { property: relation(m.propertyId), room_type: relation(m.roomTypeId) } } },
    { data: [], meta: { total: 0, page: 1 } },
  ];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    return init?.method === 'POST' ? post() : Response.json(reads[(calls.filter(c => c.init?.method === 'GET').length - 1) % 4]);
  };
  return { fetcher, calls, reads };
}
test('transport sends exact immutable availability-only bytes once, returning acceptance only', async () => {
  const a = fixture(), expected = a.requestBody, h = provider();
  const prepared = await createUnmappedInventoryTransport('synthetic-key', h.fetcher, () => now).prepare(a);
  a.requestBody = '{"rate":999}';
  assert.deepEqual(await prepared.send(), { kind: 'accepted', taskId });
  await assert.rejects(prepared.send(), /consumed/);
  assert.equal(h.calls.length, 5); const request = h.calls[4];
  assert.equal(request.url, 'https://app.channex.io/api/v1/availability'); assert.equal(request.init?.body, expected);
  assert.equal(expected.includes('rate_plan_id'), false); assert.equal(expected.includes('stop_sell'), false);
});
test('expired leases, mutated bytes, missing dates, wrong mapping and pricing fields fail before IO', async () => {
  for (const mutate of [
    (a: DeliveryAttempt) => { a.expiresAt = now; },
    (a: DeliveryAttempt) => { a.start = shiftIsoDay(a.start, -1); a.end = shiftIsoDay(a.end, -1); },
    (a: DeliveryAttempt) => { a.requestDigest = 'b'.repeat(64); },
    (a: DeliveryAttempt) => { a.planDigest = 'b'.repeat(64); },
    (a: DeliveryAttempt) => { const b = JSON.parse(a.requestBody); b.values.pop(); a.requestBody = JSON.stringify(b); },
    (a: DeliveryAttempt) => { const b = JSON.parse(a.requestBody); b.values[0].property_id = randomUUID(); a.requestBody = JSON.stringify(b); },
    (a: DeliveryAttempt) => { const b = JSON.parse(a.requestBody); b.values[0].min_stay = 2; a.requestBody = JSON.stringify(b); },
  ]) {
    const a = fixture(), h = provider(); mutate(a);
    if (a.requestDigest !== 'b'.repeat(64)) a.requestDigest = createHash('sha256').update(a.requestBody).digest('hex');
    await assert.rejects(createUnmappedInventoryTransport('synthetic-key', h.fetcher, () => now).prepare(a));
    assert.equal(h.calls.length, 0);
  }
});
test('mapping/channel changes and a lease expiring during preflight prevent POST', async () => {
  const h = provider(); h.reads[3].meta!.total = 1;
  await assert.rejects(createUnmappedInventoryTransport('synthetic-key', h.fetcher, () => now).prepare(fixture()));
  assert.equal(h.calls.some(c => c.init?.method === 'POST'), false);
  const h2 = provider(); let clock = now;
  const p = await createUnmappedInventoryTransport('synthetic-key', h2.fetcher, () => clock).prepare(fixture());
  clock += 30000; await assert.rejects(p.send()); assert.equal(h2.calls.length, 4);
});
test('timeouts, 5xx, redirects, warnings, partial or malformed success remain uncertain with no retry', async () => {
  for (const response of [
    () => { throw Error('PRIVATE_SENTINEL'); }, () => new Response('PRIVATE_SENTINEL', { status: 500 }),
    () => new Response('', { status: 302 }), () => Response.json({ ...success, meta: { message: 'Success', warnings: [{}] } }),
    () => Response.json({ ...success, data: [] }), () => Response.json({ ...success, errors: {} }),
    () => Response.json({ ...success, data: [...success.data, ...success.data] }),
  ]) {
    const h = provider(response); const p = await createUnmappedInventoryTransport('synthetic-key', h.fetcher, () => now).prepare(fixture());
    assert.deepEqual(await p.send(), { kind: 'uncertain' }); assert.equal(h.calls.length, 5);
  }
});
test('only documented complete rejection envelopes allow a bounded retry or credential stop', async () => {
  for (const [code, status, header, expected] of [
    ['http_too_many_requests', 429, '120', { kind: 'rate-limited', retryAfterSeconds: 120 }],
    ['http_too_many_requests', 429, 'bogus', { kind: 'rate-limited', retryAfterSeconds: 60 }],
    ['http_too_many_requests', 429, new Date(now + 90000).toUTCString(), { kind: 'rate-limited', retryAfterSeconds: 90 }],
    ['http_too_many_requests', 429, '999999', { kind: 'rate-limited', retryAfterSeconds: 86400 }],
    ['unauthorized', 401, '', { kind: 'unauthorized' }],
    ['unauthorized', 500, '', { kind: 'uncertain' }],
  ] as const) {
    const h = provider(() => Response.json({ errors: { code, title: 'Error' } }, { status, headers: { 'retry-after': header } }));
    assert.deepEqual(await (await createUnmappedInventoryTransport('synthetic-key', h.fetcher, () => now).prepare(fixture())).send(), expected);
  }
});
function store(a: DeliveryAttempt) {
  let began = false; const records: DeliveryOutcome[] = [];
  const db: InventoryDeliveryStore = {
    async claim() { return { status: 'claimed', attempt: a }; },
    async begin() { if (began) return { status: 'blocked' }; began = true; return { status: 'started', expiresAt: a.expiresAt }; },
    async record(_token, _digest, outcome) { records.push(outcome); },
  };
  return { db, records };
}
test('concurrent workers with same claim token pass the durable send barrier exactly once', async () => {
  const a = fixture(), h = store(a); let sends = 0;
  const transport = { async prepare() { return { async send(): Promise<DeliveryOutcome> { sends++; return { kind: 'accepted', taskId }; } }; } };
  const results = await Promise.all([deliverInventoryOnce(h.db, transport, a.token, () => now), deliverInventoryOnce(h.db, transport, a.token, () => now)]);
  assert.equal(sends, 1); assert.equal(h.records.length, 1); assert.equal(results.filter(r => r.status === 'accepted').length, 1);
});
test('lost begin response never sends; lost record response never resends', async () => {
  const a = fixture(), h = store(a); let sends = 0;
  const transport = { async prepare() { return { async send(): Promise<DeliveryOutcome> { sends++; return { kind: 'accepted', taskId }; } }; } };
  const begin = h.db.begin; h.db.begin = async (...args) => { await begin(...args); throw Error('lost'); };
  await assert.rejects(deliverInventoryOnce(h.db, transport, a.token, () => now)); assert.equal(sends, 0);
  const h2 = store(a); h2.db.record = async () => { throw Error('lost'); };
  await assert.rejects(deliverInventoryOnce(h2.db, transport, a.token, () => now));
  assert.equal((await deliverInventoryOnce(h2.db, transport, a.token, () => now)).status, 'blocked'); assert.equal(sends, 1);
});
test('disabled database means no provider reads, writes or prepare call', async () => {
  const h = store(fixture()); h.db.claim = async () => ({ status: 'disabled' });
  assert.deepEqual(await deliverInventoryOnce(h.db, { async prepare() { throw Error('must not prepare'); } }, randomUUID()), { status: 'disabled' });
});
test('delivery storage is explicit production only and never exposes database failure details', async () => {
  assert.throws(() => createInventoryDeliveryStore('https://staging.invalid', 'test'));
  const db = createInventoryDeliveryStore(PRODUCTION_DB_URL, 'synthetic', async () => Response.json({ message: 'PRIVATE_SENTINEL' }, { status: 500 }));
  await assert.rejects(db.claim(randomUUID()), e => String(e).includes('do not resend') && !String(e).includes('PRIVATE_SENTINEL'));
});

test('durable acceptance returns without provider IO, even when the previous outcome response was lost', async () => {
  const calls: string[] = [];
  const db = createInventoryDeliveryStore(PRODUCTION_DB_URL, 'synthetic', async url => {
    calls.push(String(url).split('/').at(-1)!);
    return Response.json({ status: 'already-accepted' });
  });
  const result = await deliverInventoryOnce(db, { async prepare() { throw Error('must not read provider or send'); } }, randomUUID());
  assert.deepEqual(result, { status: 'already-accepted' });
  assert.deepEqual(calls, ['helm_channex_delivery_claim']);
  const malformed = createInventoryDeliveryStore(PRODUCTION_DB_URL, 'synthetic', async () =>
    Response.json({ status: 'already-accepted', attempt: fixture() }));
  await assert.rejects(malformed.claim(randomUUID()));
});
