import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalderwoodScheduleInputReader } from '../channex-messaging/schedule-inputs.ts';
import { scheduleFixtureId as id, syntheticScheduleSnapshot, syntheticTimingEvidence } from './fixtures/channex-schedule-snapshot.ts';

const now = Date.parse('2026-11-12T20:00:00.000Z');
function fixture() {
  const s = syntheticScheduleSnapshot(now), bindingId = id(71);
  const context = { contextRevision: 'a'.repeat(32), routeGeneration: id(72), sourceEvidenceId: id(73),
    sourceEvidenceAt: new Date(now - 60_000).toISOString() };
  const raw = { format: 1, observedAt: s.observedAt, context,
    binding: { bindingId, evidence: syntheticTimingEvidence(s, context, now) },
    booking: { ...s.booking, guestName: '  Synthetic Guest  ' },
    property: { id: '65_calderwood', name: ' Synthetic Home ', wifiName: ' Synthetic Network ' },
    access: { smartLockCode: ' SYNTHETIC-CODE ', wifiPassword: ' SYNTHETIC-PASSWORD ' },
    lockMapped: false, currentRules: s.currentRules, ledger: s.ledger };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); return { data: structuredClone(raw), error: null };
  };
  const reader = createCalderwoodScheduleInputReader(rpc, { enabled: true });
  return { raw, s, calls, rpc, reader, bindingId, load: () => reader.load(s.booking.id, bindingId, () => now) };
}
test('default off; one bounded read preserves stored evidence and never invents a template release', async () => {
  const f = fixture();
  assert.equal(await createCalderwoodScheduleInputReader(f.rpc).load(f.s.booking.id, f.bindingId), null);
  assert.equal(f.calls.length, 0);
  const loaded = await f.load(); assert.ok(loaded);
  assert.deepEqual(f.calls, [{ name: 'helm_channex_message_schedule_inputs', args: { p_booking_id: f.s.booking.id, p_binding_id: f.bindingId } }]);
  assert.deepEqual(loaded.context, f.raw.context);
  assert.deepEqual(loaded.snapshot.timingEvidence, f.raw.binding.evidence);
  assert.deepEqual(loaded.snapshot.currentRules, f.s.currentRules);
  assert.ok(!('capturedRules' in loaded.snapshot));
  assert.ok(!('guestName' in loaded.snapshot.booking));
  assert.deepEqual(loaded.snapshot.merge, { guest_first: 'Synthetic', property_name: 'Synthetic Home',
    check_in_long: 'Nov 24th, 2026', check_out_long: 'Nov 28th, 2026', door_code: 'SYNTHETIC-CODE',
    wifi_name: 'Synthetic Network', wifi_password: 'SYNTHETIC-PASSWORD' });
});
test('missing credentials and placeholder names stay missing; mapped locks never fall back to static codes', async () => {
  for (const name of ['Reserved', 'Blocked', 'Owner', null, '']) {
    const f = fixture(); f.raw.booking.guestName = name as never;
    f.raw.lockMapped = true;
    assert.equal((await f.load())?.snapshot.merge.door_code, null);
    assert.equal((await f.load())?.snapshot.merge.guest_first, null);
  }
  const f = fixture(); f.raw.access = null as never; f.raw.property.wifiName = '  ';
  const loaded = await f.load(); assert.equal(loaded?.snapshot.merge.door_code, null);
  assert.equal(loaded?.snapshot.merge.wifi_password, null); assert.equal(loaded?.snapshot.merge.wifi_name, null);
});
test('mismatched binding, booking, chronology, source, context and route cannot become scheduling input', async () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    f => { f.raw.binding.bindingId = id(90); },
    f => { f.raw.booking.id = id(90); },
    f => { f.raw.booking.propertyId = 'other_home'; },
    f => { f.raw.booking.status = 'cancelled'; },
    f => { f.raw.booking.duplicateOf = id(90); },
    f => { f.raw.booking.end = '2026-11-29'; },
    f => { f.raw.context.contextRevision = 'b'.repeat(32); },
    f => { f.raw.context.routeGeneration = id(90); },
    f => { f.raw.binding.evidence.binding.sourceEvidenceId = id(90); },
    f => { f.raw.binding.evidence.row.clocks.confirmedAt = new Date(now + 1).toISOString(); },
    f => { f.raw.binding.evidence.row.source = 'channex_revision' as never; },
    f => { f.raw.binding.evidence.binding.threadId = 'untrusted'; },
    f => { f.raw.binding.evidence.row.bookingId = id(90); },
    f => { f.raw.binding.evidence.binding.reviewedAt = new Date(now + 1).toISOString(); },
    f => { f.raw.observedAt = new Date(now + 1).toISOString(); },
    f => { f.raw.observedAt = new Date(now - 30_001).toISOString(); },
    f => { (f.raw as unknown as Record<string, unknown>).browserAssertion = true; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); await assert.rejects(f.load, /^Error: Message scheduling inputs unavailable$/); }
});
test('history retains sent, failed, held and unknown-rule rows; truncation, duplicate IDs and foreign stays fail', async () => {
  const f = fixture();
  f.raw.ledger = ['sent', 'sending', 'failed', 'cancelled', 'awaiting_approval', 'scheduled'].map((status, n) => ({
    id: id(100 + n), booking_id: f.s.booking.id, property_id: '65_calderwood', automation_id: null,
    automation_key: null, fire_at: new Date(now - n * 1000).toISOString(), status: status as 'sent',
    planned_check_in: f.s.booking.start, planned_check_out: f.s.booking.end,
    sent_at: status === 'sent' ? new Date(now).toISOString() : null, provider_message_id: status === 'sending' ? 'synthetic-receipt' : null,
  }));
  assert.deepEqual((await f.load())?.snapshot.ledger, f.raw.ledger);
  for (const mutation of ['foreign-stay', 'foreign-property', 'duplicate', 'overflow']) {
    const g = fixture(); g.raw.ledger = structuredClone(f.raw.ledger);
    if (mutation === 'foreign-stay') g.raw.ledger[0].booking_id = id(90);
    if (mutation === 'foreign-property') g.raw.ledger[0].property_id = 'other_home' as never;
    if (mutation === 'duplicate') g.raw.ledger.push(g.raw.ledger[0]);
    if (mutation === 'overflow') g.raw.ledger = Array.from({ length: 5001 }, (_, i) => ({ ...g.raw.ledger[0], id: id(i + 100) }));
    await assert.rejects(g.load, /inputs unavailable/);
  }
});
test('every load rereads the database; null stays unavailable and errors never expose private fields', async () => {
  const f = fixture(); await f.load(); f.raw.booking.guestName = 'Updated Guest';
  assert.equal((await f.load())?.snapshot.merge.guest_first, 'Updated'); assert.equal(f.calls.length, 2);
  for (const rpc of [async () => ({ data: null, error: 'PRIVATE-KEY' }),
    async () => { throw Error('PRIVATE-PASSWORD'); }, async () => ({ data: { secret: 'PRIVATE-CODE' }, error: null })]) {
    await assert.rejects(createCalderwoodScheduleInputReader(rpc, { enabled: true }).load(f.s.booking.id, f.bindingId, () => now),
      e => e instanceof Error && e.message === 'Message scheduling inputs unavailable' && !('cause' in e));
  }
  assert.equal(await createCalderwoodScheduleInputReader(async () => ({ data: null, error: null }), { enabled: true })
    .load(f.s.booking.id, f.bindingId, () => now), null);
  await assert.rejects(f.reader.load('bad', f.bindingId), /inputs unavailable/);
  assert.equal(f.calls.length, 2);
});
test('clock reversal or an overlong database read cannot create a fresh observation', async () => {
  for (const finish of [now - 1, now + 30_001, NaN]) {
    const f = fixture(); let calls = 0;
    await assert.rejects(f.reader.load(f.s.booking.id, f.bindingId, () => calls++ ? finish : now), /inputs unavailable/);
  }
});
