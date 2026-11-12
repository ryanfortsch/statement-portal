import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverBookingThread } from '../channex-messaging/thread-discovery.ts';
import { syntheticTimingProvider } from './fixtures/channex-timing-provider.ts';
import { syntheticScheduleSnapshot, syntheticTimingEvidence, scheduleFixtureId as id } from './fixtures/channex-schedule-snapshot.ts';
const at = Date.parse('2026-11-12T16:00:00Z'), s = syntheticScheduleSnapshot(at);
const context = { contextRevision: 'a'.repeat(32), routeGeneration: id(50), sourceEvidenceId: id(51), sourceEvidenceAt: new Date(at - 1000).toISOString() };
const scope = { environment: 'production' as const, propertyId: '320c5cb5-91e0-46af-b9b3-a3fc20b4631e', channelId: id(52), provider: 'Airbnb' as const };
const thread = () => syntheticTimingProvider(syntheticTimingEvidence(s, context, at).row,
  { ...s.route, revisionId: id(53), channelId: scope.channelId }).thread.data;
test('complete pagination finds the exact open booking/property/channel thread and discards content', async () => {
  const unrelated = thread(); unrelated.id = id(80); unrelated.relationships.booking.data.id = id(81);
  let calls = 0;
  const result = await discoverBookingThread(async (path, bound) => {
    calls++; const params = new URL(path, 'https://synthetic.test').searchParams;
    assert.equal(params.get('pagination[page]'), String(calls)); assert.equal(bound, 1_048_576);
    return { data: calls === 1 ? [unrelated] : [thread()], meta: { page: calls, limit: 1, total: 2 } };
  }, scope, s.route.remoteBookingId);
  assert.equal(result, s.route.threadId); assert.equal(calls, 2);
});
test('missing, closed, ambiguous, mismatched and malformed threads never select a destination', async () => {
  const closed = thread(); closed.attributes.is_closed = true;
  const wrong = thread(); wrong.relationships.property.data.id = id(99);
  const second = thread(); second.id = id(98);
  const inquiry = { ...thread(), relationships: { ...thread().relationships, booking: { data: null } } };
  for (const rows of [[], [closed], [wrong], [inquiry], [thread(), second], [thread(), thread()], [{ ...thread(), id: '../escape' }]])
    await assert.rejects(discoverBookingThread(async () => ({ data: rows, meta: { page: 1, limit: 100, total: rows.length } }), scope, s.route.remoteBookingId));
});
test('partial lists, changing totals, invalid page metadata and bounded overflow cannot succeed', async () => {
  for (const meta of [{ page: 2, limit: 100, total: 1 }, { page: 1, limit: 100, total: 2 },
    { page: 1, limit: 0, total: 1 }, { page: 1, limit: 100, total: 501 }])
    await assert.rejects(discoverBookingThread(async () => ({ data: [thread()], meta }), scope, s.route.remoteBookingId));
  let calls = 0;
  await assert.rejects(discoverBookingThread(async () => {
    calls++; const row = thread(); row.id = id(80 + calls); row.relationships.booking.data.id = id(90);
    return { data: [row], meta: { page: calls, limit: 1, total: 10 } };
  }, scope, s.route.remoteBookingId)); assert.equal(calls, 5);
  calls = 0;
  await assert.rejects(discoverBookingThread(async () => ({ data: [thread()], meta: { page: ++calls, limit: 1, total: calls === 1 ? 2 : 3 } }), scope, s.route.remoteBookingId));
});
