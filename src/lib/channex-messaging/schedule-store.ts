import 'server-only';
import { z } from 'zod';
import type { MessageRpc } from './store.ts';

const id = z.uuid(), instant = z.iso.datetime({ offset: true });
export const scheduleContextSchema = z.object({ contextRevision: z.string().regex(/^[a-f0-9]{32}$/), routeGeneration: id,
  sourceEvidenceId: id, sourceEvidenceAt: instant }).strict();
export const scheduleRegistrationSchema = scheduleContextSchema.extend({
  sendId: id, bookingId: id, automationId: id,
  key: z.enum(['booking_confirmed', 'pre_arrival', 'checkin_day', 'pre_checkout']),
  remoteBookingId: id, threadId: id, bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  fireAt: instant, expiresAt: instant,
}).strict().refine(p => {
  const window = Date.parse(p.expiresAt) - Date.parse(p.fireAt);
  return window > 0 && window <= 86_400_000;
});
export type ScheduleRegistration = z.infer<typeof scheduleRegistrationSchema>;
export type ScheduleRegistrationResult =
  | { state: 'disabled' | 'invalid' | 'uncertain'; canSend: false }
  | { state: 'created' | 'existing'; sendId: string; canSend: false };

/** Service-only atomic schedule writer. No env loader, provider, HTTP route or cron.
 * A caller must retain the exact intent/sendId across an uncertain response. It
 * must not dispatch merely because a schedule exists: the existing worker's
 * render/context check and one-use SQL claim remain mandatory. Frozen migration
 * templates are still refused by SQL; this is not a cutover/activation API. */
export function createChannexScheduleStore(rpc: MessageRpc, options: { enabled?: boolean } = {}) {
  return {
    async context(bookingId: string) {
      if (options.enabled !== true) return null;
      if (!id.safeParse(bookingId).success) throw Error('Schedule context unavailable');
      try {
        const result = await rpc('helm_channex_message_schedule_context', { p_booking_id: bookingId });
        if (!result || result.error !== null) throw Error('RPC failed');
        return result.data === null ? null : scheduleContextSchema.parse(result.data);
      } catch { throw Error('Schedule context unavailable'); }
    },
    async register(value: unknown): Promise<ScheduleRegistrationResult> {
      if (options.enabled !== true) return { state: 'disabled', canSend: false };
      const parsed = scheduleRegistrationSchema.safeParse(value);
      if (!parsed.success) return { state: 'invalid', canSend: false };
      // Zod clones the request. The caller cannot mutate it while the RPC awaits.
      const intent = parsed.data;
      try {
        const result = await rpc('helm_channex_message_register', { p_plan: intent });
        if (!result || result.error !== null) throw Error('RPC failed');
        const saved = z.object({ state: z.enum(['created', 'existing']), sendId: id }).strict().parse(result.data);
        if (saved.sendId !== intent.sendId) throw Error('Registration identity mismatch');
        return { ...saved, canSend: false };
      } catch {
        // A timeout may hide a commit. No automatic retry, ID rotation or send.
        return { state: 'uncertain', canSend: false };
      }
    },
  };
}
