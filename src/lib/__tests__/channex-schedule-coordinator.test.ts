import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerCalderwoodStaySchedules as run } from '../channex-messaging/schedule-coordinator.ts';
import type { ScheduleRegistration, ScheduleRegistrationResult } from '../channex-messaging/schedule-store.ts';
import type { ScheduleLedgerRow } from '../channex-messaging/schedule-plan.ts';
import { syntheticScheduleSnapshot, syntheticTimingEvidence, scheduleFixtureId as id } from './fixtures/channex-schedule-snapshot.ts';

const instant = Date.parse('2026-11-11T16:00:00Z');
const options = { enabled: true, expiresAfterMs: 1800_000 };
function harness() {
  const snapshot = syntheticScheduleSnapshot(instant), writes: ScheduleRegistration[] = [];
  const context = { contextRevision: 'a'.repeat(32), routeGeneration: id(50), sourceEvidenceId: id(51),
    sourceEvidenceAt: '2026-11-10T12:00:00Z' };
  snapshot.timingEvidence = syntheticTimingEvidence(snapshot, context, instant);
  let reads = 0, time = instant;
  const deps = {
    now: () => time,
    load: async () => { reads++; return structuredClone(snapshot); },
    store: {
      context: async () => ({ ...context }),
      register: async (raw: unknown): Promise<ScheduleRegistrationResult> => {
        const p = structuredClone(raw) as ScheduleRegistration; writes.push(p);
        snapshot.ledger.push({ id: p.sendId, booking_id: p.bookingId, property_id: '65_calderwood',
          automation_id: p.automationId, automation_key: p.key, fire_at: p.fireAt, status: 'scheduled',
          planned_check_in: snapshot.booking.start, planned_check_out: snapshot.booking.end,
          sent_at: null, provider_message_id: null });
        return { state: 'created', sendId: p.sendId, canSend: false };
      },
    },
  };
  return { snapshot, writes, context, deps, reads: () => reads, time: (n: number) => { time = n; } };
}
test('default off and invalid requests perform no reads or writes', async () => {
  const h = harness();
  assert.equal((await run(id(1), h.deps, { expiresAfterMs: 1800_000 })).state, 'disabled');
  for (const expiry of [0, -1, NaN, 86_400_001, 1.5])
    assert.equal((await run(id(1), h.deps, { enabled: true, expiresAfterMs: expiry })).state, 'invalid');
  assert.equal((await run('bad', h.deps, options)).state, 'invalid');
  assert.equal(h.reads(), 0); assert.equal(h.writes.length, 0);
});
test('four guest times preserve source offsets; clean secrets before persistence and return', async () => {
  const h = harness(); h.snapshot.merge.check_in_long = 'Wrong caller date';
  const r = await run(id(1), h.deps, options);
  assert.equal(r.state, 'complete'); assert.equal(r.canSend, false);
  assert.deepEqual(h.writes.map(p => [p.key, p.fireAt]), [
    ['booking_confirmed', '2026-11-11T16:20:00.000Z'], ['pre_arrival', '2026-11-23T21:00:00.000Z'],
    ['checkin_day', '2026-11-24T20:00:00.000Z'], ['pre_checkout', '2026-11-27T16:00:00.000Z']]);
  const expected = 'Hello Synthetic Guest,\nArrival Nov 24th, 2026; departure Nov 28th, 2026.';
  assert.equal(h.writes[1].bodySha256, createHash('sha256').update(expected).digest('hex'));
  assert.ok(h.writes.every(p => Date.parse(p.expiresAt) - Date.parse(p.fireAt) === options.expiresAfterMs));
  assert.equal(JSON.stringify({ r, writes: h.writes }).includes('SYNTHETIC'), false);
  assert.equal(new Set(h.writes.map(p => p.sendId)).size, 4);
  const rerun = await run(id(1), h.deps, options);
  assert.ok(rerun.outcomes.every(o => o.state === 'existing_schedule')); assert.equal(h.writes.length, 4);
});
test('missing active scope fails before loading private message inputs', async () => {
  const h = harness(); h.deps.store.context = async () => { throw Error('PRIVATE_DATABASE_DETAIL'); };
  assert.deepEqual(await run(id(1), h.deps, options), { state: 'unavailable', outcomes: [], canSend: false });
  assert.equal(h.reads(), 0); assert.equal(h.writes.length, 0);
});
test('frozen rules remain unschedulable and are never changed by the coordinator', async () => {
  const h = harness(); h.snapshot.currentRules = structuredClone(h.snapshot.capturedRules);
  const before = structuredClone(h.snapshot);
  const r = await run(id(1), h.deps, options);
  assert.ok(r.outcomes.every(o => o.state === 'release_required')); assert.equal(h.writes.length, 0);
  assert.deepEqual(h.snapshot, before);
});
test('a released rule must match every captured field, including identity and timing', async () => {
  for (const patch of [{ id: id(99) }, { body: 'Changed' }, { enabled: false }, { configured_in_ota: true },
    { send_mode: 'approve' }, { offset_days: -1 }, { at_local: '03:00' }, { delivery: 'sms' },
    { trigger: 'checkin_day' }, { timezone: 'UTC' }, { min_nights: 2 }, { subject: 'Different' },
    { channel_exclusions: ['airbnb'] }]) {
    const h = harness(); Object.assign(h.snapshot.currentRules[0], patch);
    const r = await run(id(1), h.deps, options);
    assert.equal(r.outcomes[0].state, 'release_required', JSON.stringify(patch));
    assert.equal(h.writes.some(p => p.key === 'booking_confirmed'), false);
  }
});
test('past confirmation and DST are not replaced by generic timings', async () => {
  const h = harness(); h.snapshot.clocks.confirmedAt = '2026-11-01T12:00:00Z';
  h.snapshot.clocks.confirmedAt = new Date(h.snapshot.clocks.confirmedAt).toISOString();
  h.snapshot.timingEvidence = syntheticTimingEvidence(h.snapshot, h.context, instant);
  let r = await run(id(1), h.deps, options);
  assert.deepEqual(r.outcomes.map(o => o.state), ['past_not_replayed', 'created', 'created', 'created']);
  const d = harness(); d.snapshot.booking.start = d.snapshot.clocks.start = '2027-03-14';
  d.snapshot.booking.end = d.snapshot.clocks.end = '2027-03-18';
  d.snapshot.timingEvidence = syntheticTimingEvidence(d.snapshot, d.context, instant);
  r = await run(id(1), d.deps, options);
  assert.equal(r.outcomes[1].state, 'dst_review'); assert.equal(d.writes.find(p => p.key === 'checkin_day')!.fireAt, '2027-03-14T19:00:00.000Z');
});
test('missing, masked or unresolved render inputs never create a key-code job', async () => {
  for (const code of [null, '', '••••', '[door_code]', '{{door_code}}']) {
    const h = harness(); h.snapshot.merge.door_code = code;
    const r = await run(id(1), h.deps, options);
    assert.equal(r.outcomes[2].state, 'render_review'); assert.equal(h.writes.some(p => p.key === 'checkin_day'), false);
  }
});
test('verified early arrival and late departure do not schedule contradictory frozen wording', async () => {
  for (const [override, blocked] of [
    [{ plannedArrival: '13:00' }, ['booking_confirmed', 'pre_arrival']],
    [{ plannedDeparture: '13:00' }, ['pre_arrival', 'pre_checkout']],
    [{ plannedArrival: '13:00', plannedDeparture: '13:00' }, ['booking_confirmed', 'pre_arrival', 'pre_checkout']],
  ] as const) {
    const h = harness(); Object.assign(h.snapshot.clocks, override);
    // Independently verified clocks may still contradict literal times in the text.
    h.snapshot.timingEvidence = syntheticTimingEvidence(h.snapshot, h.context, instant);
    const result = await run(id(1), h.deps, options);
    assert.equal(result.state, 'complete');
    assert.deepEqual(result.outcomes.filter(o => o.state === 'wording_review').map(o => o.key), blocked);
    assert.ok(h.writes.every(w => !(blocked as readonly string[]).includes(w.key)));
    assert.ok(h.writes.some(w => w.key === 'checkin_day')); // Relative code-only text is unaffected.
  }
});
test('cancellations and duplicates produce zero new rows', async () => {
  for (const patch of [{ status: 'cancelled' }, { status: 'completed' }, { duplicateOf: id(90) }]) {
    const h = harness(); Object.assign(h.snapshot.booking, patch);
    const r = await run(id(1), h.deps, options);
    assert.ok(r.outcomes.every(o => o.state === 'stay_inactive')); assert.equal(h.writes.length, 0);
  }
});
test('sent, held, attempted, moved and orphan history is preserved', async () => {
  for (const [status, expected] of [['sent', 'already_sent'], ['failed', 'delivery_uncertain'],
    ['sending', 'delivery_uncertain'], ['awaiting_approval', 'held'], ['cancelled', 'held'], ['scheduled', 'schedule_changed']] as const) {
    const h = harness(); h.snapshot.ledger.push({ id: id(200), booking_id: id(1), property_id: '65_calderwood', automation_id: id(10),
      automation_key: 'booking_confirmed', fire_at: '2026-11-11T16:19:00Z', status,
      planned_check_in: '2026-11-24', planned_check_out: '2026-11-28', sent_at: null, provider_message_id: null });
    const r = await run(id(1), h.deps, options);
    assert.equal(r.outcomes[0].state, expected); assert.equal(h.writes.some(p => p.key === 'booking_confirmed'), false);
  }
  const h = harness(); await run(id(1), h.deps, options);
  h.snapshot.ledger[0].automation_id = null; h.snapshot.ledger[0].automation_key = null;
  assert.ok((await run(id(1), h.deps, options)).outcomes.every(o => o.state === 'history_conflict'));
});
test('invalid, incomplete, stale, future-dated and cross-stay snapshots fail closed', async () => {
  for (const change of [
    (s: ReturnType<typeof syntheticScheduleSnapshot>) => { s.booking.id = id(99); },
    (s: ReturnType<typeof syntheticScheduleSnapshot>) => { s.clocks.start = '2026-11-25'; },
    (s: ReturnType<typeof syntheticScheduleSnapshot>) => { s.observedAt = new Date(instant - 30_001).toISOString(); },
    (s: ReturnType<typeof syntheticScheduleSnapshot>) => { s.observedAt = new Date(instant + 1).toISOString(); },
  ]) {
    const h = harness(); change(h.snapshot);
    assert.equal((await run(id(1), h.deps, options)).state, 'unavailable'); assert.equal(h.writes.length, 0);
  }
  for (const raw of [null, {}, { ...harness().snapshot, ledger: null }, { ...harness().snapshot, secret: 'PRIVATE' }]) {
    const h = harness(); h.deps.load = async () => raw as ReturnType<typeof syntheticScheduleSnapshot>;
    assert.equal((await run(id(1), h.deps, options)).state, 'unavailable'); assert.equal(h.writes.length, 0);
  }
});
test('changes in source clocks, text, secret, route or context stop the first write', async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => { h.snapshot.clocks.defaultArrival = '17:00'; },
    (h: ReturnType<typeof harness>) => { h.snapshot.currentRules[0].body += 'Changed'; },
    (h: ReturnType<typeof harness>) => { h.snapshot.merge.door_code = 'CHANGED'; },
    (h: ReturnType<typeof harness>) => { h.snapshot.route.threadId = id(99); },
    (h: ReturnType<typeof harness>) => { h.context.contextRevision = 'b'.repeat(32); },
  ]) {
    const h = harness(), load = h.deps.load;
    h.deps.load = async () => { const s = await load(); if (h.reads() === 1) change(h); return s; };
    assert.ok(['changed', 'unavailable', 'timing_review'].includes((await run(id(1), h.deps, options)).state)); assert.equal(h.writes.length, 0);
  }
});
test('a partial batch stops on source change, preserves first registration, and never mutates history', async () => {
  const h = harness(), register = h.deps.store.register;
  h.deps.store.register = async p => { const r = await register(p); h.snapshot.booking.status = 'cancelled'; return r; };
  const r = await run(id(1), h.deps, options);
  assert.equal(r.state, 'changed'); assert.equal(h.writes.length, 1); assert.equal(h.snapshot.ledger.length, 1);
});
test('a lost committed response stops immediately; restart reconciles without resending the first workflow', async () => {
  const h = harness(), register = h.deps.store.register;
  h.deps.store.register = async p => { await register(p); throw Error('PRIVATE_TIMEOUT_BODY'); };
  const r = await run(id(1), h.deps, options);
  assert.equal(r.state, 'uncertain'); assert.equal(h.writes.length, 1); assert.equal(r.outcomes.length, 1);
  assert.equal(JSON.stringify(r).includes('PRIVATE'), false);
  h.deps.store.register = register;
  const next = await run(id(1), h.deps, options);
  assert.equal(next.state, 'complete'); assert.equal(next.outcomes[0].state, 'existing_schedule'); assert.equal(h.writes.length, 4);
});
test('an uncommitted timeout retains the exact deterministic registration intent on restart', async () => {
  const h = harness(), register = h.deps.store.register;
  let attempted: unknown;
  h.deps.store.register = async p => { attempted = structuredClone(p); return { state: 'uncertain', canSend: false }; };
  assert.equal((await run(id(1), h.deps, options)).state, 'uncertain');
  h.deps.store.register = register; await run(id(1), h.deps, options);
  assert.deepEqual(h.writes[0], attempted);
});
test('a concurrent ledger change is reconciled, not ignored as an input timestamp difference', async () => {
  const h = harness(), load = h.deps.load;
  h.deps.load = async () => {
    if (h.reads() === 1) h.snapshot.ledger.push({ id: id(200), booking_id: id(1), property_id: '65_calderwood', automation_id: null,
      automation_key: 'booking_confirmed', fire_at: '2026-11-11T15:00:00Z', status: 'sent', planned_check_in: '2026-11-24',
      planned_check_out: '2026-11-28', sent_at: '2026-11-11T15:01:00Z', provider_message_id: 'PRIVATE' } satisfies ScheduleLedgerRow);
    return load();
  };
  assert.equal((await run(id(1), h.deps, options)).outcomes[0].state, 'already_sent'); assert.equal(h.writes.length, 3);
});
test('over-budget, reversed and invalid clocks never permit a late batch write', async () => {
  for (const t of [instant - 1, instant + 60_001, NaN]) {
    const h = harness(), load = h.deps.load;
    h.deps.load = async () => { h.time(t); return load(); };
    assert.equal((await run(id(1), h.deps, options)).state, 'unavailable'); assert.equal(h.writes.length, 0);
  }
});

