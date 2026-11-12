import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewCalderwoodTimingBinding } from '../channex-messaging/timing-provider-review.ts';
import { CALDERWOOD_PRODUCTION as mapping } from '../channex-production-preflight.ts';
import { syntheticScheduleSnapshot, syntheticTimingEvidence, scheduleFixtureId as id } from './fixtures/channex-schedule-snapshot.ts';
import { syntheticTimingProvider } from './fixtures/channex-timing-provider.ts';

const at = Date.parse('2026-11-12T16:00:00.000Z');
function fixture() {
  const context = { contextRevision: 'a'.repeat(32), routeGeneration: id(50), sourceEvidenceId: id(51),
    sourceEvidenceAt: new Date(at - 3600_000).toISOString() };
  const s = syntheticScheduleSnapshot(at), e = syntheticTimingEvidence(s, context, at);
  const request = { bindingId: id(70), captureId: e.captureId, bookingId: s.booking.id };
  const snapshot = { capture: { id: e.captureId, row: e.row, checkedAt: e.checkedAt,
    savedAt: new Date(at - 1000).toISOString(), sourceContract: e.sourceContract }, context,
    scope: { environment: 'production', propertyId: String(mapping.propertyId), channelId: id(52), provider: 'Airbnb' },
    route: { ...s.route, revisionId: id(53) } };
  const provider = syntheticTimingProvider(e.row, { ...snapshot.route, channelId: snapshot.scope.channelId });
  let loads = 0, keys = 0, saves = 0, now = at;
  const calls: { url: string; init?: RequestInit }[] = [];
  let intent: unknown;
  const deps = { clock: () => now,
    load: async () => { loads++; return structuredClone(snapshot); },
    credentials: async () => { keys++; return { guestyToken: 'synthetic-guesty-key', channexKey: 'synthetic-channex-key' }; },
    store: { bind: async (value: unknown) => { saves++; intent = value; return { state: 'created' as const, bindingId: request.bindingId, canSend: false as const }; } },
    fetcher: (async (url, init) => {
      calls.push({ url: String(url), init }); const path = new URL(String(url)).pathname;
      const body = path.includes('/reservations/') ? provider.v2 : path.endsWith('/reservations-v3') ? provider.v3
        : path.includes('/bookings/') ? provider.booking : path.includes('/message_threads/') ? provider.thread : null;
      assert.ok(body, 'Only the four expected read paths are allowed');
      return Response.json(body);
    }) as typeof fetch };
  return { request, snapshot, provider, deps, calls, counts: () => ({ loads, keys, saves }), intent: () => intent,
    time: (ms: number) => { now = ms; }, run: () => reviewCalderwoodTimingBinding(request, 'owner@synthetic.test', deps, { enabled: true }) };
}
test('review is off by default and rejects browser assertions before any reads', async () => {
  const f = fixture();
  assert.equal((await reviewCalderwoodTimingBinding(f.request, 'owner@synthetic.test', f.deps)).state, 'disabled');
  for (const raw of [null, { ...f.request, clocks: f.snapshot.capture.row.clocks }, { ...f.request, bookingId: '../escape' }])
    assert.equal((await reviewCalderwoodTimingBinding(raw, 'owner@synthetic.test', f.deps, { enabled: true })).state, 'invalid');
  assert.deepEqual(f.counts(), { loads: 0, keys: 0, saves: 0 }); assert.equal(f.calls.length, 0);
});
test('eight authenticated GETs bind exact retained clocks and latest booking/thread identity', async () => {
  const f = fixture(); const out = await f.run();
  assert.deepEqual(out, { state: 'created', bindingId: f.request.bindingId, sourceReads: 8, jobsCreated: 0, messagesSent: 0, canSend: false });
  assert.deepEqual(f.counts(), { loads: 2, keys: 1, saves: 1 });
  assert.deepEqual(f.intent(), { ...f.request, context: f.snapshot.context,
    remoteBookingId: f.snapshot.route.remoteBookingId, threadId: f.snapshot.route.threadId,
    reviewedRow: f.snapshot.capture.row, reviewStartedAt: new Date(at).toISOString(), reviewCheckedAt: new Date(at).toISOString() });
});
test('provider credentials stay on their fixed host, every request is bounded GET with no body', async () => {
  const f = fixture(); await f.run();
  for (const { url, init } of f.calls) {
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined); assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
    const headers = new Headers(init?.headers), guesty = new URL(url).hostname === 'open-api.guesty.com';
    assert.equal(new URL(url).origin, guesty ? 'https://open-api.guesty.com' : 'https://app.channex.io');
    assert.equal(headers.get('Authorization'), guesty ? 'Bearer synthetic-guesty-key' : null);
    assert.equal(headers.get('user-api-key'), guesty ? null : 'synthetic-channex-key');
  }
});
test('wrong or missing stored identity, unsupported scope, dates and chronology never read providers', async () => {
  const mutations = [
    (s: ReturnType<typeof fixture>['snapshot']) => { s.capture.id = id(98); },
    (s: ReturnType<typeof fixture>['snapshot']) => { s.capture.row.bookingId = id(98); },
    (s: ReturnType<typeof fixture>['snapshot']) => { s.scope.propertyId = id(98); },
    (s: ReturnType<typeof fixture>['snapshot']) => { s.scope.environment = 'staging'; },
    (s: ReturnType<typeof fixture>['snapshot']) => { s.capture.row.end = s.capture.row.start; },
    (s: ReturnType<typeof fixture>['snapshot']) => { s.capture.savedAt = new Date(at + 1).toISOString(); },
    (s: ReturnType<typeof fixture>['snapshot']) => { s.context.sourceEvidenceAt = new Date(at + 1).toISOString(); },
    (s: ReturnType<typeof fixture>['snapshot']) => { s.capture.checkedAt = s.capture.row.clocks.confirmedAt.replace('2026', '2025'); },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f.snapshot); assert.equal((await f.run()).state, 'unavailable');
    assert.equal(f.calls.length, 0); assert.equal(f.counts().saves, 0); }
  const f = fixture(); f.deps.load = async () => null as never;
  assert.equal((await f.run()).state, 'unavailable'); assert.equal(f.calls.length, 0);
});
test('provider clocks, cancellation, latest revision, room/rate and thread mismatches cannot bind', async () => {
  const mutations = [
    (p: ReturnType<typeof fixture>['provider']) => { p.v2.plannedArrival = '17:00'; },
    (p: ReturnType<typeof fixture>['provider']) => { delete (p.v2 as Partial<typeof p.v2>).plannedDeparture; },
    (p: ReturnType<typeof fixture>['provider']) => { p.v2.accountId = 'f'.repeat(24); },
    (p: ReturnType<typeof fixture>['provider']) => { p.v3[0].confirmedAt = new Date(at).toISOString(); },
    (p: ReturnType<typeof fixture>['provider']) => { p.v3[0].status = 'cancelled'; },
    (p: ReturnType<typeof fixture>['provider']) => { p.v3.push(p.v3[0]); },
    (p: ReturnType<typeof fixture>['provider']) => { p.booking.data.attributes.status = 'cancelled'; },
    (p: ReturnType<typeof fixture>['provider']) => { p.booking.data.attributes.revision_id = id(99); },
    (p: ReturnType<typeof fixture>['provider']) => { p.booking.data.attributes.ota_reservation_code = 'OTHER'; },
    (p: ReturnType<typeof fixture>['provider']) => { p.booking.data.attributes.rooms[0].rate_plan_id = id(99); },
    (p: ReturnType<typeof fixture>['provider']) => { p.thread.data.relationships.booking.data.id = id(99); },
    (p: ReturnType<typeof fixture>['provider']) => { p.thread.data.relationships.channel.data.id = id(99); },
    (p: ReturnType<typeof fixture>['provider']) => { p.thread.data.relationships.property.data.type = 'channel'; },
    (p: ReturnType<typeof fixture>['provider']) => { p.thread.data.attributes.is_closed = true; },
    (p: ReturnType<typeof fixture>['provider']) => { p.thread.data.attributes.provider = 'BookingCom'; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f.provider);
    assert.ok(['changed', 'unavailable'].includes((await f.run()).state)); assert.equal(f.counts().saves, 0); }
});
test('drift on the second provider scan and final context read refuses the entire review', async () => {
  for (const mode of ['guesty', 'thread', 'context', 'route', 'capture']) {
    const f = fixture(), fetcher = f.deps.fetcher, load = f.deps.load;
    f.deps.fetcher = async (url, init) => {
      if (f.calls.length === 4 && mode === 'guesty') f.provider.v2.plannedDeparture = '12:00';
      if (f.calls.length === 7 && mode === 'thread') f.provider.thread.data.relationships.channel.data.id = id(99);
      return fetcher(url, init);
    };
    f.deps.load = async () => { const s = await load(); if (f.calls.length) {
      if (mode === 'context') s.context.contextRevision = 'b'.repeat(32);
      if (mode === 'route') s.route.threadId = id(99);
      if (mode === 'capture') s.capture.row.code = 'CHANGED';
    } return s; };
    assert.equal((await f.run()).state, 'changed'); assert.equal(f.counts().saves, 0);
  }
});
test('errors, redirects, invalid JSON, oversized streams and warnings redact data and never save', async () => {
  const variants = [
    () => Response.json({ errors: 'PRIVATE' }, { status: 401 }),
    () => new Response('PRIVATE', { status: 302, headers: { Location: 'https://invalid.test/' } }),
    () => new Response('PRIVATE'),
    () => new Response('x'.repeat(2_000_001)),
    () => Response.json({ errors: 'PRIVATE' }),
    () => Response.json({ meta: { warnings: ['PRIVATE'] } }),
  ];
  for (const response of variants) { const f = fixture(); f.deps.fetcher = async () => response();
    const out = await f.run(); assert.equal(out.state, 'unavailable'); assert.equal(f.counts().saves, 0);
    assert.ok(!JSON.stringify(out).includes('PRIVATE')); }
  const f = fixture(); f.deps.fetcher = async () => { throw Error('PRIVATE'); };
  assert.equal((await f.run()).state, 'unavailable'); assert.equal(f.counts().saves, 0);
});
test('clock rollback, deadline expiry, midnight and invalid credentials stop before persistence', async () => {
  for (const end of [at - 1, at + 80_000, Date.parse('2026-11-13T05:00:00Z'), NaN]) {
    const f = fixture(), fetcher = f.deps.fetcher;
    f.deps.fetcher = async (url, init) => { const r = await fetcher(url, init); f.time(end); return r; };
    assert.equal((await f.run()).state, 'unavailable'); assert.equal(f.counts().saves, 0);
  }
  const f = fixture(); f.deps.credentials = async () => ({ guestyToken: 'key\nPRIVATE', channexKey: 'key' });
  assert.equal((await f.run()).state, 'unavailable'); assert.equal(f.calls.length, 0);
});
test('Channex warnings and error envelopes reject otherwise valid booking/thread responses', async () => {
  for (const path of ['/bookings/', '/message_threads/']) for (const envelope of [
    { errors: [] }, { meta: { warnings: ['PRIVATE'] } }, { meta: { warnings: null } },
  ]) {
    const f = fixture(), fetcher = f.deps.fetcher;
    f.deps.fetcher = async (url, init) => { const r = await fetcher(url, init);
      return String(url).includes(path) ? Response.json({ ...await r.json(), ...envelope }) : r; };
    assert.equal((await f.run()).state, 'unavailable'); assert.equal(f.counts().saves, 0);
  }
});
test('irrelevant private data is discarded and uncertain persistence is never retried', async () => {
  const f = fixture(), fetcher = f.deps.fetcher;
  f.deps.fetcher = async (url, init) => { const r = await fetcher(url, init), body = await r.json();
    if (!Array.isArray(body)) body.private_customer = 'PRIVATE-GUEST-BODY-KEY';
    return Response.json(body); };
  assert.equal((await f.run()).state, 'created'); assert.ok(!JSON.stringify(f.intent()).includes('PRIVATE'));
  let attempts = 0;
  f.deps.store.bind = async () => { attempts++; throw Error('PRIVATE save may have committed'); };
  const out = await f.run(); assert.equal(out.state, 'uncertain'); assert.equal(attempts, 1);
  assert.equal(out.bindingId, f.request.bindingId); assert.ok(!JSON.stringify(out).includes('PRIVATE'));
});
