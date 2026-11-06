import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD_PRODUCTION as m } from '../channex-production-preflight.ts';
import { prepareInventory, planProductionInventory, inventoryDigest, inventoryPlanId,
  type InventoryState, type InventoryPlanningStore } from '../channex-inventory/planner.ts';
import { createInventoryPlanningStore } from '../channex-inventory/store.ts';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { shiftIsoDay } from '../sca-quotes-types.ts';
const now = Date.parse('2026-11-06T15:00:00Z');
function fixture(clock = now, start = '2026-11-06'): InventoryState {
  const end = shiftIsoDay(start, 500);
  return { propertyId: m.helmPropertyId, remotePropertyId: m.propertyId, roomTypeId: m.roomTypeId,
    ratePlanId: m.ratePlanId, generation: 1, environment: 'production', timeZone: 'America/New_York',
    planningEnabled: true, importEnabled: true, captureEnabled: true, captureVersion: 1, configurationVersion: 1,
    headVersion: 0, observedAt: clock, inputToken: 'a'.repeat(64), start, end,
    requiredSources: ['canonical-calendar', 'channex-bookings'],
    coverage: ['canonical-calendar', 'channex-bookings'].map(source => ({ source: source as 'canonical-calendar' | 'channex-bookings',
      start: shiftIsoDay(start, -30), end: shiftIsoDay(end, 30), complete: true, observedAt: clock, freshUntil: clock + 1800000 })),
    inputs: { authority: 'helm', plan: { advance_notice_hours: 0, booking_window_days: 365, turnover_buffer_days: 0, checkin_time: '16:00' },
      bookings: [], rateDays: [], periods: [] } };
}
const stay = (id: string, start: string, end: string, patch = {}) => ({ id, status: 'confirmed' as const,
  check_in: start, check_out: end, duplicate_of: null, hold_kind: null, source: 'manual', channel: 'direct', ...patch });