test('raw fields, revision/first-seen times, property defaults and missing provenance cannot schedule', async () => {
  for (const raw of [null, undefined, {}, ...['channex_raw_message', 'channex_inserted_at', 'first_seen',
    'channex_arrival_hour', 'guesty_capture'].map(kind => ({ ...harness().snapshot.timingEvidence, kind }))]) {
    const h = harness(); h.snapshot.timingEvidence = raw as typeof h.snapshot.timingEvidence;
    const r = await run(id(1), h.deps, options);
    assert.equal(r.state, 'timing_review'); assert.deepEqual(r.outcomes, []); assert.equal(h.writes.length, 0);
  }
});
test('retained timing must match the exact stay, source identity, clock values and current handover', async () => {
  const changes: ((h: ReturnType<typeof harness>) => void)[] = [
    h => { h.snapshot.timingEvidence!.row.bookingId = id(99); },
    h => { h.snapshot.timingEvidence!.row.guestyId = 'b'.repeat(24); },
    h => { h.snapshot.timingEvidence!.row.code = 'ANOTHER-STAY'; },
    h => { h.snapshot.timingEvidence!.row.source = 'ical_import'; },
    h => { h.snapshot.timingEvidence!.row.start = '2026-11-23'; },
    h => { h.snapshot.timingEvidence!.row.end = '2026-11-29'; },
    h => { h.snapshot.timingEvidence!.row.clocks.confirmedAt = new Date(instant - 1000).toISOString(); },
    h => { h.snapshot.clocks.plannedArrival = '17:00'; },
    h => { h.snapshot.clocks.plannedDeparture = '12:00'; },
    h => { h.snapshot.clocks.defaultArrival = ''; },
    h => { h.snapshot.timingEvidence!.binding.contextRevision = 'b'.repeat(32); },
    h => { h.snapshot.timingEvidence!.binding.routeGeneration = id(99); },
    h => { h.snapshot.timingEvidence!.binding.sourceEvidenceId = id(99); },
    h => { h.snapshot.timingEvidence!.binding.sourceEvidenceAt = '2026-11-10T13:00:00Z'; },
    h => { h.snapshot.timingEvidence!.binding.remoteBookingId = id(99); },
    h => { h.snapshot.timingEvidence!.binding.threadId = id(99); },
    h => { h.snapshot.sourceIdentity.guestyId = ''; }, // New Channex stay has no Guesty predecessor.
    h => { Object.assign(h.snapshot.timingEvidence!, { raw_message: 'PRIVATE_PROVIDER_PAYLOAD' }); },
  ];
  for (const change of changes) {
    const h = harness(); change(h);
    const r = await run(id(1), h.deps, options);
    assert.equal(r.state, 'timing_review'); assert.equal(h.writes.length, 0);
    assert.equal(JSON.stringify(r).includes('PRIVATE'), false);
  }
});
test('capture/confirmation/review chronology must be possible and not later than the observation', async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => { h.snapshot.timingEvidence!.checkedAt = new Date(instant + 1000).toISOString(); },
    (h: ReturnType<typeof harness>) => { h.snapshot.timingEvidence!.checkedAt = new Date(instant - 600_001).toISOString(); },
    (h: ReturnType<typeof harness>) => { h.snapshot.timingEvidence!.binding.reviewedAt = new Date(instant - 1001).toISOString(); },
    (h: ReturnType<typeof harness>) => { h.snapshot.timingEvidence!.binding.reviewedAt = new Date(instant + 1).toISOString(); },
    (h: ReturnType<typeof harness>) => {
      h.context.sourceEvidenceAt = h.snapshot.timingEvidence!.binding.sourceEvidenceAt = new Date(instant + 1).toISOString();
    },
  ]) {
    const h = harness(); change(h);
    assert.equal((await run(id(1), h.deps, options)).state, 'timing_review'); assert.equal(h.writes.length, 0);
  }
});
test('evidence loss after a successful registration stops the rest without replacing the first job', async () => {
  const h = harness(), register = h.deps.store.register;
  h.deps.store.register = async p => { const result = await register(p); h.snapshot.timingEvidence = null; return result; };
  const r = await run(id(1), h.deps, options);
  assert.equal(r.state, 'timing_review'); assert.equal(r.outcomes.length, 1);
  assert.equal(h.writes.length, 1); assert.equal(h.snapshot.ledger.length, 1);
});
