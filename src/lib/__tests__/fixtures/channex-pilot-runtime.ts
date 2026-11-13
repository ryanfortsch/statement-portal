import assert from 'node:assert/strict';
import { retainedRuntimeFixture } from './channex-retained-runtime.ts';
import { scheduleFixtureId as id } from './channex-schedule-snapshot.ts';
import { runRetainedCalderwoodPilot } from '../../channex-messaging/pilot-runtime.ts';
import type { ChannexJob } from '../../channex-messaging/worker.ts';
import type { ScheduleRegistration } from '../../channex-messaging/schedule-store.ts';

/** Only synthetic records and fake provider traffic. Claim semantics are also
 * exercised with real PostgreSQL in test-channex-schedule-runtime.mts. */
export function pilotRuntimeFixture() {
  const f = retainedRuntimeFixture(), rpc = f.deps.rpc, fetcher = f.deps.fetcher;
  const jobs = new Map<string, ChannexJob>(), messages: unknown[] = [];
  let posts = 0, claims = 0, finishes = 0;
  f.deps.rpc = async (name, args) => {
    if (name === 'helm_channex_message_read') return { data: structuredClone(jobs.get(String(args.p_send_id)) ?? null), error: null };
    if (name === 'helm_channex_message_claim') {
      claims++; const job = jobs.get(String(args.p_send_id))!;
      if (job.state !== 'prepared' || job.attemptId) return { data: false, error: null };
      Object.assign(job, { state: 'attempting', attemptId: args.p_attempt_id });
      f.s.ledger.find(r => r.id === job.sendId)!.status = 'sending';
      return { data: true, error: null };
    }
    if (name === 'helm_channex_message_finish') {
      finishes++; const job = jobs.get(String(args.p_send_id))!;
      assert.equal(job.attemptId, args.p_attempt_id);
      Object.assign(job, { state: args.p_state, providerMessageId: args.p_provider_id });
      const row = f.s.ledger.find(r => r.id === job.sendId)!;
      row.provider_message_id = job.providerMessageId;
      if (job.state === 'accepted' || job.state === 'recorded') { row.status = 'sent'; row.sent_at = new Date(f.deps.clock()).toISOString(); }
      return { data: true, error: null };
    }
    const out = await rpc(name, args);
    if (name === 'helm_channex_message_register') {
      const p = args.p_plan as ScheduleRegistration;
      jobs.set(p.sendId, { ...f.review.scope, environment: 'production', provider: 'Airbnb',
        sendId: p.sendId, bookingId: p.remoteBookingId, threadId: p.threadId, bodySha256: p.bodySha256,
        contextRevision: p.contextRevision, state: 'prepared', attemptId: null, providerMessageId: null });
    }
    return out;
  };
  f.deps.fetcher = async (url, init) => {
    if (new URL(String(url)).pathname.endsWith('/messages')) {
      if (init?.method === 'POST') {
        posts++;
        const message = { type: 'message', id: id(100 + posts), attributes: { sender: 'property',
          message: JSON.parse(String(init.body)).message.message, attachments: [] },
        relationships: { message_thread: { data: { type: 'message_thread', id: f.s.route.threadId } } } };
        messages.push(message); return Response.json({ data: message });
      }
      assert.equal(init?.method, 'GET');
      return Response.json({ data: messages, meta: { page: 1, limit: 100, total: messages.length } });
    }
    return fetcher(url, init);
  };
  const manifest = { format: 1 as const, stays: [f.request] };
  const deps = Object.assign(f.deps, { receiptKey: async () => 'synthetic-channex' });
  return { ...f, jobs, manifest, deps, messages, counts: () => ({ posts, claims, finishes }),
    tick: () => runRetainedCalderwoodPilot(manifest, deps, { enabled: true }) };
}