function days(state: InventoryState, clock = now) { return new Map(prepareInventory(state, clock).plan!.days.map(d => [d.date, d.available])); }
test('complete 500-day inventory retains the 365-day guest window and excludes prices', () => {
  const f = fixture(), { plan } = prepareInventory(f, now);
  assert.equal(plan!.days.length, 500); assert.equal(plan!.days[365].available, 1); assert.equal(plan!.days[366].available, 0);
  assert.deepEqual(Object.keys(plan!.days[0]), ['date', 'available']);
  assert.equal(plan!.freshUntil, now + 60000); assert.equal(plan!.digest, inventoryDigest(plan!.days));
  assert.equal(plan!.id, inventoryPlanId(f, plan!.digest));
});
test('stays and moves free only the checkout boundary; cancellation retains independent holds', () => {
  const f = fixture(); f.inputs.bookings = [stay('guest', '2026-11-10', '2026-11-12'), stay('owner', '2026-11-11', '2026-11-13', { status: 'block', hold_kind: 'owner' })];
  assert.equal(days(f).get('2026-11-10'), 0); assert.equal(days(f).get('2026-11-12'), 0); assert.equal(days(f).get('2026-11-13'), 1);
  f.inputs.bookings[0].status = 'cancelled';
  assert.equal(days(f).get('2026-11-10'), 1); assert.equal(days(f).get('2026-11-11'), 0);
  f.inputs.bookings[0] = stay('guest', '2026-11-14', '2026-11-16');
  assert.equal(days(f).get('2026-11-14'), 0); assert.equal(days(f).get('2026-11-16'), 1);
});
test('canonical duplicates are skipped but independent OTA closures remain closed', () => {
  const f = fixture(); f.inputs.bookings = [stay('duplicate', '2026-11-10', '2026-11-12', { duplicate_of: 'canonical' }),
    stay('closure', '2026-11-12', '2026-11-14', { status: 'block', duplicate_of: 'canonical', hold_kind: 'ota', source: 'ical_import', channel: 'booking_com' })];
  assert.equal(days(f).get('2026-11-10'), 1); assert.equal(days(f).get('2026-11-12'), 0);
});
test('buffer neighbours outside the window hold dates inside it', () => {
  const f = fixture(); f.inputs.plan!.turnover_buffer_days = 2;
  f.inputs.bookings = [stay('previous', '2026-11-01', '2026-11-06')];
  assert.equal(days(f).get('2026-11-06'), 0); assert.equal(days(f).get('2026-11-07'), 0); assert.equal(days(f).get('2026-11-08'), 1);
  f.coverage[0].start = f.start; assert.equal(prepareInventory(f, now).plan, null);
});
test('seasonal closures and explicit closed days compose with canonical holds', () => {
  const f = fixture(); f.inputs.periods = [{ startMonth: 11, startDay: 1, endMonth: 11, endDay: 30 }];
  f.inputs.rateDays = [{ date: '2026-11-12', closed: true }];
  assert.equal(days(f).get('2026-11-12'), 0); assert.equal(days(f).get('2026-11-13'), 1); assert.equal(days(f).get('2026-12-01'), 0);
});
test('empty, missing, partial and stale coverage never turns an empty calendar into open inventory', () => {
  for (const mutate of [
    (f: InventoryState) => { f.coverage = []; },
    (f: InventoryState) => { f.coverage.pop(); },
    (f: InventoryState) => { f.coverage[1].complete = false; },
    (f: InventoryState) => { f.coverage[0].freshUntil = now; f.coverage[0].observedAt = now - 60000; },
    (f: InventoryState) => { f.coverage[0].end = shiftIsoDay(f.end, -1); },
    (f: InventoryState) => { f.planningEnabled = false; },
    (f: InventoryState) => { f.importEnabled = false; },
    (f: InventoryState) => { f.captureEnabled = false; },
    (f: InventoryState) => { f.captureVersion = 0; },
    (f: InventoryState) => { f.inputs.authority = 'guesty'; },
    (f: InventoryState) => { f.inputs.plan = null; },
  ]) { const f = fixture(); mutate(f); assert.equal(prepareInventory(f, now).plan, null); }
});
test('wrong mappings, malformed data, truncation and unexpected financial fields fail closed', () => {
  const patches = [{ propertyId: 'other' }, { remotePropertyId: 'other' }, { roomTypeId: 'other' }, { ratePlanId: 'other' },
    { generation: 2 }, { environment: 'staging' }, { timeZone: 'UTC' }, { end: '2026-11-07' }, { start: '2026-02-30' }];
  for (const patch of patches) assert.throws(() => prepareInventory({ ...fixture(), ...patch }, now));
  const f = fixture();
  assert.throws(() => prepareInventory({ ...f, inputs: { ...f.inputs, price: 10 } }, now));
  f.inputs.bookings = Array.from({ length: 5001 }, (_, i) => stay(String(i), '2026-11-10', '2026-11-12'));
  assert.throws(() => prepareInventory(f, now));
});
test('duplicate IDs, coverage, invalid spans, seasons and out-of-window closures are rejected', () => {
  for (const mutate of [
    (f: InventoryState) => { f.inputs.bookings = [stay('a', '2026-11-10', '2026-11-12'), stay('a', '2026-11-10', '2026-11-12')]; },
    (f: InventoryState) => { f.inputs.bookings = [stay('a', '2026-11-12', '2026-11-10')]; },
    (f: InventoryState) => { f.coverage[1] = f.coverage[0]; },
    (f: InventoryState) => { f.inputs.periods = [{ startMonth: 2, startDay: 30, endMonth: 11, endDay: 30 }]; },
    (f: InventoryState) => { f.inputs.rateDays = [{ date: f.end, closed: true }]; },
    (f: InventoryState) => { f.coverage[0].observedAt = now + 1; },
    (f: InventoryState) => { f.coverage[0].freshUntil = now + 3600001; },
  ]) { const f = fixture(); mutate(f); assert.throws(() => prepareInventory(f, now)); }
});
test('notice boundary expires a plan at the first unbookable millisecond', () => {
  const clock = Date.parse('2026-11-06T20:59:59Z'), f = fixture(clock);
  const { plan } = prepareInventory(f, clock); assert.equal(plan!.freshUntil, clock + 1001);
  assert.equal(days(f, clock + 1000).get(f.start), 1); assert.equal(days(f, clock + 1001).get(f.start), 0);
});
test('Eastern midnight and both DST transitions expire plans without changing the night count', () => {
  for (const [iso, date] of [['2026-11-07T04:59:59Z', '2026-11-06'], ['2026-03-08T06:59:59Z', '2026-03-08'], ['2026-11-01T05:59:59Z', '2026-11-01']]) {
    const clock = Date.parse(iso), f = fixture(clock, date), p = prepareInventory(f, clock).plan!;
    assert.equal(p.days.length, 500); assert.equal(p.days[499].date, shiftIsoDay(date, 499));
    assert.equal(p.freshUntil, clock + (date === '2026-11-06' ? 1000 : 60000));
  }
});
test('old snapshots, clock reversal, wrong day and booking-window drift cannot create plans', () => {
  assert.equal(prepareInventory(fixture(), now + 60000).plan, null);
  assert.equal(prepareInventory(fixture(), now + 86400000).plan, null);
  assert.throws(() => prepareInventory(fixture(), now - 1));
  const f = fixture(); assert.throws(() => prepareInventory({ ...f, inputs: { ...f.inputs, plan: { ...f.inputs.plan, booking_window_days: 0 } } }, now));
});
test('planner reads fresh state once; uncertain writes are never retried or sent', async () => {
  let writes = 0; const f = fixture();
  const store: InventoryPlanningStore = { read: async () => f, commit: async (expected, plan) => {
    writes++; assert.equal(expected.inputToken, f.inputToken); assert.equal(plan.days.length, 500); throw Error('uncertain'); } };
  await assert.rejects(planProductionInventory(store, () => now), /uncertain/); assert.equal(writes, 1);
  store.read = async () => ({ status: 'disabled' }); assert.deepEqual(await planProductionInventory(store, () => now), { status: 'disabled' });
  store.read = async () => ({ ...f, coverage: [] }); assert.deepEqual(await planProductionInventory(store, () => now), { status: 'blocked' });
  assert.equal(writes, 1);
});
test('database adapter is pinned, uses only two planning RPCs and sanitizes uncertain responses', async () => {
  assert.throws(() => createInventoryPlanningStore('https://elsewhere.invalid', 'secret'));
  assert.throws(() => createInventoryPlanningStore(PRODUCTION_DB_URL, ''));
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url) => {
    calls.push(String(url)); return Response.json(calls.length === 1 ? { status: 'disabled' } : { status: 'stored', version: 1 });
  };
  const store = createInventoryPlanningStore(PRODUCTION_DB_URL, 'synthetic', fetcher), f = fixture();
  assert.deepEqual(await store.read(), { status: 'disabled' });
  const expected = { captureVersion: 1, configurationVersion: 1, headVersion: 0, inputToken: f.inputToken };
  assert.equal((await store.commit(expected, prepareInventory(f, now).plan!)).version, 1);
  assert.deepEqual(calls, [`${PRODUCTION_DB_URL}/rest/v1/rpc/helm_channex_inventory_read`, `${PRODUCTION_DB_URL}/rest/v1/rpc/helm_channex_inventory_plan_commit`]);
  const bad = createInventoryPlanningStore(PRODUCTION_DB_URL, 'synthetic', async () => { throw Error('PRIVATE_SENTINEL'); });
  await assert.rejects(bad.read(), e => /snapshot unavailable/.test(String(e)) && !String(e).includes('PRIVATE_SENTINEL'));
  await assert.rejects(bad.commit(expected, prepareInventory(f, now).plan!), e => /save uncertain/.test(String(e)) && !String(e).includes('PRIVATE_SENTINEL'));
});
