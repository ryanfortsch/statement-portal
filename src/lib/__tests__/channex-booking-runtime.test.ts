import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProductionBookingTick, BOOKING_TICK_LIMIT } from '../channex-bookings/runtime.ts';
import { intakeEnv as env, intakeHarness, intakeId, intakeRow } from './fixtures/channex-booking-intake.ts';

test('off mode and rejected production configuration perform no provider or database IO', async () => {
  for (const mode of [undefined, '', 'off']) {
    const h = intakeHarness();
    const r = await runProductionBookingTick({ HELM_CHANNEX_BOOKINGS_MODE: mode }, h);
    assert.equal(r.state, 'disabled'); assert.equal(r.ok, true); assert.deepEqual(h.events, []);
  }
  for (const patch of [{ VERCEL_ENV: 'preview' }, { CHANNEX_PRODUCTION_MODE: 'inspect' },
    { HELM_CHANNEX_BOOKINGS_MODE: 'consume' }, { NEXT_PUBLIC_SUPABASE_URL: 'https://wrong.invalid' },
    { SUPABASE_SERVICE_ROLE_KEY: '' }, { CHANNEX_PRODUCTION_API_KEY: '\nSECRET' }, { CRON_SECRET: '' },
    { HELM_ISOLATED_CALENDAR_ENABLED: 'true' }, { CHANNEX_WORKER_MODE: 'isolated-staging' }]) {
    const h = intakeHarness(), r = await runProductionBookingTick({ ...env, ...patch }, h);
    assert.equal(r.state, 'configuration_required'); assert.deepEqual(h.events, []);
  }
});

test('authority, mapping, capture, and schema drift block before reading the feed', async () => {
  for (const patch of [{ calendarAuthority: 'guesty' }, { importEnabled: false }, { captureEnabled: false },
    { generation: 2 }, { propertyId: 'other_home' }, { remotePropertyId: intakeId(50) },
    { receipts: -1 }, { extra: true }]) {
    const h = intakeHarness(); Object.assign(h.storage, patch);
    const r = await runProductionBookingTick(env, h);
    assert.equal(r.state, 'incomplete'); assert.equal(r.partialEffectsPossible, false);
    assert.deepEqual(h.events, ['helm_channex_storage_status']);
  }
});

test('full page validation precedes bounded oldest-first processing and page-one drainage', async () => {
  const h = intakeHarness(Array.from({ length: 7 }, (_, i) => intakeRow(7 - i)));
  const first = await runProductionBookingTick(env, h);
  assert.equal(first.state, 'more_pending'); assert.equal(first.acknowledgedRevisions, BOOKING_TICK_LIMIT);
  assert.equal(first.deferredRevisions, 2); assert.equal(first.completeCoverage, false); assert.equal(first.canSend, false);
  assert.deepEqual([...h.acked], [1, 2, 3, 4, 5].map(intakeId));
  const second = await runProductionBookingTick(env, h);
  assert.equal(second.state, 'page_processed'); assert.equal(second.acknowledgedRevisions, 2);
  assert.equal(h.receipts.size, 7); assert.equal(h.acked.size, 7);
  const third = await runProductionBookingTick(env, h);
  assert.equal(third.state, 'page_processed');
  assert.equal(third.acknowledgedRevisions, 0); assert.equal(third.completeCoverage, false);
  const commit = h.events.indexOf('helm_airbnb_revision_commit'), read = h.events.indexOf('helm_airbnb_revision_receipt');
  assert.ok(commit < read && read < h.events.indexOf(`POST /booking_revisions/${intakeId(1)}/ack`));
});

test('malformed or foreign row beyond the five-row limit prevents ALL writes', async () => {
  for (const malformed of [false, true]) {
    const h = intakeHarness(Array.from({ length: 6 }, (_, i) => intakeRow(i + 1)));
    if (malformed) Reflect.deleteProperty(h.rows[5].attributes.customer, 'state');
    else h.rows[5].attributes.property_id = intakeId(50);
    const r = await runProductionBookingTick(env, h);
    assert.equal(r.state, 'incomplete'); assert.equal(r.partialEffectsPossible, false);
    assert.equal(h.receipts.size, 0); assert.equal(h.acked.size, 0);
  }
});

