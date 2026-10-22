/** Existing-cron adapter. Disabled unless one property/environment is explicit. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildMergeContext, overrideBodyProblem, renderTemplate } from '../automations-core.ts';
import { ChannexMessageTransport } from './transport.ts';
import { ChannexMessageWorker, createChannexJobStore, type ChannexJob, type MessageRpc } from './worker.ts';

export type MessageCronConfig = { propertyId: string; environment: 'staging' | 'production'; apiKey: string };
export function messageCronConfig(env: Record<string, string | undefined>): MessageCronConfig | null {
  if (env.CHANNEX_MESSAGES_ENABLED !== 'true') return null;
  const propertyId = env.CHANNEX_MESSAGES_PROPERTY_ID?.trim();
  const environment = env.CHANNEX_MESSAGES_ENVIRONMENT;
  const apiKey = env.CHANNEX_MESSAGES_API_KEY?.trim();
  if (!propertyId || propertyId.length > 128 || !apiKey || !['staging', 'production'].includes(environment ?? '')) {
    throw Error('Channex message configuration incomplete');
  }
  return { propertyId, environment: environment as MessageCronConfig['environment'], apiKey };
}
const nullableText = z.string().nullable();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/);
const instant = z.string().refine(s => Number.isFinite(Date.parse(s)));
const inputSchema = z.object({
  booking: z.object({ guest_name: nullableText, check_in: day, check_out: day }),
  guest: z.object({ first_name: nullableText, full_name: nullableText }),
  property: z.object({ name: z.string().min(1), title: nullableText, address: nullableText, wifi_name: nullableText, parking: nullableText }),
  plan: z.object({ checkin_time: clock, checkout_time: clock }),
  access: z.object({ smart_lock_code: nullableText, key_code_location: nullableText, wifi_password: nullableText }),
  stayCode: nullableText, lockMapped: z.boolean(), trashDay: nullableText, timeZone: z.string().min(1),
});
const snapshotSchema = z.object({
  propertyId: z.string(), environment: z.enum(['staging', 'production']), status: z.string(),
  revision: z.string().regex(/^[a-f0-9]{32}$/).nullable(), fireAt: instant.nullable(), renderAt: instant,
  body: nullableText, input: z.unknown(),
});
export function renderScheduledMessage(snapshot: Pick<z.infer<typeof snapshotSchema>, 'input' | 'revision' | 'fireAt' | 'renderAt' | 'body'>) {
  // Never propagate Zod's raw errors: they can include property/guest/access data.
  const parsed = inputSchema.safeParse(snapshot.input);
  if (!parsed.success || !snapshot.revision || !snapshot.fireAt || !snapshot.body) throw Error('Message context incomplete');
  const input = parsed.data;
  if (input.booking.check_out <= input.booking.check_in) throw Error('Message stay dates invalid');
  const context = buildMergeContext({ ...input, adjustment: null, now: new Date(snapshot.renderAt) });
  const rendered = renderTemplate(snapshot.body, context);
  if (rendered.missing.length || !rendered.text || overrideBodyProblem(rendered.text) || /{{|}}/.test(rendered.text)
      || Buffer.byteLength(rendered.text, 'utf8') > 10_240) throw Error('Message render incomplete');
  return { text: rendered.text, contextRevision: snapshot.revision,
    bodySha256: createHash('sha256').update(rendered.text).digest('hex') };
}
export type MessageCronSummary = {
  enabled: boolean; dry: boolean; candidates: number; refreshed: number; held: number;
  accepted: number; recorded: number; blocked: number; attention: number;
};
type TransportFactory = (job: ChannexJob, apiKey: string) => Pick<ChannexMessageTransport, 'sendText' | 'verifyReceipt'>;
/** No discovery/registration, source activation, retries, or manual fallback. */
export async function runScheduledChannexMessages(options: {
  config: MessageCronConfig | null; rpc: MessageRpc; propertyId?: string | null; dry?: boolean;
  transportFactory?: TransportFactory;
}): Promise<MessageCronSummary> {
  const { config, rpc } = options;
  const summary: MessageCronSummary = { enabled: config !== null, dry: options.dry === true,
    candidates: 0, refreshed: 0, held: 0, accepted: 0, recorded: 0, blocked: 0, attention: 0 };
  if (!config || (options.propertyId && options.propertyId !== config.propertyId)) return summary;
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await rpc(name, args).catch(() => { throw Error('Channex message ledger unavailable'); });
    if (res.error) throw Error('Channex message ledger unavailable');
    return res.data;
  };
  const ids = await call('automation_channex_candidates', { p_property_id: config.propertyId, p_environment: config.environment, p_limit: 10 });
  const candidates = z.array(z.string().regex(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)).max(10).safeParse(ids);
  if (!candidates.success) throw Error('Channex message scan invalid');
  summary.candidates = candidates.data.length;
  if (summary.dry) return summary; // No snapshots, writes, provider calls or secrets.
  const store = createChannexJobStore(rpc);
  const startedAt = performance.now();
  for (const sendId of [...new Set(candidates.data)]) {
    if (performance.now() - startedAt > 120_000) break;
    try {
      const parsed = snapshotSchema.safeParse(await call('automation_channex_snapshot', { p_send_id: sendId }));
      if (!parsed.success || parsed.data.propertyId !== config.propertyId || parsed.data.environment !== config.environment) {
        summary.blocked++; continue;
      }
      const snapshot = parsed.data;
      const job = await store.read(sendId);
      if (!job || job.environment !== config.environment) { summary.blocked++; continue; }
      const factory = options.transportFactory ?? ((job, apiKey) => new ChannexMessageTransport({ scope: job, apiKey, sendEnabled: true }));
      const worker = new ChannexMessageWorker({ store, transport: factory(job, config.apiKey), enabled: true });
      if (job.state === 'accepted') {
        if ((await worker.reconcile(sendId)).state === 'recorded') summary.recorded++; else summary.attention++;
        continue;
      }
      if (job.state !== 'prepared' || !['scheduled', 'held'].includes(snapshot.status)) { summary.blocked++; continue; }
      const rendered = renderScheduledMessage(snapshot);
      if (await call('automation_channex_refresh', { p_send_id: sendId, p_revision: snapshot.revision,
        p_body_sha256: rendered.bodySha256, p_fire_at: snapshot.fireAt }) !== true) { summary.blocked++; continue; }
      summary.refreshed++;
      if (snapshot.status === 'held') { summary.held++; continue; }
      // SQL revalidates the clock and every mutable dependency at final claim.
      if (Date.parse(snapshot.fireAt!) > Date.parse(snapshot.renderAt)) continue;
      const result = await worker.dispatch(sendId, async () => rendered);
      if (result.state === 'accepted') summary.accepted++;
      else if (result.state === 'ledger_uncertain' && result.outcome) {
        // Retry only the idempotent database receipt write, never the POST.
        const saved = await store.finish(sendId, result.attemptId, result.outcome);
        if (saved && result.outcome.state === 'accepted') summary.accepted++; else summary.attention++;
      }
      else if (result.state === 'blocked') summary.blocked++;
      else summary.attention++;
    } catch { summary.attention++; }
    finally {
      try { await call('automation_channex_checked', { p_send_id: sendId }); }
      catch { summary.attention++; }
    }
  }
  return summary;
}
