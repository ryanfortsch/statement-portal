import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewNewAirbnbConfirmation, type NewAirbnbOrigin } from '../channex-messaging/new-booking-confirmation.ts';
import { planCalderwoodSchedule, planNewAirbnbSchedule, type ScheduleLedgerRow } from '../channex-messaging/schedule-plan.ts';
import { CALDERWOOD_NEW_CONFIRMATION_POLICY } from '../channex-messaging/confirmation-policy.ts';
import { normalizeAirbnbBookingRevision } from '../channex-bookings/revision.ts';
import type { AirbnbBookingReceipt } from '../channex-bookings/ingestion.ts';
import { CALDERWOOD_PRODUCTION as mapping } from '../channex-production-preflight.ts';
import { intakeRow, intakeId as id } from './fixtures/channex-booking-intake.ts';
import { syntheticScheduleSnapshot } from './fixtures/channex-schedule-snapshot.ts';
import { pilotRuntimeFixture } from './fixtures/channex-pilot-runtime.ts';

const now = Date.parse('2026-11-13T13:01:00Z');
const map = { environment: 'production' as const, propertyId: mapping.propertyId,
  roomTypeId: mapping.roomTypeId, ratePlanId: mapping.ratePlanId, generation: 1 };
function fixture() {
  const s = syntheticScheduleSnapshot(now), raw = intakeRow();
  Object.assign(raw.attributes, { arrival_date: s.clocks.start, departure_date: s.clocks.end });
  Object.assign(raw.attributes.rooms[0], { checkin_date: s.clocks.start, checkout_date: s.clocks.end });
  const first: AirbnbBookingReceipt = { revision: normalizeAirbnbBookingRevision(raw, map), canonicalBookingId: s.booking.id,
    outcome: 'applied', committed: true, committedAt: '2026-11-13T13:00:02.000000Z', firstReceivedAt: '2026-11-13T13:00:00.123456Z' };
  const current = structuredClone(first);
  const input = { origin: 'verified_new' as NewAirbnbOrigin, firstReceipt: first, currentReceipt: current, now,
    stay: { id: s.booking.id, remoteBookingId: first.revision.bookingId, code: first.revision.reservationCode,
      start: s.clocks.start, end: s.clocks.end, status: 'confirmed', duplicateOf: null as string | null } };
  const planInput = { stay: { canonicalId: s.booking.id, status: 'confirmed', duplicateOf: null as string | null, clocks: s.clocks },
    rules: s.capturedRules, ledger: [] as ScheduleLedgerRow[], now,
    confirmation: { origin: input.origin, remoteBookingId: input.stay.remoteBookingId, code: input.stay.code,
      firstReceipt: first, currentReceipt: current } };
  return { s, first, current, input, planInput };
}

test('approved clock is first durable Helm receipt plus 30 minutes, rounded up from SQL microseconds', () => {
  const f = fixture(), review = reviewNewAirbnbConfirmation(f.input);
  assert.deepEqual(review, { policy: CALDERWOOD_NEW_CONFIRMATION_POLICY.id, anchor: 'helm_first_received_at',
    state: 'future_candidate', firstReceivedAt: f.first.firstReceivedAt, fireAt: '2026-11-13T13:30:00.124Z',
    canSchedule: false, canSend: false });
  assert.equal(Object.hasOwn(review, 'confirmedAt'), false);
  assert.equal(Object.isFrozen(CALDERWOOD_NEW_CONFIRMATION_POLICY), true);
  assert.equal(JSON.stringify(review).includes('synthetic@example.invalid'), false);
});

test('exact milliseconds are not rounded forward; microsecond carry moves safely into the next second/day', () => {
  for (const [stamp, expected] of [
    ['2026-11-13T13:00:00.123000Z', '2026-11-13T13:30:00.123Z'],
    ['2026-11-12T23:59:59.999999Z', '2026-11-13T00:30:00.000Z'],
  ]) {
    const f = fixture(); f.first.firstReceivedAt = stamp; f.current.firstReceivedAt = stamp;
    assert.equal(reviewNewAirbnbConfirmation(f.input).fireAt, expected);
  }
});