test('revoked capture after a commit stops ACK and does not claim zero effects', async () => {
  const h = intakeHarness(), original = h.rpc;
  h.rpc = async (...args) => {
    const response = await original(...args);
    if (args[0] === 'helm_airbnb_revision_commit') h.storage.captureEnabled = false;
    return response;
  };
  const r = await runProductionBookingTick(env, h);
  assert.equal(r.state, 'incomplete'); assert.equal(r.partialEffectsPossible, true);
  assert.equal(h.receipts.size, 1); assert.equal(h.acked.size, 0);
});

test('lost commit response reuses the original durable receipt on the next tick', async () => {
  const h = intakeHarness(), original = h.rpc;
  let fail = true;
  h.rpc = async (...args) => {
    const response = await original(...args);
    if (args[0] === 'helm_airbnb_revision_commit' && fail) { fail = false; throw Error('PRIVATE_SENTINEL'); }
    return response;
  };
  const first = await runProductionBookingTick(env, h), receipt = structuredClone(h.receipts.get(intakeId(1)));
  assert.equal(first.state, 'incomplete');
  assert.equal(first.partialEffectsPossible, true); assert.equal(h.acked.size, 0);
  assert.ok(!JSON.stringify(first).includes('PRIVATE_SENTINEL'));
  const second = await runProductionBookingTick(env, h);
  assert.equal(second.ok, true); assert.equal(h.receipts.size, 1);
  assert.deepEqual(h.receipts.get(intakeId(1)), receipt); assert.equal(h.acked.size, 1);
});

test('lost ACK response preserves the receipt; next empty feed does not retry ACK or claim coverage', async () => {
  const h = intakeHarness(), fetcher = h.fetcher;
  h.fetcher = async (input, init) => { const r = await fetcher(input, init);
    if (init?.method === 'POST') throw Error('LOST_ACK'); return r; };
  const first = await runProductionBookingTick(env, h);
  assert.equal(first.state, 'incomplete'); assert.equal(first.acknowledgedRevisions, 0);
  assert.equal(first.partialEffectsPossible, true); assert.equal(h.receipts.size, 1);
  const second = await runProductionBookingTick(env, h);
  assert.equal(second.state, 'page_processed'); assert.equal(second.completeCoverage, false);
  assert.equal(h.events.filter(x => x.startsWith('POST')).length, 1);
});

test('deadline abort after commit prevents receipt/ACK IO and is recoverable next tick', async () => {
  const h = intakeHarness(), original = h.rpc, controller = new AbortController();
  h.rpc = async (...args) => { const r = await original(...args);
    if (args[0] === 'helm_airbnb_revision_commit') controller.abort(); return r; };
  const r = await runProductionBookingTick(env, { ...h, signal: controller.signal });
  assert.equal(r.state, 'incomplete'); assert.equal(r.partialEffectsPossible, true);
  assert.equal(h.events.includes('helm_airbnb_revision_receipt'), false); assert.equal(h.acked.size, 0);
  h.rpc = original; assert.equal((await runProductionBookingTick(env, h)).ok, true);
});

test('aborted tick and database/provider failures do not expose upstream details', async () => {
  const h = intakeHarness(), controller = new AbortController(); controller.abort();
  assert.equal((await runProductionBookingTick(env, { ...h, signal: controller.signal })).ok, false);
  assert.deepEqual(h.events, []);
  for (const deps of [{ rpc: async () => { throw Error('PRIVATE_SENTINEL'); }, fetcher: h.fetcher },
    { rpc: h.rpc, fetcher: async () => { throw Error('PRIVATE_SENTINEL'); } }]) {
    const r = await runProductionBookingTick(env, deps);
    assert.equal(r.ok, false); assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
  }
});

test('concurrent ticks reuse a receipt; rejected duplicate ACK remains incomplete', async () => {
  const h = intakeHarness(), original = h.fetcher;
  let arrived = 0, release!: () => void;
  const bothReady = new Promise<void>(resolve => { release = resolve; });
  h.fetcher = async (input, init) => {
    if (init?.method !== 'POST') return original(input, init);
    arrived++; if (arrived === 2) release(); await bothReady;
    if (h.acked.size) return Response.json({ errors: ['SYNTHETIC duplicate ACK'] }, { status: 409 });
    return original(input, init);
  };
  const results = await Promise.all([runProductionBookingTick(env, h), runProductionBookingTick(env, h)]);
  assert.equal(h.receipts.size, 1); assert.equal(h.acked.size, 1);
  assert.deepEqual(results.map(r => r.state).sort(), ['incomplete', 'page_processed']);
  assert.ok(results.every(r => r.canSend === false));
});
