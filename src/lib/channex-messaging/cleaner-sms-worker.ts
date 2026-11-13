import 'server-only';
/** Cleaner delivery protocol, dormant until a durable store and reviewed schedule
 * runtime are installed. Injected stores MUST atomically recheck source clearance,
 * current context, recipient, release, due time and holds before issuing one permit.
 * This module does not assert that those prerequisites exist in production. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { renderTemplate, templateFields } from '../automations-core.ts';
import { cleanerReminderRecipientSchema, resolveCleanerReminderLink } from '../cleaner-reminder-link.ts';
import { preparedRulePolicy, type PreparationRule } from './preparation-rules.ts';
import { formatGuestyMessageDate } from './preparation-render.ts';
import { reviewCalderwoodTiming, type SourceClocks } from './preparation-timing.ts';
import { CleanerSmsTransport, cleanerSmsId, type CleanerSmsAttempt, type CleanerSmsReceipt,
  type CleanerSmsStatus } from './cleaner-sms-transport.ts';

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), instant = z.iso.datetime({ offset: true });
const key = z.enum(['cleaner_reminder', 'cleaner_arrival']);
const jobSchema = z.object({ sendId: id, bookingId: id, automationId: id, releaseId: id,
  propertyId: z.literal('65_calderwood'), key, keyId: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
  contextRevision: z.string().regex(/^[a-f0-9]{32}$/), recipientHmac: hash, targetHmac: hash, bodySha256: hash,
  fireAt: instant, expiresAt: instant,
  state: z.enum(['prepared', 'attempting', 'aborted', 'unknown', 'rejected', 'accepted', 'delivered', 'undelivered']),
  attemptId: id.nullable(), providerMessageId: z.string().refine(cleanerSmsId).nullable(),
  providerStatus: z.enum(['queued', 'sent', 'delivered', 'undelivered']).nullable(),
  providerUpdatedAt: instant.nullable(),
}).strict().superRefine((j, ctx) => {
  const duration = Date.parse(j.expiresAt) - Date.parse(j.fireAt);
  if (duration <= 0 || duration > 30 * 60000 || (j.state === 'prepared') !== (j.attemptId === null)
    || ['accepted', 'delivered', 'undelivered'].includes(j.state) !== (j.providerMessageId !== null)
    || (j.providerMessageId !== null) !== (j.providerStatus !== null)
    || (j.providerUpdatedAt !== null && j.providerMessageId === null)
    || (['delivered', 'undelivered'].includes(j.state) && (j.providerStatus !== j.state || !j.providerUpdatedAt)))
    ctx.addIssue({ code: 'custom', message: 'Invalid cleaner delivery job' });
});
export type CleanerSmsJob = Readonly<z.infer<typeof jobSchema>>;
export const parseCleanerSmsJob = (value: unknown): CleanerSmsJob => Object.freeze(jobSchema.parse(value));
export type CleanerSmsOutcome = { state: 'unknown' | 'aborted' } | { state: 'rejected'; rejectionStatus: number }
  | { state: 'accepted'; providerMessageId: string; providerStatus: CleanerSmsStatus }
  | { state: 'delivered' | 'undelivered' | 'accepted'; providerMessageId: string; providerStatus: CleanerSmsStatus; providerUpdatedAt: string };
export interface CleanerSmsStore {
  read(sendId: string): Promise<unknown>;
  // false/throw can NEVER authorize POST. The same attempt ID replay returns false.
  claim(job: CleanerSmsJob, attemptId: string, attempt: CleanerSmsAttempt): Promise<boolean>;
  // Idempotent outcome writes, immutable target; no state can return to prepared.
  finish(sendId: string, attemptId: string, outcome: CleanerSmsOutcome): Promise<boolean>;
}
export type CleanerSmsReview = {
  contextRevision: string; rule: PreparationRule; clocks: SourceClocks;
  propertyName: string; recipients: readonly unknown[];
};
export type CleanerWorkerResult = { state: 'disabled' | 'blocked' | 'needs_reconciliation' | 'unconfirmed'
  | 'aborted' | 'accepted' | 'rejected' | 'unknown' | 'delivered' | 'undelivered' }
  | { state: 'ledger_uncertain'; attemptId: string; outcome?: CleanerSmsOutcome };

const fields = ['property_name', 'check_in_long', 'check_out_long', 'cleaner_schedule_url'];
const recipients = z.array(cleanerReminderRecipientSchema).max(200);
/** Wire render stays server-only. Frozen retained wording is required; the durable
 * release/store supplies permission separately. No property deadline substitutes
 * for Guesty's arrival clock and no confirmation timestamp is needed for SMS. */
