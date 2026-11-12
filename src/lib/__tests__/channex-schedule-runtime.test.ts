import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleRetainedCalderwoodStay } from '../channex-messaging/schedule-runtime.ts';
import { scheduleFixtureId as id } from './fixtures/channex-schedule-snapshot.ts';
import { retainedRuntimeFixture as fixture } from './fixtures/channex-retained-runtime.ts';

const at = Date.parse('2026-11-12T16:00:00.000Z');
const options = { enabled: true, expiresAfterMs: 1800_000 };
test('disabled and malformed runtime requests access nothing', async () => {
  const f = fixture();
  assert.equal((await scheduleRetainedCalderwoodStay(f.request, f.deps, { expiresAfterMs: 1800_000 })).state, 'disabled');
  for (const raw of [null, { ...f.request, bindingId: 'bad' }, { ...f.request, templateDigest: 'bad' }, { ...f.request, clocks: {} }])
    assert.equal((await scheduleRetainedCalderwoodStay(raw, f.deps, options)).state, 'invalid');
  assert.equal((await scheduleRetainedCalderwoodStay(f.request, f.deps, { ...options, expiresAfterMs: 0 })).state, 'invalid');
  assert.deepEqual(f.calls, []); assert.equal(f.credentials(), 0);
});
test('retained templates and timing -> fresh providers -> four atomic guest registrations; repeat creates none', async () => {
  const f = fixture(), out = await f.run();
  assert.equal(out.state, 'complete'); assert.equal(out.messagesSent, 0); assert.equal(out.canSend, false);
  assert.equal(out.providerReads, 40); assert.equal(f.writes.length, 4);
  assert.deepEqual(f.writes.map(p => [p.key, p.fireAt]), [
    ['booking_confirmed', '2026-11-12T16:20:00.000Z'], ['pre_arrival', '2026-11-23T21:00:00.000Z'],
    ['checkin_day', '2026-11-24T20:00:00.000Z'], ['pre_checkout', '2026-11-27T16:00:00.000Z']]);
  assert.ok(!JSON.stringify({ out, writes: f.writes }).includes('PRIVATE'));
  const second = await f.run(); assert.equal(second.state, 'complete'); assert.equal(f.writes.length, 4);
  assert.ok(second.outcomes.every(o => o.state === 'existing_schedule'));
});
test('missing scope, binding, archive or review snapshot stops without registrations or fallback evidence', async () => {
  for (const target of ['helm_channex_message_schedule_context', 'helm_channex_message_schedule_inputs',
    'helm_channex_read_template_capture', 'helm_channex_timing_review_snapshot']) {
    const f = fixture(), rpc = f.deps.rpc;
    f.deps.rpc = async (name, args) => name === target ? { data: null, error: null } : rpc(name, args);
    assert.equal((await f.run()).state, 'unavailable'); assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
  }
});
test('frozen templates are never released, edited or registered', async () => {
  const f = fixture(); f.s.currentRules = structuredClone(f.s.capturedRules);
  const out = await f.run(); assert.equal(out.state, 'complete');
  assert.ok(out.outcomes.every(o => o.state === 'release_required')); assert.equal(f.writes.length, 0);
});
test('changed clocks, latest revision, cancelled source or wrong thread prevents all writes', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.provider.v2.plannedArrival = '17:00'; },
    (f: ReturnType<typeof fixture>) => { f.provider.v3[0].status = 'cancelled'; },
    (f: ReturnType<typeof fixture>) => { f.provider.booking.data.attributes.revision_id = id(99); },
    (f: ReturnType<typeof fixture>) => { f.provider.thread.data.relationships.booking.data.id = id(99); },
    (f: ReturnType<typeof fixture>) => { f.review.capture.row.clocks.confirmedAt = new Date(at - 2000).toISOString(); },
  ]) {
    const f = fixture(); mutate(f); assert.equal((await f.run()).state, 'unavailable'); assert.equal(f.writes.length, 0);
  }
});
test('provider drift after first registration stops the remaining batch and preserves the first job', async () => {
  const f = fixture(), rpc = f.deps.rpc;
  f.deps.rpc = async (name, args) => { const r = await rpc(name, args);
    if (name === 'helm_channex_message_register') f.provider.v2.plannedDeparture = '12:00'; return r; };
  const out = await f.run(); assert.equal(out.state, 'unavailable');
  assert.equal(f.writes.length, 1); assert.equal(out.outcomes[0].state, 'created');
});
test('database changes while providers are read stop before registration', async () => {
  const f = fixture(), fetcher = f.deps.fetcher;
  f.deps.fetcher = async (url, init) => { const r = await fetcher(url, init);
    if (f.reads.length === 8) f.s.currentRules[0].body += ' changed'; return r; };
  assert.equal((await f.run()).state, 'unavailable'); assert.equal(f.writes.length, 0);
});
test('hold arriving during provider scan is reconciled from the fresh ledger', async () => {
  const f = fixture(), fetcher = f.deps.fetcher;
  f.deps.fetcher = async (url, init) => { const r = await fetcher(url, init);
    if (f.reads.length === 16) f.s.ledger.push({ id: id(88), booking_id: f.request.bookingId, property_id: '65_calderwood',
      automation_id: f.s.capturedRules[0].id, automation_key: 'booking_confirmed', fire_at: new Date(at).toISOString(),
      status: 'cancelled', planned_check_in: f.s.booking.start, planned_check_out: f.s.booking.end,
      sent_at: null, provider_message_id: null }); return r; };
  const out = await f.run(); assert.equal(out.state, 'complete'); assert.equal(out.outcomes[0].state, 'held');
  assert.equal(f.writes.length, 3);
});
test('uncertain registration is not retried and a committed job survives rerun', async () => {
  const f = fixture(), rpc = f.deps.rpc;
  f.deps.rpc = async (name, args) => { const r = await rpc(name, args);
    if (name === 'helm_channex_message_register') throw Error('PRIVATE committed timeout'); return r; };
  const out = await f.run(); assert.equal(out.state, 'uncertain'); assert.equal(f.writes.length, 1);
  f.deps.rpc = rpc; const recovered = await f.run();
  assert.equal(recovered.state, 'complete'); assert.equal(recovered.outcomes[0].state, 'existing_schedule'); assert.equal(f.writes.length, 4);
});
test('deadline, rollback, provider errors and private exceptions remain bounded and redacted', async () => {
  for (const failure of ['deadline', 'rollback', 'provider', 'rpc', 'credentials']) {
    const f = fixture(), fetcher = f.deps.fetcher;
    if (failure === 'rpc') f.deps.rpc = async () => { throw Error('PRIVATE'); };
    else if (failure === 'credentials') f.deps.credentials = async () => { throw Error('PRIVATE'); };
    else f.deps.fetcher = async (url, init) => {
      if (failure === 'provider') return Response.json({ errors: 'PRIVATE' }, { status: 429 });
      const r = await fetcher(url, init); f.time(failure === 'rollback' ? at - 1 : at + 60_000); return r; };
    const out = await f.run(); assert.equal(out.state, 'unavailable'); assert.equal(f.writes.length, 0);
    assert.ok(out.providerReads <= 40); assert.ok(!JSON.stringify(out).includes('PRIVATE'));
  }
});