test('confirmation delay is 30 elapsed minutes across both daylight-saving changes', () => {
  for (const [stamp, expected] of [['2027-03-14T06:50:00.000000Z', '2027-03-14T07:20:00.000Z'],
    ['2027-11-07T05:50:00.000000Z', '2027-11-07T06:20:00.000Z']]) {
    const f = fixture();
    for (const r of [f.first, f.current]) { r.firstReceivedAt = stamp; r.committedAt = stamp; }
    const p = reviewNewAirbnbConfirmation({ ...f.input, now: Date.parse(stamp) + 60_000 });
    assert.equal(p.state, 'future_candidate'); assert.equal(p.fireAt, expected);
    assert.equal(Date.parse(p.fireAt!) - Date.parse(stamp), 30 * 60_000);
  }
});

test('retries, later observations and modification commit times never reset the clock', () => {
  const f = fixture(), original = reviewNewAirbnbConfirmation(f.input).fireAt;
  f.current.revision.revisionId = id(2); f.current.revision.status = 'modified';
  f.current.revision.providerReceivedAt = '2026-11-13T13:00:30.000000Z';
  f.current.committedAt = '2026-11-13T13:00:31.000000Z';
  f.current.revision.checkIn = '2026-11-25'; f.input.stay.start = '2026-11-25';
  for (let minutes = 0; minutes < 50; minutes++) {
    const r = reviewNewAirbnbConfirmation({ ...f.input, now: now + minutes * 60_000 });
    assert.equal(r.fireAt, original);
    assert.equal(r.state, minutes < 30 ? 'future_candidate' : 'past_not_replayed');
    assert.equal(r.canSchedule, false);
  }
});

test('past and exactly due confirmations never get bootstrapped into a new schedule', () => {
  const f = fixture(), fire = Date.parse(reviewNewAirbnbConfirmation(f.input).fireAt!);
  for (const at of [fire, fire + 1, fire + 86400_000]) {
    f.planInput.now = at;
    const p = planNewAirbnbSchedule(f.planInput);
    assert.equal(p.confirmation.state, 'past_not_replayed');
    assert.equal(p.workflows[0].state, 'past_not_replayed');
    assert.equal(p.workflows[0].fireAt, new Date(fire).toISOString());
  }
});

test('provider new status or receipt existence alone cannot establish a verified new booking', () => {
  const f = fixture();
  for (const origin of ['unverified', 'retained_or_imported', undefined, null, true, 'new']) {
    const p = planNewAirbnbSchedule({ ...f.planInput, confirmation: { ...f.planInput.confirmation, origin: origin as NewAirbnbOrigin } });
    assert.equal(p.confirmation.state, 'origin_review');
    assert.equal(p.workflows[0].state, 'timing_review');
    assert.equal(p.workflows[0].fireAt, null);
    assert.equal(p.canSchedule, false);
  }
});

const invalidReceipts: [string, (f: ReturnType<typeof fixture>) => void][] = [
  ['first receipt is a modification', f => { f.first.revision.status = 'modified'; }],
  ['first receipt is stale', f => { f.first.outcome = 'stale'; }],
  ['current receipt is stale', f => { f.current.outcome = 'stale'; }],
  ['latest receipt is cancelled', f => { f.current.revision.status = 'cancelled'; }],
  ['canonical booking differs', f => { f.current.canonicalBookingId = id(999); }],
  ['remote booking differs', f => { f.current.revision.bookingId = id(999); }],
  ['confirmation code differs', f => { f.current.revision.reservationCode = 'DIFFERENT'; }],
  ['other property', f => { f.current.revision.propertyId = id(999); }],
  ['other room', f => { f.current.revision.roomTypeId = id(999); }],
  ['other rate', f => { f.current.revision.ratePlanId = id(999); }],
  ['staging receipt', f => { f.current.revision.environment = 'staging'; }],
  ['changed generation', f => { f.current.revision.mappingGeneration = 2; }],
  ['changed first receipt clock', f => { f.current.firstReceivedAt = '2026-11-13T13:00:00.123457Z'; }],
  ['future commit by one microsecond', f => { f.current.committedAt = '2026-11-13T13:01:00.000001Z'; }],
  ['commit precedes first receipt', f => { f.current.committedAt = '2026-11-13T12:59:59.999999Z'; }],
  ['same revision changed', f => { f.current.committedAt = '2026-11-13T13:00:03.000000Z'; }],
  ['same provider timestamp for different revisions', f => { f.current.revision.revisionId = id(999); }],
  ['older current revision', f => { f.current.revision.providerReceivedAt = '2026-11-13T11:00:00.000000Z'; }],
  ['booking dates differ', f => { f.current.revision.checkIn = '2026-11-25'; }],
  ['unknown clock', f => { f.first.firstReceivedAt = ''; }],
  ['nonexistent date', f => { f.first.firstReceivedAt = '2026-02-30T13:00:00Z'; }],
  ['uncommitted receipt', f => { Object.assign(f.first, { committed: false }); }],
  ['unexpected raw data', f => { Object.assign(f.first, { raw_message: 'PRIVATE' }); }],
];
for (const [name, change] of invalidReceipts) test(`receipt clock refuses ${name}`, () => {
  const f = fixture(); change(f);
  const p = reviewNewAirbnbConfirmation(f.input);
  assert.equal(p.state, 'receipt_review'); assert.equal(p.fireAt, null);
  assert.equal(p.canSend, false); assert.equal(p.canSchedule, false);
});