export function renderRetainedCleanerSms(review: CleanerSmsReview, transport: CleanerSmsTransport, now: number) {
  const { rule, clocks } = review;
  if (!key.safeParse(rule?.key).success || !preparedRulePolicy(rule, now)
    || !/^[a-f0-9]{32}$/.test(review.contextRevision)
    || typeof review.propertyName !== 'string' || !review.propertyName.trim() || review.propertyName.length > 200
    || templateFields(rule.body).some(f => !fields.includes(f))) throw Error('Cleaner render needs review');
  const rs = recipients.parse(review.recipients);
  const link = resolveCleanerReminderLink('65_calderwood', rs);
  const selected = rs.filter(r => r.enabled && r.property_ids.length === 1 && r.property_ids[0] === '65_calderwood');
  if (!link || selected.length !== 1) throw Error('Cleaner recipient needs review');
  const timing = reviewCalderwoodTiming(clocks, now).find(t => t.key === rule.key)!;
  if (!timing.at || timing.status === 'dst_review'
    || (rule.key === 'cleaner_arrival' && (clocks.plannedArrival === null ? clocks.defaultArrival : clocks.plannedArrival) !== '16:00'))
    throw Error('Cleaner timing needs review');
  const body = renderTemplate(rule.body, { property_name: review.propertyName,
    check_in_long: formatGuestyMessageDate(clocks.start), check_out_long: formatGuestyMessageDate(clocks.end),
    cleaner_schedule_url: link.url });
  const attempt = transport.attempt(link.phone, body.text);
  if (body.missing.length || !attempt) throw Error('Cleaner body needs review');
  return { text: body.text, phone: link.phone, fireAt: timing.at, contextRevision: review.contextRevision,
    automationId: rule.id, key: rule.key, ...attempt,
    recipientHmac: transport.fingerprint('recipient', JSON.stringify([selected[0].region,
      selected[0].property_ids, link.phone, link.token, link.language])) };
}
const sameAttempt = (job: CleanerSmsAttempt, attempt: CleanerSmsAttempt) =>
  (['keyId', 'targetHmac', 'bodySha256'] as const).every(k => job[k] === attempt[k]);

