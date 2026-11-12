import assert from 'node:assert/strict';
import { scheduleRetainedCalderwoodStay } from '../../channex-messaging/schedule-runtime.ts';
import { syntheticScheduleSnapshot, syntheticTimingEvidence, scheduleFixtureId as id } from './channex-schedule-snapshot.ts';
import { syntheticTimingProvider } from './channex-timing-provider.ts';
import { CALDERWOOD_PRODUCTION as mapping } from '../../channex-production-preflight.ts';
import type { ScheduleRegistration } from '../../channex-messaging/schedule-store.ts';
import type { MessageRpc } from '../../channex-messaging/store.ts';

const at = Date.parse('2026-11-12T16:00:00.000Z');
const options = { enabled: true, expiresAfterMs: 1800_000 };
export function retainedRuntimeFixture() {
  const s = syntheticScheduleSnapshot(at);
  const context = { contextRevision: 'a'.repeat(32), routeGeneration: id(50), sourceEvidenceId: id(51),
    sourceEvidenceAt: new Date(at - 3600_000).toISOString() };
  const evidence = syntheticTimingEvidence(s, context, at);
  const request = { bookingId: s.booking.id, bindingId: id(71), templateCaptureId: id(72), templateDigest: 'b'.repeat(64) };
  const review = { capture: { id: evidence.captureId, checkedAt: evidence.checkedAt, savedAt: new Date(at).toISOString(),
    sourceContract: evidence.sourceContract, row: evidence.row }, context,
    scope: { environment: 'production', propertyId: String(mapping.propertyId), provider: 'Airbnb', channelId: id(52) },
    route: { remoteBookingId: s.route.remoteBookingId, revisionId: id(53) } };
  const provider = syntheticTimingProvider(evidence.row, { ...s.route, revisionId: id(53), channelId: id(52) });
  let now = at, credentials = 0;
  const calls: string[] = [], reads: string[] = [], writes: ScheduleRegistration[] = [];
  const deps = { clock: () => now, credentials: async () => {
    credentials++; return { guestyToken: 'synthetic-guesty', channexKey: 'synthetic-channex' };
  }, rpc: (async (name, args) => {
    calls.push(name);
    if (name === 'helm_channex_message_schedule_context') return { data: structuredClone(context), error: null };
    if (name === 'helm_channex_read_template_capture') {
      assert.deepEqual(args, { p_capture_id: request.templateCaptureId, p_rules_sha256: request.templateDigest });
      return { data: { format: 1, captureId: request.templateCaptureId, rulesSha256: request.templateDigest,
        propertyId: '65_calderwood', capturedAt: new Date(at).toISOString(), rules: structuredClone(s.capturedRules) }, error: null };
    }
    if (name === 'helm_channex_message_schedule_inputs') return { data: { format: 1, observedAt: new Date(now).toISOString(),
      context: structuredClone(context), binding: { bindingId: request.bindingId, evidence: structuredClone(evidence) },
      booking: { ...s.booking, guestName: 'Synthetic Guest' }, property: { id: '65_calderwood', name: 'Synthetic Home', wifiName: 'Synthetic Wi-Fi' },
      access: { smartLockCode: 'PRIVATE-CODE', wifiPassword: 'PRIVATE-PASSWORD' }, lockMapped: false,
      currentRules: structuredClone(s.currentRules), ledger: structuredClone(s.ledger) }, error: null };
    if (name === 'helm_channex_timing_review_snapshot') return { data: structuredClone(review), error: null };
    assert.equal(name, 'helm_channex_message_register', 'No capture/binding/hold/send mutations allowed');
    const p = structuredClone(args.p_plan) as ScheduleRegistration; writes.push(p);
    s.ledger.push({ id: p.sendId, booking_id: p.bookingId, property_id: '65_calderwood', automation_id: p.automationId,
      automation_key: p.key, fire_at: p.fireAt, status: 'scheduled', planned_check_in: s.booking.start,
      planned_check_out: s.booking.end, sent_at: null, provider_message_id: null });
    return { data: { state: 'created', sendId: p.sendId }, error: null };
  }) as MessageRpc, fetcher: (async (url, init) => {
    const path = new URL(String(url)).pathname; reads.push(path);
    assert.equal(init?.method, 'GET'); assert.equal(init.body, undefined); assert.ok(init.signal);
    assert.equal(init.redirect, 'error');
    const body = path.includes('/reservations/') ? provider.v2 : path.endsWith('/reservations-v3') ? provider.v3
      : path.includes('/bookings/') ? provider.booking : path.includes('/message_threads/') ? provider.thread : null;
    assert.ok(body, 'Never discover a replacement thread or use a message POST');
    return Response.json(body);
  }) as typeof fetch };
  return { s, request, review, provider, context, evidence, deps, calls, reads, writes,
    time: (ms: number) => { now = ms; }, credentials: () => credentials,
    run: () => scheduleRetainedCalderwoodStay(request, deps, options) };
}
