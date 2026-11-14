import test from 'node:test';
import assert from 'node:assert/strict';
import { newStayClocks } from '../channex-messaging/new-stay-clocks.ts';
import { CALDERWOOD_NEW_STAY_POLICY as policy } from '../channex-messaging/new-stay-policy.ts';
import { createNewStayStore } from '../channex-messaging/new-stay-store.ts';
import { reviewCalderwoodTiming } from '../channex-messaging/preparation-timing.ts';
import { runProductionBookingTick } from '../channex-bookings/runtime.ts';
import { normalizeAirbnbBookingRevision } from '../channex-bookings/revision.ts';
import { CALDERWOOD_PRODUCTION as m } from '../channex-production-preflight.ts';
import { intakeEnv, intakeHarness, intakeId as id, intakeRow } from './fixtures/channex-booking-intake.ts';

const at = Date.parse('2026-11-13T13:01:00Z');
const stay = { id: id(900), start: '2026-11-24', end: '2026-11-28' };
const clocks = () => ({ policy: policy.id, bookingId: stay.id, start: stay.start, end: stay.end,
  exception: null, checkoutAdjustment: null });
function stored() {
  const raw = intakeRow();
  Object.assign(raw.attributes, { arrival_date: stay.start, departure_date: stay.end });
  Object.assign(raw.attributes.rooms[0], { checkin_date: stay.start, checkout_date: stay.end });
  const receipt = { canonicalBookingId: stay.id, outcome: 'applied', committed: true,
    committedAt: '2026-11-13T13:00:02.000000Z', firstReceivedAt: '2026-11-13T13:00:00.123456Z',
    revision: normalizeAirbnbBookingRevision(raw, { environment: 'production', propertyId: m.propertyId,
      roomTypeId: m.roomTypeId, ratePlanId: m.ratePlanId, generation: 1 }) };
  return { format: 1, observedAt: new Date(at).toISOString(), epochId: id(700), bookingId: stay.id,
    remoteBookingId: receipt.revision.bookingId, routeGeneration: id(701), sourceEvidenceId: id(702),
    firstReceipt: receipt, currentReceipt: structuredClone(receipt), clocks: clocks() };
}