export class CleanerSmsWorker {
  #store: CleanerSmsStore;
  #transport: CleanerSmsTransport;
  #enabled: boolean;
  #clock: () => number;
  constructor(options: { store: CleanerSmsStore; transport: CleanerSmsTransport; enabled?: boolean; clock?: () => number }) {
    this.#store = options.store; this.#transport = options.transport;
    this.#enabled = options.enabled === true; this.#clock = options.clock ?? Date.now;
  }
  async dispatch(sendId: string, review: (job: CleanerSmsJob) => Promise<CleanerSmsReview>): Promise<CleanerWorkerResult> {
    if (!this.#enabled) return { state: 'disabled' };
    if (!id.safeParse(sendId).success) return { state: 'blocked' };
    let job: CleanerSmsJob;
    let initial: ReturnType<typeof renderRetainedCleanerSms>;
    const started = this.#clock();
    const freshAndDue = () => {
      const now = this.#clock();
      return Number.isFinite(now) && Number.isFinite(started) && now >= started && now - started <= 10000
        && now >= Date.parse(job.fireAt) && now < Date.parse(job.expiresAt);
    };
    const matches = (v: ReturnType<typeof renderRetainedCleanerSms>) => sameAttempt(job, v)
      && v.contextRevision === job.contextRevision && v.recipientHmac === job.recipientHmac
      && v.automationId === job.automationId && v.key === job.key && Date.parse(v.fireAt) === Date.parse(job.fireAt);
    try {
      job = Object.freeze(jobSchema.parse(await this.#store.read(sendId)));
      if (job.sendId !== sendId) return { state: 'blocked' };
      if (job.state !== 'prepared') return { state: 'needs_reconciliation' };
      if (!freshAndDue()) return { state: 'blocked' };
      initial = renderRetainedCleanerSms(await review(job), this.#transport, this.#clock());
      if (!matches(initial) || !freshAndDue()) return { state: 'blocked' };
    } catch { return { state: 'blocked' }; }
    const attemptId = randomUUID();
    let claimed = false, claimUncertain = false;
    let outcome: CleanerSmsOutcome;
    try {
      const result = await this.#transport.send(initial.phone, initial.text, async attempt => {
        if (claimed || claimUncertain || !sameAttempt(job, attempt) || !freshAndDue()) return false;
        const current = renderRetainedCleanerSms(await review(job), this.#transport, this.#clock());
        if (!matches(current) || JSON.stringify(current) !== JSON.stringify(initial) || !freshAndDue()) return false;
        claimUncertain = true;
        claimed = await this.#store.claim(job, attemptId, attempt) === true;
        claimUncertain = false;
        return claimed && freshAndDue();
      });
      if (!claimed) return claimUncertain ? { state: 'ledger_uncertain', attemptId } : { state: 'blocked' };
      if (result.state === 'accepted' && sameAttempt(job, result.receipt))
        outcome = { state: 'accepted', providerMessageId: result.receipt.providerMessageId, providerStatus: result.status };
      else if (result.state === 'rejected') outcome = { state: 'rejected', rejectionStatus: result.status };
      else outcome = { state: result.state === 'not_sent' ? 'aborted' : 'unknown' };
    } catch {
      if (!claimed) return claimUncertain ? { state: 'ledger_uncertain', attemptId } : { state: 'blocked' };
      outcome = { state: 'unknown' };
    }
    try {
      if (await this.#store.finish(sendId, attemptId, outcome) !== true) return { state: 'ledger_uncertain', attemptId, outcome };
    } catch { return { state: 'ledger_uncertain', attemptId, outcome }; }
    return { state: outcome.state };
  }
  async reconcile(sendId: string): Promise<CleanerWorkerResult> {
    if (!this.#enabled) return { state: 'disabled' };
    if (!id.safeParse(sendId).success) return { state: 'blocked' };
    try {
      const job = jobSchema.parse(await this.#store.read(sendId));
      if (job.sendId !== sendId) return { state: 'blocked' };
      if (job.state === 'delivered' || job.state === 'undelivered') return { state: job.state };
      if (job.state !== 'accepted' || !job.attemptId || !job.providerMessageId) return { state: 'needs_reconciliation' };
      const receipt: CleanerSmsReceipt = { keyId: job.keyId, targetHmac: job.targetHmac,
        bodySha256: job.bodySha256, providerMessageId: job.providerMessageId };
      const result = await this.#transport.verify(receipt);
      if (result.state !== 'verified' || (job.providerUpdatedAt !== null && Date.parse(result.updatedAt) < Date.parse(job.providerUpdatedAt))
        || (job.providerStatus !== result.status && (['delivered', 'undelivered'].includes(job.providerStatus!)
          || job.providerStatus === 'sent' && result.status === 'queued'))) return { state: 'unconfirmed' };
      const outcome: CleanerSmsOutcome = { state: result.status === 'delivered' || result.status === 'undelivered' ? result.status : 'accepted',
        providerMessageId: job.providerMessageId, providerStatus: result.status, providerUpdatedAt: result.updatedAt };
      if (await this.#store.finish(sendId, job.attemptId, outcome) !== true)
        return { state: 'ledger_uncertain', attemptId: job.attemptId, outcome };
      return { state: outcome.state };
    } catch { return { state: 'unconfirmed' }; }
  }
}
