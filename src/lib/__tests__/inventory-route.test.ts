import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindInventoryRoute, propertyMapping } from '../channex-staging/inventory-route.ts';
import { createInventoryRouteReader } from '../channex-staging/inventory-route-store.ts';
import { parseBookingInventoryState } from '../channex-staging/booking-inventory-consumer.ts';
import { createInventoryCycleRunner } from '../channex-staging/booking-inventory-scheduler.ts';
import { readIsolatedChannex } from '../calderwood-readonly/channex.ts';
const route = { environment: 'staging', helmProperty: 'HELMTEST-other', connection: 'other-inventory', generation: 4,
  propertyId: '11111111-1111-4111-8111-111111111111', roomTypeId: '22222222-2222-4222-8222-222222222222',
  ratePlanId: '33333333-3333-4333-8333-333333333333', propertyTitle: 'Other home - Isolated Staging',
  ratePlanTitle: 'TEST ONLY - Other home - CLOSED', adults: 2, children: 1, infants: 0, reviewedAt: '2026-10-22T12:00:00Z' };
const env = { CHANNEX_CALDERWOOD_INVENTORY_ENABLED: 'true', CHANNEX_WORKER_MODE: 'isolated-staging',
  CHANNEX_STAGING_DB_PROJECT_REF: 'jgkblfozftcvymvwhhii', CHANNEX_STAGING_DB_URL: 'https://jgkblfozftcvymvwhhii.supabase.co',
  CHANNEX_STAGING_API_KEY: 'fictional', CHANNEX_STAGING_DB_SERVICE_KEY: 'fictional',
  CHANNEX_INVENTORY_HELM_PROPERTY: route.helmProperty, CHANNEX_CALDERWOOD_INVENTORY_WINDOW: 'configured-window' };
