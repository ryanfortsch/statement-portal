/** Repeatable, synthetic acceptance rehearsal. Uses the production normalizer,
 * planner and retained-stay runtime with fake providers/stores. It neither
 * implements new-booking admission nor attests to native Airbnb delivery. */
import assert from 'node:assert/strict';
import { normalizeAirbnbBookingRevision } from '../../channex-bookings/revision.ts';
import { planCalderwoodSchedule } from '../../channex-messaging/schedule-plan.ts';
import { syntheticScheduleSnapshot, scheduleFixtureId as id } from './channex-schedule-snapshot.ts';
import { pilotRuntimeFixture } from './channex-pilot-runtime.ts';

const at = Date.parse('2026-11-12T16:00:00Z');
const mapping = { environment: 'staging' as const, propertyId: id(501), roomTypeId: id(502), ratePlanId: id(503), generation: 1 };
function revision(status: 'new' | 'modified' | 'cancelled', receivedAt: string) {
  return { id: id(504), attributes: { booking_id: id(505), property_id: mapping.propertyId,
    ota_name: 'Airbnb', ota_reservation_code: 'SYNTHETIC-REHEARSAL', status, inserted_at: receivedAt,
    arrival_date: '2026-11-24', departure_date: '2026-11-28', arrival_hour: '16:00',
    // Unsupported fields must never be promoted to authoritative clock evidence.
    confirmed_at: '2026-10-01T12:00:00Z', raw_message: 'PRIVATE-RAW-CONFIRMATION',
    rooms: [{ room_type_id: mapping.roomTypeId, rate_plan_id: mapping.ratePlanId,
      checkin_date: '2026-11-24', checkout_date: '2026-11-28' }],
    customer: { name: 'Synthetic', surname: 'Guest', mail: null, phone: null, address: null,
      city: null, state: null, country: null, zip: null }, notes: null } };
}
function plan(patch: Record<string, unknown> = {}, now = at) {
  const s = syntheticScheduleSnapshot(at);
  return planCalderwoodSchedule({ stay: { canonicalId: s.booking.id, status: 'confirmed', duplicateOf: null,
    clocks: { ...s.clocks, confirmedAt: null, ...patch } }, rules: s.capturedRules, ledger: [], now });
}
type Case = { name: string; run: () => void | Promise<void> };
export const newBookingRehearsalCases: Case[] = [
  {
    name: 'Provider creation, modification and cancellation do not supply original confirmation or override clocks',
    run() {
      for (const [status, stamp] of [['new', '2026-11-12T15:50:00Z'], ['modified', '2026-11-13T15:50:00Z'],
        ['cancelled', '2026-11-14T15:50:00Z']] as const) {
        const output = normalizeAirbnbBookingRevision(revision(status, stamp), mapping);
        assert.equal(output.status, status);
        assert.equal(Date.parse(output.providerReceivedAt), Date.parse(stamp));
        for (const key of ['confirmedAt', 'confirmed_at', 'plannedArrival', 'plannedDeparture', 'arrival_hour', 'raw_message'])
          assert.equal(Object.hasOwn(output, key), false);
        assert.equal(JSON.stringify(output).includes('PRIVATE-RAW'), false);
      }
      // The same payload can be first seen today or imported today. Normalization
      // has no supported field capable of proving it was newly booked today.
      assert.equal(Object.hasOwn(normalizeAirbnbBookingRevision(revision('new', '2026-11-12T15:50:00Z'), mapping), 'isNewBooking'), false);
    },
  },
  ...['missing', 'revision_receipt', 'raw_message', 'native_airbnb_timeline'].map(source => ({
    name: `Unsupported ${source} evidence cannot admit a new/imported booking to the retained runtime`,
    async run() {
      const f = pilotRuntimeFixture(), rpc = f.deps.rpc;
      f.deps.rpc = async (name, args) => {
        const result = await rpc(name, args);
        if (name === 'helm_channex_message_schedule_inputs') {
          const data = result.data as { binding: { evidence: unknown } };
          data.binding.evidence = source === 'missing' ? null : { kind: source, confirmedAt: new Date(at - 600_000).toISOString() };
        }
        return result;
      };
      // An empty Channex message history is not proof that native Airbnb has not
      // sent. Even repeated ticks cannot manufacture a replacement confirmation.
      for (let i = 0; i < 3; i++) {
        const result = await f.tick();
        assert.equal(result.ok, false); assert.equal(result.stays[0].state, 'review_required');
      }
      assert.equal(f.writes.length, 0); assert.equal(f.jobs.size, 0);
      assert.equal(f.credentials(), 0); assert.equal(f.counts().posts, 0); assert.equal(f.reads.length, 0);
    },
  })),
  {
    name: 'An absent override is unknown; a proposed default clock never supplies confirmation evidence',
    run() {
      const unknown = plan({ plannedArrival: undefined, plannedDeparture: undefined });
      assert.ok(unknown.every(p => p.state === 'timing_review' && p.fireAt === null));
      const proposed = plan({ plannedArrival: null, plannedDeparture: null });
      assert.equal(proposed[0].state, 'timing_review'); assert.equal(proposed[0].fireAt, null);
      assert.equal(proposed.find(p => p.key === 'checkin_day')!.fireAt, '2026-11-24T20:00:00.000Z');
      assert.ok(proposed.every(p => !p.canSend && !p.canSchedule));
    },
  },
  ...[['2027-03-14', '2027-03-18'], ['2027-11-07', '2027-11-11']].map(([start, end]) => ({
    name: `DST ${start}: day-based reminders stay unresolved while the relative key-code time is preserved`,
    run() {
      const rows = plan({ start, end });
      assert.equal(rows.find(p => p.key === 'cleaner_reminder')!.state, 'dst_review');
      assert.equal(rows.find(p => p.key === 'pre_arrival')!.state, 'dst_review');
      assert.equal(rows.find(p => p.key === 'checkin_day')!.state, 'future_candidate');
      assert.equal(rows[0].state, 'timing_review');
    },
  })),
  {
    name: 'Last-minute stays never replay past guest or cleaner reminders',
    run() {
      const rows = plan({}, Date.parse('2026-11-24T20:00:00Z'));
      assert.deepEqual(rows.map(p => p.state), ['timing_review', 'past_not_replayed', 'past_not_replayed',
        'future_candidate', 'past_not_replayed', 'past_not_replayed']);
      assert.ok(rows.every(p => !p.canSend && !p.canSchedule));
    },
  },
  {
    name: 'Early-arrival and late-departure wording conflicts block only the affected frozen workflows',
    run() {
      const rows = plan({ plannedArrival: '13:00', plannedDeparture: '13:00', confirmedAt: '2026-11-12T15:50:00Z' });
      assert.deepEqual(rows.map(p => p.state), ['wording_review', 'wording_review', 'future_candidate',
        'wording_review', 'future_candidate', 'wording_review']);
      assert.equal(rows.find(p => p.key === 'checkin_day')!.fireAt, '2026-11-24T17:00:00.000Z');
    },
  },
  ...['dates_changed', 'cancelled', 'duplicate', 'manual_hold'].map(change => ({
    name: `Previously reviewed stay ${change}: repeated due ticks cannot create or send a replacement`,
    async run() {
      const f = pilotRuntimeFixture();
      assert.equal((await f.tick()).ok, true); assert.equal(f.jobs.size, 4);
      f.time(at + 25 * 60_000);
      if (change === 'dates_changed') f.s.booking.start = '2026-11-25';
      if (change === 'cancelled') f.s.booking.status = 'cancelled';
      if (change === 'duplicate') f.s.booking.duplicateOf = id(999);
      if (change === 'manual_hold') f.s.ledger[0].status = 'awaiting_approval';
      const ledger = structuredClone(f.s.ledger);
      for (let i = 0; i < 3; i++) assert.equal((await f.tick()).ok, false);
      assert.equal(f.writes.length, 4); assert.equal(f.counts().claims, 0); assert.equal(f.counts().posts, 0);
      assert.deepEqual(f.s.ledger, ledger);
    },
  })),
  {
    name: 'An accepted provider POST with a lost response is attempted once across replay and cancellation',
    async run() {
      const f = pilotRuntimeFixture(); await f.tick(); f.time(at + 25 * 60_000);
      const fetcher = f.deps.fetcher;
      f.deps.fetcher = async (url, init) => {
        const response = await fetcher(url, init);
        if (init?.method === 'POST') throw Error('Synthetic response lost after acceptance');
        return response;
      };
      assert.equal((await f.tick()).stays[0].state, 'unknown');
      await f.tick(); f.s.booking.status = 'cancelled'; await f.tick();
      assert.equal(f.counts().posts, 1); assert.equal(f.counts().claims, 1);
      assert.equal(f.jobs.size, 4); assert.equal(f.writes.length, 4);
    },
  },
];

export async function runNewBookingRehearsal() {
  for (const scenario of newBookingRehearsalCases) await scenario.run();
  return { kind: 'synthetic_rehearsal', passed: newBookingRehearsalCases.length,
    checks: newBookingRehearsalCases.map(c => c.name), productionWrites: 0, realMessagesSent: 0,
    newBookingAdmissionImplemented: false, nativeAirbnbCompatibilityVerified: false, readyForCutover: false,
    remaining: ['Authoritative arrival/departure policy for new stays',
      'Controlled native Airbnb confirmation/coexistence test and explicit sender ownership',
      'Guesty in-flight dispatch clearance', 'Reviewed new-booking admission and live pilot'] };
}
