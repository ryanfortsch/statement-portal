import test from 'node:test';
import assert from 'node:assert/strict';
import { createChannexScheduleStore, type ScheduleRegistration } from '../channex-messaging/schedule-store.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = { contextRevision: 'a'.repeat(32), routeGeneration: id(4), sourceEvidenceId: id(5), sourceEvidenceAt: '2026-11-11T10:00:00Z' };
const plan: ScheduleRegistration = { ...context, sendId: id(1), bookingId: id(2), automationId: id(3), key: 'checkin_day',
  remoteBookingId: id(6), threadId: id(7), bodySha256: 'b'.repeat(64), fireAt: '2026-11-24T20:00:00Z', expiresAt: '2026-11-24T21:00:00Z' };
test('schedule writes are disabled by default and cannot reach any RPC', async () => {
  const s = createChannexScheduleStore(async () => { throw Error('must not call'); });
  assert.equal(await s.context(plan.bookingId), null);
  assert.deepEqual(await s.register(plan), { state: 'disabled', canSend: false });
});
test('the adapter preserves the exact intent and treats retries as reads, not send permits', async () => {
  let calls = 0;
  const s = createChannexScheduleStore(async (name, args) => {
    if (name.endsWith('_context')) { assert.deepEqual(args, { p_booking_id: plan.bookingId }); return { data: context, error: null }; }
    assert.equal(name, 'helm_channex_message_register'); assert.deepEqual(args, { p_plan: plan });
    return { data: { state: calls++ ? 'existing' : 'created', sendId: plan.sendId }, error: null };
  }, { enabled: true });
  assert.deepEqual(await s.context(plan.bookingId), context);
  assert.deepEqual(await s.register(plan), { state: 'created', sendId: plan.sendId, canSend: false });
  assert.deepEqual(await s.register(plan), { state: 'existing', sendId: plan.sendId, canSend: false });
});
test('malformed intents, cleaner workflows, secrets, invalid dates and unbounded expiry never reach SQL', async () => {
  const s = createChannexScheduleStore(async () => { assert.fail('invalid request reached SQL'); }, { enabled: true });
  for (const patch of [{ key: 'cleaner_reminder' }, { bookingId: 'other' }, { body: 'SECRET' }, { bodySha256: '' },
    { fireAt: '2026-02-30T20:00:00Z' }, { fireAt: '2026-11-24T20:00:00' }, { expiresAt: plan.fireAt },
    { expiresAt: '2026-11-25T20:00:00.001Z' }, { sourceEvidenceId: null }]) {
    assert.deepEqual(await s.register({ ...plan, ...patch }), { state: 'invalid', canSend: false });
  }
});
test('lost responses and mismatched receipts are uncertain and never retried inside the adapter', async () => {
  for (const response of [null, { data: null, error: null }, { data: true, error: null },
    { data: { state: 'created', sendId: id(99) }, error: null },
    { data: { state: 'created', sendId: plan.sendId, secret: 'SECRET' }, error: null },
    { data: { state: 'created', sendId: plan.sendId }, error: 'SECRET' }]) {
    let calls = 0;
    const s = createChannexScheduleStore(async () => { calls++; if (!response) throw Error('SECRET'); return response; }, { enabled: true });
    assert.deepEqual(await s.register(plan), { state: 'uncertain', canSend: false });
    assert.equal(calls, 1);
  }
});
test('unavailable context is not fabricated, and errors do not expose database details', async () => {
  const unavailable = createChannexScheduleStore(async () => ({ data: null, error: null }), { enabled: true });
  assert.equal(await unavailable.context(plan.bookingId), null);
  for (const value of [{ ...context, secret: 'SECRET' }, { ...context, sourceEvidenceId: null }, {}]) {
    const s = createChannexScheduleStore(async () => ({ data: value, error: null }), { enabled: true });
    await assert.rejects(s.context(plan.bookingId), /^Error: Schedule context unavailable$/);
  }
});