test('approved defaults produce the existing 3 PM code and 9 AM cleaner reminder without invented confirmation', () => {
  const resolved = newStayClocks(clocks(), stay);
  const rows = reviewCalderwoodTiming(resolved, at);
  assert.equal(resolved.confirmedAt, null);
  assert.equal(rows.find(x => x.key === 'checkin_day')!.at, '2026-11-24T20:00:00.000Z');
  assert.equal(rows.find(x => x.key === 'cleaner_arrival')!.at, '2026-11-24T14:00:00.000Z');
  assert.equal(rows.find(x => x.key === 'booking_confirmed')!.status, 'unverified');
});
test('explicit arrival/departure exceptions and active checkout adjustment are authoritative', () => {
  const exception = { id: id(704), start: stay.start, end: stay.end, arrival: '13:00', departure: '12:30' };
  const resolved = newStayClocks({ ...clocks(), exception }, stay);
  assert.equal(reviewCalderwoodTiming(resolved, at).find(x => x.key === 'checkin_day')!.at, '2026-11-24T17:00:00.000Z');
  assert.equal(resolved.plannedDeparture, '12:30');
  const checkoutAdjustment = { id: id(705), start: stay.start, originalEnd: stay.end, end: null, departure: '13:00' };
  assert.equal(newStayClocks({ ...clocks(), checkoutAdjustment }, stay).plannedDeparture, '13:00');
  assert.throws(() => newStayClocks({ ...clocks(), exception, checkoutAdjustment }, stay));
});
test('missing reads, stale exceptions, changed dates and malformed clocks never fall back to defaults', () => {
  const exception = { id: id(704), start: stay.start, end: stay.end, arrival: '13:00', departure: null };
  for (const patch of [{ exception: undefined }, { checkoutAdjustment: undefined }, { policy: 'guesty' },
    { bookingId: id(999) }, { exception: { ...exception, start: '2026-11-23' } },
    { exception: { ...exception, arrival: '25:00' } }, { exception: { ...exception, arrival: '4 PM' } },
    { checkoutAdjustment: { id: id(705), start: stay.start, originalEnd: stay.end, end: '2026-11-29', departure: null } }])
    assert.throws(() => newStayClocks({ ...clocks(), ...patch }, stay));
});
test('DST ambiguity remains a review; receipt policy does not silently choose day semantics', () => {
  const changed = { ...stay, start: '2027-03-14', end: '2027-03-18' };
  const rows = reviewCalderwoodTiming(newStayClocks({ ...clocks(), start: changed.start, end: changed.end }, changed), at);
  assert.equal(rows.find(x => x.key === 'pre_arrival')!.status, 'dst_review');
  assert.equal(rows.find(x => x.key === 'checkin_day')!.status, 'future');
});
test('dormant store performs no IO, even with invalid inputs', async () => {
  const store = createNewStayStore(async () => { throw Error('must not run'); });
  assert.equal((await store.admit()).state, 'disabled');
  assert.equal(await store.load('wrong'), null);
  assert.equal((await store.saveClocks({}, '')).state, 'disabled');
});
test('trusted persisted admission joins current clocks to exact receipt policy without Guesty evidence', async () => {
  const s = stored();
  const store = createNewStayStore(async (name, args) => {
    assert.equal(name, 'helm_channex_new_stay_read'); assert.deepEqual(args, { p_booking: stay.id });
    return { data: s, error: null };
  }, { enabled: true });
  const read = await store.load(stay.id, () => at);
  assert.equal(read!.confirmation.fireAt, '2026-11-13T13:30:00.124Z');
  assert.equal(read!.clocks.confirmedAt, null);
  assert.equal(Object.hasOwn(read!, 'timingEvidence'), false);
});
test('unusable snapshots, future observations and changed receipt identity are rejected', async () => {
  for (const mutate of [(s: ReturnType<typeof stored>) => { s.bookingId = id(88); },
    (s: ReturnType<typeof stored>) => { s.currentReceipt.revision.bookingId = id(88); },
    (s: ReturnType<typeof stored>) => { s.observedAt = new Date(at + 1).toISOString(); },
    (s: ReturnType<typeof stored>) => { s.observedAt = new Date(at - 30001).toISOString(); },
    (s: ReturnType<typeof stored>) => { s.currentReceipt.revision.status = 'cancelled'; }]) {
    const s = stored(); mutate(s);
    const store = createNewStayStore(async () => ({ data: s, error: null }), { enabled: true });
    await assert.rejects(store.load(stay.id, () => at), /inputs unavailable/);
  }
});
test('lost admission response is uncertain and exposes no SQL or customer payload', async () => {
  const store = createNewStayStore(async () => { throw Error('PRIVATE_SENTINEL'); }, { enabled: true });
  assert.deepEqual(await store.admit(), { state: 'uncertain', admitted: null, canSend: false });
});
test('clock saves validate identity, keep stable retries, and never grant sending', async () => {
  const change = { id: id(710), bookingId: stay.id, replaces: null, start: stay.start, end: stay.end, arrival: '13:00', departure: null };
  const calls: unknown[] = [];
  const store = createNewStayStore(async (name, args) => { calls.push({ name, args });
    return { data: { state: 'existing', id: change.id }, error: null }; }, { enabled: true });
  assert.equal((await store.saveClocks({ ...change, arrival: '30:00' }, 'owner')).state, 'invalid');
  assert.equal(calls.length, 0);
  assert.deepEqual(await store.saveClocks(change, ' owner '), { state: 'existing', id: change.id });
  assert.deepEqual(calls, [{ name: 'helm_channex_new_stay_clock_save', args: { p_change: change, p_actor: 'owner' } }]);
});
test('optional admission runs after ACK and on empty-feed recovery; default and invalid modes never enroll', async () => {
  for (const mode of [undefined, '', 'off', 'calderwood-v1']) {
    const f = intakeHarness(), rpc = f.rpc; let admissions = 0;
    const wrapped: Parameters<typeof runProductionBookingTick>[1]['rpc'] = async (name, args, signal) => {
      if (name === 'helm_channex_new_stays_admit') { admissions++; assert.equal(f.acked.size, 1);
        return { data: { state: 'complete', admitted: 1, canSend: false }, error: null }; }
      return rpc(name, args, signal);
    };
    const env = { ...intakeEnv, HELM_CHANNEX_NEW_STAYS_MODE: mode };
    assert.equal((await runProductionBookingTick(env, { ...f, rpc: wrapped })).ok, true);
    assert.equal((await runProductionBookingTick(env, { ...f, rpc: wrapped })).ok, true);
    assert.equal(admissions, mode === 'calderwood-v1' ? 2 : 0);
  }
  const f = intakeHarness();
  assert.equal((await runProductionBookingTick({ ...intakeEnv, HELM_CHANNEX_NEW_STAYS_MODE: 'auto' }, f)).state, 'configuration_required');
  assert.deepEqual(f.events, []);
});
test('admission failure cannot undo a committed booking or ACK, and a later tick retries only admission', async () => {
  const f = intakeHarness(), rpc = f.rpc; let attempts = 0;
  f.rpc = async (name, args, signal) => {
    if (name === 'helm_channex_new_stays_admit') { attempts++; throw Error('PRIVATE_SENTINEL'); }
    return rpc(name, args, signal);
  };
  const env = { ...intakeEnv, HELM_CHANNEX_NEW_STAYS_MODE: 'calderwood-v1' };
  for (let i = 0; i < 2; i++) {
    const r = await runProductionBookingTick(env, f);
    assert.equal(r.ok, false); assert.ok('admissions' in r); assert.equal(r.admissions.state, 'uncertain');
    assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
  }
  assert.equal(attempts, 2); assert.equal(f.receipts.size, 1); assert.equal(f.acked.size, 1);
});
