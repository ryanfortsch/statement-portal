import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CleanerSmsTransport, type CleanerSmsStatus } from '../../channex-messaging/cleaner-sms-transport.ts';
import { CleanerSmsWorker, renderRetainedCleanerSms, type CleanerSmsJob, type CleanerSmsReview,
  type CleanerSmsStore } from '../../channex-messaging/cleaner-sms-worker.ts';
import { MIGRATION_TIMING } from '../../channex-messaging/preparation-timing.ts';
import { QUO_LINES } from '../../quo-lines.ts';
export const cleanerId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Synthetic phone, token, wording and store only. This is protocol coverage,
 * not a replacement for the future PostgreSQL atomic-claim integration test. */
export function cleanerSmsFixture(workflow: 'cleaner_arrival' | 'cleaner_reminder' = 'cleaner_arrival',
  providerFailure?: 'response_lost' | 'rejected') {
  let now = Date.parse(workflow === 'cleaner_arrival' ? '2026-11-24T14:00:00Z' : '2026-11-14T21:00:00Z');
  const body = workflow === 'cleaner_reminder'
    ? 'HELMTEST arrival {{check_in_long}} at {{property_name}}. Departure {{check_out_long}}. {{cleaner_schedule_url}}'
    : 'HELMTEST arrival today at 4:00pm at {{property_name}}. Departure {{check_out_long}}.';
  const review: CleanerSmsReview = { contextRevision: 'a'.repeat(32), propertyName: 'HELMTEST Home',
    rule: { id: cleanerId(3), key: workflow, property_id: '65_calderwood', audience: 'cleaner', trigger: 'pre_arrival',
      offset_days: 0, at_local: null, timezone: 'America/New_York', channel_exclusions: [], delivery: 'sms', send_mode: 'approve',
      min_nights: null, subject: null, body, enabled: false, configured_in_ota: true,
      migration_policy: { version: 1, state: 'prepared', source: 'guesty', capturedAt: '2026-10-01T12:00:00Z',
        sourceSha256: sha('HELMTEST source'), bodySha256: sha(body), fieldMappingVersion: 1, timing: MIGRATION_TIMING[workflow] } },
    clocks: { start: '2026-11-24', end: '2026-11-28', timezone: 'America/New_York', plannedArrival: null,
      defaultArrival: '16:00', plannedDeparture: null, defaultDeparture: '11:00', confirmedAt: null },
    recipients: [{ enabled: true, property_ids: ['65_calderwood'], region: 'bridgeport_ct',
      language: 'en', phone: '+12025550123', portal_token: '0123456789abcdef0123456789abcdef' }],
  };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let status: CleanerSmsStatus = 'queued';
  let providerRow: Record<string, unknown> | null = null;
  const transport = new CleanerSmsTransport({ apiKey: 'HELMTEST_KEY', receiptKey: 'a'.repeat(64), keyId: 'test-v1',
    sendEnabled: true, clock: () => now, fetcher: async (url, init) => {
      calls.push({ url, init });
      if (init.method === 'POST') {
        const body = JSON.parse(String(init.body));
        providerRow = { id: 'ACHELMTEST1', from: QUO_LINES.ops.number, phoneNumberId: QUO_LINES.ops.id,
          to: body.to, text: body.content, status, direction: 'outgoing', media: [],
          createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
        if (providerFailure === 'response_lost') throw Error('HELMTEST provider accepted but response lost');
        if (providerFailure === 'rejected') return Response.json({ error: 'HELMTEST refusal' }, { status: 403 });
      }
      return Response.json({ data: providerRow ? { ...providerRow, status, updatedAt: new Date(now).toISOString() } : null },
        { status: init.method === 'POST' ? 202 : 200 });
    } });
  const render = renderRetainedCleanerSms(review, transport, now);
  let job: CleanerSmsJob = { sendId: cleanerId(1), bookingId: cleanerId(2), automationId: cleanerId(3), releaseId: cleanerId(5),
    propertyId: '65_calderwood', key: workflow, contextRevision: review.contextRevision, recipientHmac: render.recipientHmac,
    keyId: render.keyId, targetHmac: render.targetHmac, bodySha256: render.bodySha256,
    fireAt: new Date(now).toISOString(), expiresAt: new Date(now + 1800000).toISOString(), state: 'prepared',
    attemptId: null, providerMessageId: null, providerStatus: null, providerUpdatedAt: null };
  let reads = 0, claims = 0, finishes = 0;
  const store: CleanerSmsStore = {
    read: async () => { reads++; return structuredClone(job); },
    claim: async (expected, attemptId) => {
      claims++;
      if (job.state !== 'prepared' || !isDeepStrictEqual(expected, job)) return false;
      job = { ...job, state: 'attempting', attemptId }; return true;
    },
    finish: async (_, attemptId, outcome) => {
      finishes++;
      if (job.attemptId !== attemptId) return false;
      job = { ...job, state: outcome.state,
        providerMessageId: 'providerMessageId' in outcome ? outcome.providerMessageId : null,
        providerStatus: 'providerStatus' in outcome ? outcome.providerStatus : null,
        providerUpdatedAt: 'providerUpdatedAt' in outcome ? outcome.providerUpdatedAt : null };
      return true;
    },
  };
  return { review, store, transport, calls, render, now: () => now, advance: (ms: number) => { now += ms; },
    job: () => job, changeJob: (patch: Partial<CleanerSmsJob>) => { job = { ...job, ...patch }; },
    status: (value: CleanerSmsStatus) => { status = value; }, counts: () => ({ reads, claims, finishes }),
    worker: (enabled = true) => new CleanerSmsWorker({ store, transport, enabled, clock: () => now }),
    load: async () => structuredClone(review) };
}
