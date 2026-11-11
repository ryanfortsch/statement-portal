import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAirbnbRevisionReader } from '../channex-bookings/client.ts';
import { normalizeAirbnbBookingRevision, type AirbnbBookingMapping } from '../channex-bookings/revision.ts';
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mapping: AirbnbBookingMapping = { environment: 'staging', propertyId: id(1), roomTypeId: id(2), ratePlanId: id(3), generation: 1 };
const row = () => ({ type: 'booking_revision', id: id(4), attributes: { notes: null, customer: { name: 'Synthetic', surname: null, mail: 'guest@example.invalid', phone: null, address: null, city: null, state: null, country: null, zip: null }, booking_id: id(5), property_id: id(1), ota_name: 'Airbnb', ota_reservation_code: 'SYNTHETIC123', status: 'new', arrival_date: '2027-02-01', departure_date: '2027-02-04', inserted_at: '2026-10-23T12:00:00.000001Z', rooms: [{ room_type_id: id(2), rate_plan_id: id(3), checkin_date: '2027-02-01', checkout_date: '2027-02-04' }] } });
function harness(acknowledgeEnabled = true, scope = mapping, loseFirstAck = false) {
  const calls: { url: string; method: string }[] = [];
  const rel = (n: number) => ({ data: { id: id(n) } });
  const replies: Record<string, unknown> = {
    ['/properties/' + id(1)]: { data: { id: id(1) } },
    ['/room_types/' + id(2)]: { data: { id: id(2), relationships: { property: rel(1) } } },
    ['/rate_plans/' + id(3)]: { data: { id: id(3), relationships: { property: rel(1), room_type: rel(2) } } },
    ['/booking_revisions/' + id(4)]: { data: row() },
    ['/booking_revisions/' + id(4) + '/ack']: { meta: { message: 'Success' } },
    '/booking_revisions/feed': { data: [row()], meta: { page: 1, total: 1, limit: 100 } },
  };
  let lostAck = false;
  const client = createAirbnbRevisionReader({ mapping: scope, apiKey: 'SYNTHETIC', acknowledgeEnabled }, async (input, init) => {
    const url = new URL(String(input)); calls.push({ url: String(input), method: init?.method ?? '' });
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('user-api-key'), 'SYNTHETIC');
    if (loseFirstAck && !lostAck && init?.method === 'POST') {
      lostAck = true;
      const remote = row();
      Object.assign(remote.attributes, { acknowledge_status: 'acknowledged' });
      remote.attributes.customer.mail = '***';
      replies['/booking_revisions/' + id(4)] = { data: remote };
      throw Error('PRIVATE_LOST_RESPONSE');
    }
    return Response.json(replies[url.pathname.replace('/api/v1', '')]);
  });
  return { client, calls, replies };
}
test('client checks mapping, reads bounded first page and rechecks revision before ACK', async () => {
  const h = harness(); await h.client.inspect(mapping); assert.equal((await h.client.feed()).length, 1);
  await h.client.acknowledge(normalizeAirbnbBookingRevision(row(), mapping));
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.match(h.calls.at(-2)!.url, new RegExp(id(4) + '$')); assert.match(h.calls.at(-1)!.url, /\/ack$/);
  const feed = new URL(h.calls[3].url); assert.equal(feed.searchParams.has('filter[property_id]'), false); assert.equal(feed.searchParams.get('pagination[page]'), '1');
});
test('explicit prior ACK is not posted again even when every masked field was null', async () => {
  for (const populated of [false, true]) {
    const h = harness(), original = row();
    Object.assign(original.attributes.customer, { mail: populated ? 'guest@example.invalid' : null });
    const expected = normalizeAirbnbBookingRevision(original, mapping), retained = structuredClone(expected);
    const remote = structuredClone(original);
    Object.assign(remote.attributes, { acknowledge_status: 'acknowledged' });
    if (populated) remote.attributes.customer.mail = '***';
    const snapshot = structuredClone(remote);
    h.replies['/booking_revisions/' + id(4)] = { data: remote };
    await h.client.acknowledge(expected);
    assert.equal(h.calls.length, 4);
    assert.ok(h.calls.every(c => c.method === 'GET'));
    assert.deepEqual(expected, retained); assert.deepEqual(remote, snapshot);
  }
});
test('a caller can reconcile a lost successful ACK from its retained revision without a second POST', async () => {
  const h = harness(true, mapping, true), expected = normalizeAirbnbBookingRevision(row(), mapping);
  await assert.rejects(() => h.client.acknowledge(expected), /request incomplete/);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  const afterFailure = h.calls.length;
  await h.client.acknowledge(expected);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.ok(h.calls.slice(afterFailure).every(c => c.method === 'GET'));
});
test('explicit ACK still requires exact identity and retained data; partial or pre-ACK masks never POST', async () => {
  for (const change of [
    (r: ReturnType<typeof row>) => { r.id = id(9); },
    (r: ReturnType<typeof row>) => { r.attributes.customer.mail = 'different@example.invalid'; },
    (r: ReturnType<typeof row>) => { Object.assign(r.attributes.customer, { phone: '***' }); },
    (r: ReturnType<typeof row>) => { r.attributes.customer.name = '***'; },
    (r: ReturnType<typeof row>) => { Reflect.deleteProperty(r.attributes.customer, 'state'); },
    (r: ReturnType<typeof row>) => { Object.assign(r.attributes, { acknowledge_status: 'pending' }); r.attributes.customer.mail = '***'; },
    (r: ReturnType<typeof row>) => { Object.assign(r.attributes, { acknowledge_status: 'ACKNOWLEDGED' }); r.attributes.customer.mail = '***'; },
    (r: ReturnType<typeof row>) => { r.type = 'booking'; },
  ]) {
    const h = harness(), remote = row(), expected = normalizeAirbnbBookingRevision(row(), mapping);
    Object.assign(remote.attributes, { acknowledge_status: 'acknowledged' }); change(remote);
    h.replies['/booking_revisions/' + id(4)] = { data: remote };
    await assert.rejects(() => h.client.acknowledge(expected));
    assert.ok(h.calls.every(c => c.method === 'GET'));
  }
});
test('missing Airbnb state stops the feed before ingestion can receive an incomplete projection', async () => {
  const h = harness(), remote = row(); Reflect.deleteProperty(remote.attributes.customer, 'state');
  h.replies['/booking_revisions/feed'] = { data: [remote], meta: { page: 1, limit: 100, total: 1 } };
  await assert.rejects(() => h.client.feed());
  assert.ok(h.calls.every(c => c.method === 'GET'));
});
test('ACK disabled by default and changed revisions or mapping never POST', async () => {
  const disabled = harness(false); await assert.rejects(() => disabled.client.acknowledge(normalizeAirbnbBookingRevision(row(), mapping))); assert.equal(disabled.calls.length, 0);
  const h = harness(); const changed = row(); changed.attributes.status = 'cancelled'; h.replies['/booking_revisions/' + id(4)] = { data: changed };
  await assert.rejects(() => h.client.acknowledge(normalizeAirbnbBookingRevision(row(), mapping)));
  assert.equal(h.calls.some(c => c.method === 'POST'), false);
  const wrong = harness(); wrong.replies['/room_types/' + id(2)] = { data: { id: id(2), relationships: {} } };
  await assert.rejects(() => wrong.client.inspect(mapping));
});
test('feed rejects duplicate, partial, foreign and warning responses', async () => {
  const foreign = row(); foreign.attributes.property_id = id(9);
  for (const response of [
    { data: [row(), row()], meta: { page: 1, limit: 100, total: 2 } },
    { data: [], meta: { page: 1, limit: 100, total: 1 } },
    { data: [foreign], meta: { page: 1, limit: 100, total: 1 } },
    { data: [row()], meta: { page: 1, limit: 100, total: 1, warnings: ['PRIVATE'] } },
  ]) { const h = harness(); h.replies['/booking_revisions/feed'] = response; await assert.rejects(() => h.client.feed()); assert.equal(h.calls.some(c => c.method === 'POST'), false); }
});
test('fixed environment hosts and invalid credential or mapping cannot leak secrets', async () => {
  const scope = { ...mapping, environment: 'production' as const }, h = harness(false, scope);
  await h.client.inspect(scope); assert.ok(h.calls.every(c => new URL(c.url).host === 'app.channex.io'));
  assert.throws(() => createAirbnbRevisionReader({ mapping, apiKey: 'PRIVATE\n' }));
  const client = createAirbnbRevisionReader({ mapping, apiKey: 'SYNTHETIC' }, async () => { throw Error('PRIVATE'); });
  await assert.rejects(() => client.feed(), e => e instanceof Error && !e.message.includes('PRIVATE'));
});
test('changed or masked guest contact at pre-ACK refetch never POSTs', async () => {
  for (const mail of ['changed@example.invalid', '***']) {
    const h = harness(), expected = normalizeAirbnbBookingRevision(row(), mapping);
    const changed = row(); changed.attributes.customer.mail = mail;
    h.replies['/booking_revisions/' + id(4)] = { data: changed };
    await assert.rejects(() => h.client.acknowledge(expected));
    assert.equal(h.calls.some(c => c.method === 'POST'), false);
  }
});
test('rate limiting and authentication failures make one request and expose no provider body', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const client = createAirbnbRevisionReader({ mapping, apiKey: 'chx_SYNTHETIC_NOT_A_REAL_KEY' }, async () => {
      calls++;
      return new Response('PRIVATE_SENTINEL', { status, headers: { 'Retry-After': '60' } });
    });
    await assert.rejects(() => client.feed(), e => e instanceof Error && !e.message.includes('PRIVATE_SENTINEL'));
    assert.equal(calls, 1);
  }
});
