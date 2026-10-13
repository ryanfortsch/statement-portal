import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD_STAGING as m, readCalderwoodChannex, compareProviders } from '../calderwood-readonly/channex.ts';
import { normalizeCalendar } from '../calderwood-readonly/calendar.ts';
import { CALDERWOOD } from '../calderwood-readonly/guesty-reader.ts';
const window = { from: '2027-01-01', to: '2027-01-03' };
const relationship = (id: string) => ({ data: { id } });
function fixtures() {
 return {
  properties: { data: { id: m.propertyId, attributes: { title: '65 Calderwood - Isolated Staging', currency: 'USD', timezone: 'America/New_York' } } },
  room_types: { data: { id: m.roomTypeId, attributes: { count_of_rooms: 1, occ_adults: 6, occ_children: 0, occ_infants: 0 }, relationships: { property: relationship(m.propertyId) } } },
  rate_plans: { data: { id: m.ratePlanId, attributes: { title: 'TEST ONLY - Calderwood - CLOSED - $100 placeholder', currency: 'USD', sell_mode: 'per_room', stop_sell: Array(7).fill(true) }, relationships: { property: relationship(m.propertyId), room_type: relationship(m.roomTypeId) } } },
  channels: { data: [], meta: { total: 0, page: 1, limit: 100 } },
  availability: { data: { [m.roomTypeId]: { '2027-01-01': 0, '2027-01-02': 1 } } },
  restrictions: { data: { [m.ratePlanId]: { '2027-01-01': { rate: '100.00', min_stay_arrival: 1, min_stay_through: 1, max_stay: 0, closed_to_arrival: false, closed_to_departure: false, stop_sell: true } } } },
 };
}
function mock(f = fixtures(), calls: string[] = []) { return async (url: string, init: RequestInit) => {
 const u = new URL(url); calls.push(u.pathname);
 assert.equal(u.origin, 'https://staging.channex.io'); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.body, undefined);
 if (u.pathname.endsWith('/availability') || u.pathname.endsWith('/restrictions')) { assert.equal(u.searchParams.get('filter[property_id]'), m.propertyId); assert.equal(u.searchParams.get('filter[date][lte]'), '2027-01-02'); }
 return Response.json(f[u.pathname.split('/')[3] as keyof typeof f]);
}; }
test('fixed staging GET read validates mappings and keeps absent nightly fields unknown', async () => {
 const result = await readCalderwoodChannex('secret', window, mock());
 assert.equal(result.days.length, 2); assert.equal(result.days[0].price, 100); assert.equal(result.days[1].stopSell, null); assert.equal(result.days[1].price, null); assert.equal(result.executable, false);
 assert.ok(!JSON.stringify(result).includes('secret'));
});
test('mapping mismatch, non-stopped defaults or attached channels prevent ARI reads', async () => {
 for (const change of ['mapping', 'stopped', 'channels']) {
  const f = fixtures(), calls: string[] = [];
  if (change === 'mapping') f.room_types.data.relationships.property.data.id = 'other';
  if (change === 'stopped') f.rate_plans.data.attributes.stop_sell[2] = false;
  if (change === 'channels') f.channels.meta.total = 1;
  await assert.rejects(readCalderwoodChannex('secret', window, mock(f, calls)));
  assert.ok(!calls.some(p => p.endsWith('/availability')));
 }
});
test('unexpected resource keys fail; HTTP bodies and network details are withheld', async () => {
 const f = fixtures(); Object.assign(f.availability.data, { unexpected: {} });
 await assert.rejects(readCalderwoodChannex('secret', window, mock(f)));
 await assert.rejects(readCalderwoodChannex('secret', window, async () => new Response('secret', { status: 403 })), e => e instanceof Error && !e.message.includes('secret'));
});
test('comparison separates missing fields from differences and treats stop-sell as closure', async () => {
 const staging = await readCalderwoodChannex('secret', window, mock());
 const guesty = normalizeCalendar({ days: [{ listingId: CALDERWOOD.guestyListingId, date: window.from, status: 'available', price: 100, currency: 'USD', minNights: 2, cta: false, ctd: false, requestToBook: false, blocks: {}, blockRefs: [] }] }, window);
 const rows = compareProviders(guesty, staging);
 assert.deepEqual(rows[0].differences, ['Arrival minimum', 'Closed / open state']);
 assert.equal(rows[0].safety, 'Stopped'); assert.equal(rows[0].missing.length, 0);
 assert.ok(rows[1].missing.includes('Guesty night missing')); assert.ok(rows[1].missing.includes('Channex stopSell missing'));
 staging.days[0].stopSell = false; staging.days[0].inventory = 1;
 assert.equal(compareProviders(guesty, staging)[0].safety, 'STOP-SELL OFF');
});
test('invalid windows fail before network activity', async () => {
 let calls = 0;
 await assert.rejects(readCalderwoodChannex('secret', { from: '2027-02-30', to: '2027-03-10' }, async () => { calls++; return Response.json({}); }));
 assert.equal(calls, 0);
});
