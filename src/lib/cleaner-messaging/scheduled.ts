/** Bounded per-recipient execution on the existing automation cron. Disabled by default. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { renderScheduledMessage } from '../channex-messaging/scheduled.ts';
import { quoFromNumber } from '../quo-lines.ts';
import { createCleanerTransport, type CleanerOutcome, type CleanerTransport } from './transport.ts';
export type CleanerConfig = { propertyId: string; apiKey: string };
export function cleanerConfig(env: Record<string, string | undefined>): CleanerConfig | null {
  if (env.CLEANER_MESSAGES_ENABLED !== 'true') return null;
  const propertyId = env.CLEANER_MESSAGES_PROPERTY_ID?.trim(), apiKey = env.QUO_API_KEY?.trim();
  if (!propertyId || propertyId.length > 128 || !apiKey || /[\r\n]/.test(apiKey)) throw Error('Cleaner message configuration incomplete');
  return { propertyId, apiKey };
}
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const uuid = z.string().regex(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const snapshotSchema = z.object({
  jobId: uuid, sendId: uuid, propertyId: z.string(), status: z.string(),
  state: z.enum(['prepared','attempting','unknown','rejected','accepted','delivered','undelivered']),
  attemptId: uuid.nullable(), providerMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
  from: z.string(), to: z.string(), bodySha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  revision: z.string().regex(/^[a-f0-9]{32}$/).nullable(), fireAt: z.string().nullable(), renderAt: z.string(),
  body: z.string().nullable(), input: z.unknown(),
});
export async function runScheduledCleanerMessages(options: {
  config: CleanerConfig | null; rpc: Rpc; propertyId?: string | null; dry?: boolean; transport?: CleanerTransport;
}) {
  const summary = { enabled: options.config !== null, dry: options.dry === true, candidates: 0, accepted: 0, delivered: 0, held: 0, blocked: 0, attention: 0 };
  const config = options.config;
  if (!config || (options.propertyId && options.propertyId !== config.propertyId)) return summary;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await options.rpc(name, args).catch(() => { throw Error('Cleaner message ledger unavailable'); });
    if (result.error) throw Error('Cleaner message ledger unavailable'); return result.data;
  };
  const scan = z.array(uuid).max(10).safeParse(await call('automation_cleaner_candidates', { p_property_id: config.propertyId }));
  if (!scan.success) throw Error('Cleaner message scan invalid');
  summary.candidates = scan.data.length;
  if (summary.dry) return summary;
  const transport = options.transport ?? createCleanerTransport({ apiKey: config.apiKey, enabled: true });
  const started = performance.now();
  for (const jobId of [...new Set(scan.data)]) {
    if (performance.now() - started > 90_000) break;
    try {
      const parsed = snapshotSchema.safeParse(await call('automation_cleaner_snapshot', { p_job_id: jobId }));
      if (!parsed.success || parsed.data.jobId !== jobId || parsed.data.propertyId !== config.propertyId) { summary.blocked++; continue; }
      const job = parsed.data;
      const save = (attemptId: string, outcome: CleanerOutcome) => call('automation_cleaner_finish', {
        p_job_id: jobId, p_attempt_id: attemptId, p_state: outcome.state,
        p_provider_id: 'providerMessageId' in outcome ? outcome.providerMessageId : null,
      });
      if (job.state === 'accepted' && job.providerMessageId && job.attemptId && job.bodySha256) {
        const state = await transport.receipt({ from: job.from, to: job.to, bodySha256: job.bodySha256 }, job.providerMessageId);
        if (state === 'unconfirmed') { summary.attention++; continue; }
        if (await save(job.attemptId, { state, providerMessageId: job.providerMessageId }) === true && state === 'delivered') summary.delivered++;
        else summary.attention++;
        continue;
      }
      if (job.state !== 'prepared' || job.attemptId) { summary.attention++; continue; }
      if (await call('automation_cleaner_refresh', { p_job_id: jobId, p_revision: job.revision, p_fire_at: job.fireAt }) !== true) { summary.blocked++; continue; }
      if (job.status === 'held') { summary.held++; continue; }
      if (!['scheduled','sending'].includes(job.status) || job.from !== quoFromNumber('ops')) { summary.blocked++; continue; }
      if (Date.parse(job.fireAt!) > Date.parse(job.renderAt)) continue;
      const rendered = renderScheduledMessage(job);
      const attemptId = randomUUID(); let claimed = false, uncertain = false;
      const target = { from: job.from, to: job.to, bodySha256: rendered.bodySha256 };
      const result = await transport.send(target, rendered.text, async () => {
        if (claimed || uncertain) return false;
        uncertain = true;
        claimed = await call('automation_cleaner_claim', { p_job_id: jobId, p_attempt_id: attemptId,
          p_revision: job.revision, p_fire_at: job.fireAt, p_target: target }) === true;
        uncertain = false; return claimed;
      });
      if (result.state === 'blocked') { if (uncertain || claimed) summary.attention++; else summary.blocked++; continue; }
      if (!claimed) { summary.attention++; continue; }
      // Retry only the receipt write. The provider call must never repeat.
      let saved = false;
      for (let n = 0; n < 2 && !saved; n++) { try { saved = await save(attemptId, result) === true; } catch { /* receipt-only retry */ } }
      if (saved && result.state === 'accepted') summary.accepted++; else summary.attention++;
    } catch { summary.attention++; }
    finally { try { await call('automation_cleaner_checked', { p_job_id: jobId }); } catch { summary.attention++; } }
  }
  return summary;
}