test('cancelled, superseded, inquiry and duplicate canonical stays remain inactive', () => {
  for (const patch of [{ status: 'cancelled' }, { status: 'inquiry' }, { status: 'completed' }, { duplicateOf: id(99) }]) {
    const f = fixture(); Object.assign(f.planInput.stay, patch);
    assert.ok(planNewAirbnbSchedule(f.planInput).workflows.every(p => p.state === 'stay_inactive'));
  }
});

test('receipt policy changes only confirmation; all five other workflow times and DST/wording decisions stay identical', () => {
  for (const patch of [{}, { start: '2027-03-14', end: '2027-03-18' }, { start: '2027-11-07', end: '2027-11-11' },
    { plannedArrival: '13:00', plannedDeparture: '13:00' }, { plannedArrival: undefined, plannedDeparture: undefined }]) {
    const f = fixture(); Object.assign(f.planInput.stay.clocks, patch);
    const old = planCalderwoodSchedule(f.planInput), p = planNewAirbnbSchedule(f.planInput);
    assert.deepEqual(p.workflows.slice(1), old.slice(1));
    assert.equal(p.canSend, false); assert.equal(p.canSchedule, false);
  }
  const f = fixture(), before = structuredClone(f.planInput);
  const p = planNewAirbnbSchedule(f.planInput);
  assert.notEqual(p.workflows[0].fireAt, planCalderwoodSchedule(f.planInput)[0].fireAt);
  assert.equal(p.workflows[2].fireAt, '2026-11-24T20:00:00.000Z'); // 3 PM EST
  assert.deepEqual(f.planInput, before); // No relabeling or mutation of confirmedAt.
});

test('existing sent, uncertain, held and scheduled history survives the new clock policy', () => {
  const f = fixture(), fireAt = reviewNewAirbnbConfirmation(f.input).fireAt!;
  for (const [status, state] of [['sent', 'already_sent'], ['sending', 'delivery_uncertain'], ['failed', 'delivery_uncertain'],
    ['awaiting_approval', 'held'], ['cancelled', 'held'], ['scheduled', 'existing_schedule']] as const) {
    f.planInput.ledger = [{ id: id(300), booking_id: f.s.booking.id, property_id: '65_calderwood',
      automation_id: f.s.capturedRules[0].id, automation_key: 'booking_confirmed', fire_at: fireAt, status,
      planned_check_in: f.s.clocks.start, planned_check_out: f.s.clocks.end, sent_at: null, provider_message_id: null }];
    assert.equal(planNewAirbnbSchedule(f.planInput).workflows[0].state, state);
  }
  f.planInput.ledger[0].fire_at = new Date(Date.parse(fireAt) + 1).toISOString();
  assert.equal(planNewAirbnbSchedule(f.planInput).workflows[0].state, 'schedule_changed');
  f.planInput.ledger.push({ ...f.planInput.ledger[0], id: id(301) });
  assert.equal(planNewAirbnbSchedule(f.planInput).workflows[0].state, 'history_conflict');
});

test('receipt-based approval cannot impersonate retained Guesty evidence or reach its sender', async () => {
  const f = pilotRuntimeFixture(), rpc = f.deps.rpc;
  f.deps.rpc = async (name, args) => {
    const response = await rpc(name, args);
    if (name === 'helm_channex_message_schedule_inputs') {
      (response.data as { binding: { evidence: unknown } }).binding.evidence = reviewNewAirbnbConfirmation(fixture().input);
    }
    return response;
  };
  assert.equal((await f.tick()).stays[0].state, 'review_required');
  assert.equal(f.writes.length, 0); assert.equal(f.counts().posts, 0); assert.equal(f.credentials(), 0);
});
