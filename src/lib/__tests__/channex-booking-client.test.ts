import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAirbnbRevisionReader } from '../channex-bookings/client.ts';
import { normalizeAirbnbBookingRevision, type AirbnbBookingMapping } from '../channex-bookings/revision.ts';
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mapping: AirbnbBookingMapping = { environment: 'staging', propertyId: id(1), roomTypeId: id(2), ratePlanId: id(3), generation: 1 };
const row = () => ({ type: 'booking_revision', id: id(4), attributes: { booking_id: id(5), property_id: id(1), ota_name: 'Airbnb', ota_reservation_code: 'SYNTHETIC123', status: 'new', arrival_date: '2027-02-01', departure_date: '2027-02-04', inserted_at: '2026-10-23T12:00:00.000001Z', rooms: [{ room_type_id: id(2), rate_plan_id: id(3), checkin_date: '2027-02-01', checkout_date: '2027-02-04' }] } });
function harness(acknowledgeEnabled = true, scope = mapping) {
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
  const client = createAirbnbRevisionReader({ mapping: scope, apiKey: 'SYNTHETIC', acknowledgeEnabled }, async (input, init) => {
    const url = new URL(String(input)); calls.push({ url: String(input), method: init?.method ?? '' });
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('user-api-key'), 'SYNTHETIC');
    return Response.json(replies[url.pathname.replace('/api/v1', '')]);
  });
  return { client, calls, replies };
}
test('client checks mapping, reads bounded first page and rechecks revision before ACK', async () => {
  const h = harness(); await h.client.inspect(mapping); assert.equal((await h.client.feed()).length, 1);
  await h.client.acknowledge(normalizeAirbnbBookingRevision(row(), mapping));
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.match(h.calls.at(-2)!.url, new RegExp(id(4) + '$')); assert.match(h.calls.at(-1)!.url, /\/ack$/);
  const feed = new URL(h.calls[3].url); assert.equal(feed.searchParams.get('filter[property_id]'), id(1)); assert.equal(feed.searchParams.get('pagination[page]'), '1');
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