function state() {
  return parseBookingInventoryState({ property: route.helmProperty, captureEnabled: true, captureVersion: 1, configurationVersion: 1,
    configuration: { environment: 'staging', topology: 'single-unit', connection: route.connection, listing: route.roomTypeId, generation: route.generation,
      publishEnabled: true, timeZone: 'America/New_York', start: '2027-04-10', end: '2027-04-13', requiredSources: ['synthetic-canonical'],
      coverage: [{ source: 'synthetic-canonical', start: '2027-04-10', end: '2027-04-13', complete: true, observedAt: Date.now()-1000, freshUntil: Date.now()+1800000 }] },
    plannedCaptureVersion: 0, plannedConfigurationVersion: 0, planVersion: 0, journalVersion: 0, journal: { format: 1, commands: [] },
    lastDigest: null, plannedFreshUntil: 0, inputsMatchPlan: false,
    inputs: { authority: 'helm', plan: { advance_notice_hours: 24, booking_window_days: 365, turnover_buffer_days: 0, checkin_time: '16:00' }, bookings: [], rateDays: [], periods: [] },
  }, route.helmProperty);
}
test('mapping binds every routing identity and accepts a second fictional property', () => {
  const parsed = bindInventoryRoute(route, state()); assert.equal(parsed.propertyId, route.propertyId); assert.ok(Object.isFrozen(parsed));
  for (const [field, value] of Object.entries({ helmProperty: 'HELMTEST-wrong', connection: 'wrong', generation: 3, roomTypeId: '44444444-4444-4444-8444-444444444444' })) {
    assert.throws(() => bindInventoryRoute({ ...route, [field]: value }, state()), /does not match/);
  }
  for (const patch of [{ environment: 'production' }, { propertyTitle: 'Live home' }, { ratePlanTitle: 'Live rates' }, { reviewedAt: '' }, { apiKey: 'secret' }, { adults: 0 }]) {
    assert.throws(() => bindInventoryRoute({ ...route, ...patch }, state()));
  }
});
test('route reader sends exact property/connection/generation and never initializes missing or stale mappings', async () => {
  let calls = 0;
  for (const response of [route, null, { ...route, generation: 3 }]) {
    const read = createInventoryRouteReader(env.CHANNEX_STAGING_DB_URL, 'fictional', async (input, init) => {
      calls++; assert.equal(String(input), env.CHANNEX_STAGING_DB_URL+'/rest/v1/rpc/helm_staging_inventory_route_read');
      assert.deepEqual(JSON.parse(String(init?.body)), { p_property: route.helmProperty, p_connection: route.connection, p_generation: 4 });
      return Response.json(response);
    });
    if (response === route) assert.deepEqual(await read(state()), route); else await assert.rejects(() => read(state()));
  }
  assert.equal(calls, 3);
  assert.throws(() => createInventoryRouteReader('https://other.supabase.co', 'fictional'));
});
test('worker has no fallback destination for missing, cross-property or stale mappings', async () => {
  for (const response of [null, { ...route, helmProperty: 'HELMTEST-calderwood' }, { ...route, generation: 5 }]) {
    const calls: string[] = [];
    const run = createInventoryCycleRunner(env, async (input) => {
      const u = new URL(String(input)); calls.push(u.pathname); assert.equal(u.origin, env.CHANNEX_STAGING_DB_URL);
      if (u.pathname.endsWith('/helm_booking_inventory_read')) return Response.json(state());
      assert.ok(u.pathname.endsWith('/helm_staging_inventory_route_read')); return Response.json(response);
    });
    await assert.rejects(() => run(new AbortController().signal)); assert.equal(calls.length, 2);
  }
});
test('new routes cannot opt into the fixed canonical importer or rolling-window SQL', () => {
  for (const patch of [ { CHANNEX_INVENTORY_HELM_PROPERTY: 'live-home' }, { CHANNEX_CALDERWOOD_INVENTORY_WINDOW: 'rolling-year' },
    { CHANNEX_CALDERWOOD_SOURCE_COVERAGE_ENABLED: 'true', CHANNEX_CANONICAL_POLLING_ENABLED: 'true' } ]) {
    assert.throws(() => createInventoryCycleRunner({ ...env, ...patch }));
  }
});
test('mapped calendar reader verifies the second property, exact occupancy, stopped plan and channel isolation', async () => {
  for (const bad of ['', 'parent', 'occupancy', 'rate', 'channel']) {
    const calls: string[] = [], m = propertyMapping(bindInventoryRoute(route, state()));
    const read = () => readIsolatedChannex('fictional', { from: '2027-04-10', to: '2027-04-11' }, m, async (input, init) => {
      const u = new URL(input); calls.push(u.pathname); assert.equal(u.origin, 'https://staging.channex.io'); assert.equal(init.method, 'GET');
      const rel = (id: string) => ({ data: { id } });
      if (u.pathname.includes('/properties/')) { assert.ok(u.pathname.endsWith(m.propertyId)); return Response.json({ data: { id: m.propertyId, attributes: { title: m.propertyTitle, currency: 'USD', timezone: 'America/New_York' } } }); }
      if (u.pathname.includes('/room_types/')) return Response.json({ data: { id: m.roomTypeId, attributes: { count_of_rooms: 1, occ_adults: bad === 'occupancy' ? 6 : 2, occ_children: 1, occ_infants: 0 }, relationships: { property: rel(bad === 'parent' ? 'other' : m.propertyId) } } });
      if (u.pathname.includes('/rate_plans/')) return Response.json({ data: { id: m.ratePlanId, attributes: { title: m.ratePlanTitle, currency: 'USD', sell_mode: 'per_room', stop_sell: Array(7).fill(bad !== 'rate') }, relationships: { property: rel(m.propertyId), room_type: rel(m.roomTypeId) } } });
      assert.equal(u.searchParams.get('filter[property_id]'), m.propertyId);
      if (u.pathname.endsWith('/channels')) return Response.json({ data: [], meta: { total: bad === 'channel' ? 1 : 0, page: 1, limit: 100 } });
      if (u.pathname.endsWith('/availability')) return Response.json({ data: { [m.roomTypeId]: { '2027-04-10': 0 } } });
      assert.ok(u.pathname.endsWith('/restrictions')); return Response.json({ data: { [m.ratePlanId]: { '2027-04-10': { rate: 100, min_stay_arrival: 1, min_stay_through: 1, max_stay: 0, closed_to_arrival: false, closed_to_departure: false, stop_sell: true } } } });
    });
    if (!bad) { const result = await read(); assert.equal(result.days[0].inventory, 0); assert.equal(result.days[0].stopSell, true); }
    else { await assert.rejects(read); assert.ok(!calls.some(p => p.endsWith('/availability'))); }
  }
});
