import 'server-only';
import { z } from 'zod';
import { parseCleanerSmsJob, type CleanerSmsJob, type CleanerSmsOutcome, type CleanerSmsStore } from './cleaner-sms-worker.ts';
import { cleanerSmsId } from './cleaner-sms-transport.ts';
import type { MessageRpc } from './store.ts';
const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), instant = z.iso.datetime({ offset: true, precision: 3 });
export const cleanerSmsPlanSchema = z.object({ sendId: id, bookingId: id, automationId: id, releaseId: id, bindingId: id,
  propertyId: z.literal('65_calderwood'), key: z.enum(['cleaner_reminder', 'cleaner_arrival']),
  keyId: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/), contextRevision: z.string().regex(/^[a-f0-9]{32}$/),
  recipientHmac: hash, targetHmac: hash, bodySha256: hash, fireAt: instant, expiresAt: instant,
}).strict().refine(v => Date.parse(v.fireAt) < Date.parse(v.expiresAt)
  && Date.parse(v.expiresAt) - Date.parse(v.fireAt) <= 1800000);
export type CleanerSmsPlan = z.infer<typeof cleanerSmsPlanSchema>;
const outcomeSchema = z.union([
  z.object({ state: z.enum(['aborted', 'unknown']) }).strict(),
  z.object({ state: z.literal('rejected'), rejectionStatus: z.union([z.literal(400), z.literal(401), z.literal(402), z.literal(403), z.literal(404)]) }).strict(),
  z.object({ state: z.enum(['accepted', 'delivered', 'undelivered']), providerMessageId: z.string().refine(cleanerSmsId),
    providerStatus: z.enum(['queued', 'sent', 'delivered', 'undelivered']), providerUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  }).strict().refine(v => v.state === 'accepted' || v.providerStatus === v.state && !!v.providerUpdatedAt),
]);

/** Default-off, service-only RPC adapter. It cannot enroll a recipient, manufacture
 * source clearance, release original templates or switch the sender. */
export function createCleanerSmsStore(rpc: MessageRpc, options: { enabled?: boolean } = {}): CleanerSmsStore & {
  register(raw: unknown): Promise<{ state: 'disabled' | 'created' | 'existing'; sendId?: string }>;
  hold(sendId: string, held: boolean, actor: string): Promise<boolean>;
} {
  const enabled = options.enabled === true;
  const call = async (name: string, args: Record<string, unknown>) => {
    try { const result = await rpc(name, args); if (!result || result.error !== null) throw Error(); return result.data; }
    catch { throw Error('Cleaner schedule unavailable'); }
  };
  const boolean = async (name: string, args: Record<string, unknown>) => {
    const value = await call(name, args); if (typeof value !== 'boolean') throw Error('Cleaner schedule outcome uncertain'); return value;
  };
  return {
    async read(sendId) {
      if (!enabled) return null;
      id.parse(sendId);
      const raw = await call('helm_channex_cleaner_read', { p_send_id: sendId });
      if (raw === null) return null;
      const job = parseCleanerSmsJob(raw);
      if (job.sendId !== sendId) throw Error('Cleaner schedule identity mismatch');
      return job;
    },
    async register(raw) {
      if (!enabled) return { state: 'disabled' };
      const plan = cleanerSmsPlanSchema.parse(raw);
      const data = z.object({ state: z.enum(['created', 'existing']), sendId: id }).strict()
        .parse(await call('helm_channex_cleaner_register', { p_plan: plan }));
      if (data.sendId !== plan.sendId) throw Error('Cleaner schedule identity mismatch');
      return data;
    },
    async claim(rawJob, attemptId, attempt) {
      if (!enabled) return false;
      const job: CleanerSmsJob = parseCleanerSmsJob(rawJob); id.parse(attemptId);
      const proof = z.object({ keyId: z.literal(job.keyId), targetHmac: z.literal(job.targetHmac), bodySha256: z.literal(job.bodySha256) }).strict().parse(attempt);
      if (job.state !== 'prepared') return false;
      return boolean('helm_channex_cleaner_claim', { p_job: job, p_attempt_id: attemptId, p_attempt: proof });
    },
    async finish(sendId, attemptId, outcome: CleanerSmsOutcome) {
      if (!enabled) return false;
      id.parse(sendId); id.parse(attemptId);
      return boolean('helm_channex_cleaner_finish', { p_send_id: sendId, p_attempt_id: attemptId, p_outcome: outcomeSchema.parse(outcome) });
    },
    async hold(sendId, held, actor) {
      if (!enabled) return false;
      id.parse(sendId); z.boolean().parse(held); const name = z.string().trim().min(1).max(200).parse(actor);
      return boolean('helm_channex_cleaner_hold', { p_send_id: sendId, p_held: held, p_actor: name });
    },
  };
}
