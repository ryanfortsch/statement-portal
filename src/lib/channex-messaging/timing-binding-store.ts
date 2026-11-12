import 'server-only';
import { z } from 'zod';
import { scheduleContextSchema } from './schedule-store.ts';
import { requireTimingEvidence, sourceTimingRowSchema } from './timing-evidence.ts';
import type { MessageRpc } from './store.ts';

const id = z.uuid(), instant = z.iso.datetime({ precision: 3 });
export const timingBindingIntentSchema = z.object({
  bindingId: id, captureId: id, bookingId: id, context: scheduleContextSchema,
  remoteBookingId: id, threadId: id, reviewStartedAt: instant, reviewCheckedAt: instant,
  reviewedRow: sourceTimingRowSchema,
}).strict().refine(v => v.reviewedRow.bookingId === v.bookingId
  && v.reviewedRow.start < v.reviewedRow.end
  && Date.parse(v.reviewStartedAt) <= Date.parse(v.reviewCheckedAt)
  && Date.parse(v.reviewCheckedAt) - Date.parse(v.reviewStartedAt) <= 80_000);
export type TimingBindingIntent = z.infer<typeof timingBindingIntentSchema>;
type Expected = Parameters<typeof requireTimingEvidence>[1];
const saved = z.object({ bindingId: id, evidence: z.unknown() }).strict();

/** Default off, service-only persistence adapter. An explicit trusted review must
 * freshly verify provider clocks and booking/thread association before bind().
 * Do not expose these assertions as a browser body. The reader never creates or
 * refreshes a binding. No owner endpoint, provider client, scheduler or cron here.
 */
export function createChannexTimingBindingStore(rpc: MessageRpc, options: { enabled?: boolean } = {}) {
  return {
    async bind(raw: unknown, actor: string, clock: () => number = Date.now) {
      if (options.enabled !== true) return { state: 'disabled' as const, canSend: false as const };
      const parsed = timingBindingIntentSchema.safeParse(raw);
      if (!parsed.success || typeof actor !== 'string' || actor.trim().length < 3 || actor.trim().length > 320)
        return { state: 'invalid' as const, canSend: false as const };
      const intent = parsed.data;
      // SQL handles freshness and exact replay. Do not discard an old intent:
      // it may recover a committed response, without updating the original review.
      try {
        const started = clock();
        if (!Number.isFinite(started)) throw Error();
        const r = await rpc('helm_channex_timing_binding_review', { p_intent: intent, p_actor: actor.trim() });
        if (!r || r.error !== null) throw Error();
        const result = saved.extend({ state: z.enum(['created', 'existing']) }).parse(r.data);
        if (result.bindingId !== intent.bindingId) throw Error();
        const { bookingId, clocks, start, end, status: _status, ...sourceIdentity } = intent.reviewedRow;
        void _status;
        const observed = clock();
        if (!Number.isFinite(observed) || observed < started || observed - started > 60_000) throw Error();
        const evidence = requireTimingEvidence(result.evidence, { bookingId, sourceIdentity,
          clocks: { start, end, ...clocks }, observedAt: new Date(observed).toISOString(),
          route: { remoteBookingId: intent.remoteBookingId, threadId: intent.threadId }, context: intent.context }, observed);
        if (evidence.captureId !== intent.captureId) throw Error();
        return { state: result.state, bindingId: result.bindingId, canSend: false as const };
      } catch { return { state: 'uncertain' as const, canSend: false as const }; }
    },
    async load(bindingId: string, expected: Expected, now: number) {
      if (options.enabled !== true) return null;
      if (!id.safeParse(bindingId).success) throw Error('Timing binding unavailable');
      try {
        const r = await rpc('helm_channex_timing_binding_read', { p_binding_id: bindingId });
        if (!r || r.error !== null) throw Error();
        if (r.data === null) return null;
        const result = saved.parse(r.data);
        if (result.bindingId !== bindingId) throw Error();
        return requireTimingEvidence(result.evidence, expected, now);
      } catch { throw Error('Timing binding unavailable'); }
    },
  };
}
