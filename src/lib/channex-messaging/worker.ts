/** Durable execution of an existing automation_sends row. No env loader or cron. */
import { createHash, randomUUID } from 'node:crypto';
import { overrideBodyProblem } from '../automations-core.ts';
import type { ChannexMessageTransport, MessageAttempt, MessageReceipt } from './transport.ts';

export type ChannexJob = Readonly<MessageAttempt & {
  sendId: string;
  contextRevision: string;
  state: 'prepared' | 'attempting' | 'unknown' | 'rejected' | 'accepted' | 'recorded';
  attemptId: string | null;
  providerMessageId: string | null;
}>;
export type AttemptOutcome =
  | { state: 'unknown' }
  | { state: 'rejected'; status: number }
  | { state: 'accepted' | 'recorded'; providerMessageId: string };
export interface ChannexJobStore {
  read(sendId: string): Promise<ChannexJob | null>;
  claim(sendId: string, attemptId: string, attempt: MessageAttempt): Promise<boolean>;
  finish(sendId: string, attemptId: string, outcome: AttemptOutcome): Promise<boolean>;
}
export type WorkerResult =
  | { state: 'disabled' | 'blocked' | 'needs_reconciliation' | 'unconfirmed' | 'recorded' }
  | { state: 'accepted' | 'rejected' | 'unknown'; attemptId: string }
  | { state: 'ledger_uncertain'; attemptId: string; outcome?: AttemptOutcome };
const isId = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const sameAttempt = (job: ChannexJob, attempt: MessageAttempt) =>
  (['environment', 'propertyId', 'channelId', 'provider', 'bookingId', 'threadId', 'bodySha256'] as const)
    .every(k => job[k] === attempt[k]);

/**
 * The renderer must use authoritative current data; it returns the context revision
 * it rendered. SQL rechecks that revision, the schedule, hold and source handoff at
 * the final claim. Bodies exist only in memory. No unknown result is retryable.
 */
export class ChannexMessageWorker {
  #store: ChannexJobStore;
  #transport: Pick<ChannexMessageTransport, 'sendText' | 'verifyReceipt'>;
  #enabled: boolean;
  constructor(options: { store: ChannexJobStore; transport: Pick<ChannexMessageTransport, 'sendText' | 'verifyReceipt'>; enabled?: boolean }) {
    if (typeof window !== 'undefined') throw Error('Message worker requires a server');
    this.#store = options.store;
    this.#transport = options.transport;
    this.#enabled = options.enabled === true;
  }
  async dispatch(sendId: string, render: (job: ChannexJob) => Promise<{ text: string; contextRevision: string }>): Promise<WorkerResult> {
    if (!this.#enabled) return { state: 'disabled' };
    if (!isId(sendId)) return { state: 'blocked' };
    let job: ChannexJob;
    let text: string;
    try {
      const loaded = await this.#store.read(sendId);
      if (!loaded || loaded.sendId !== sendId) return { state: 'blocked' };
      job = Object.freeze({ ...loaded });
      if (job.state !== 'prepared' || job.attemptId !== null) return { state: 'needs_reconciliation' };
      const rendered = await render(job);
      if (typeof rendered.text !== 'string' || overrideBodyProblem(rendered.text) || rendered.contextRevision !== job.contextRevision
          || digest(rendered.text) !== job.bodySha256) return { state: 'blocked' };
      text = rendered.text;
    } catch { return { state: 'blocked' }; }
    const attemptId = randomUUID();
    let claimed = false, claimUncertain = false;
    let outcome: AttemptOutcome;
    try {
      const result = await this.#transport.sendText({ bookingId: job.bookingId, threadId: job.threadId, text }, async attempt => {
        if (claimed || claimUncertain || !sameAttempt(job, attempt)) return false;
        // A lost database response may conceal a committed claim. Never POST on
        // that response, and never infer that the row can safely be claimed again.
        claimUncertain = true;
        claimed = await this.#store.claim(sendId, attemptId, attempt) === true;
        claimUncertain = false;
        return claimed;
      });
      if (!claimed) return claimUncertain ? { state: 'ledger_uncertain', attemptId } : { state: 'blocked' };
      if (result.state === 'accepted' && sameAttempt(job, result.receipt) && isId(result.receipt.providerMessageId)) {
        outcome = { state: 'accepted', providerMessageId: result.receipt.providerMessageId };
      } else if (result.state === 'rejected' && [401, 403, 404, 422].includes(result.status)) {
        outcome = { state: 'rejected', status: result.status };
      } else {
        outcome = { state: 'unknown' };
      }
    } catch {
      if (!claimed) return claimUncertain ? { state: 'ledger_uncertain', attemptId } : { state: 'blocked' };
      outcome = { state: 'unknown' };
    }
    try {
      if (await this.#store.finish(sendId, attemptId, outcome) !== true) return { state: 'ledger_uncertain', attemptId, outcome };
    } catch { return { state: 'ledger_uncertain', attemptId, outcome }; }
    return { state: outcome.state as 'accepted' | 'rejected' | 'unknown', attemptId };
  }
  /** Read-only provider recovery. An uncertain send without an ID needs review. */
  async reconcile(sendId: string): Promise<WorkerResult> {
    if (!isId(sendId)) return { state: 'blocked' };
    try {
      const loaded = await this.#store.read(sendId);
      if (!loaded || loaded.sendId !== sendId) return { state: 'blocked' };
      const job = Object.freeze({ ...loaded });
      if (job.state === 'recorded') return { state: 'recorded' };
      if (job.state !== 'accepted' || !job.attemptId || !job.providerMessageId) return { state: 'needs_reconciliation' };
      const receipt: MessageReceipt = { environment: job.environment, propertyId: job.propertyId,
        channelId: job.channelId, provider: job.provider, bookingId: job.bookingId,
        threadId: job.threadId, bodySha256: job.bodySha256, providerMessageId: job.providerMessageId };
      if ((await this.#transport.verifyReceipt(receipt)).state !== 'recorded') return { state: 'unconfirmed' };
      if (await this.#store.finish(sendId, job.attemptId, { state: 'recorded', providerMessageId: job.providerMessageId }) !== true) {
        return { state: 'ledger_uncertain', attemptId: job.attemptId };
      }
      return { state: 'recorded' };
    } catch { return { state: 'unconfirmed' }; }
  }
}

export type MessageRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
/** Concrete PostgREST RPC adapter; caller supplies its explicit service-role client. */
export function createChannexJobStore(rpc: MessageRpc): ChannexJobStore {
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await rpc(name, args);
    if (result.error) throw Error('Message ledger unavailable');
    return result.data;
  };
  return {
    async read(sendId) {
      if (!isId(sendId)) throw Error('Invalid message identity');
      const data = await call('automation_channex_read', { p_send_id: sendId });
      if (data === null) return null;
      const row = data as ChannexJob;
      if (!row || row.sendId !== sendId || !['staging', 'production'].includes(row.environment)
          || !['Airbnb', 'BookingCom'].includes(row.provider)
          || ![row.propertyId, row.channelId, row.bookingId, row.threadId].every(isId)
          || !/^[a-f0-9]{64}$/.test(row.bodySha256) || !/^[a-f0-9]{32}$/.test(row.contextRevision)
          || !['prepared', 'attempting', 'unknown', 'rejected', 'accepted', 'recorded'].includes(row.state)
          || (row.state === 'prepared' ? row.attemptId !== null : !isId(row.attemptId))
          || (['accepted', 'recorded'].includes(row.state) ? !isId(row.providerMessageId) : row.providerMessageId !== null)) {
        throw Error('Invalid message ledger response');
      }
      // Do not propagate unexpected fields (including raw bodies) from storage.
      return Object.freeze({ sendId, environment: row.environment, propertyId: row.propertyId, channelId: row.channelId,
        provider: row.provider, bookingId: row.bookingId, threadId: row.threadId, bodySha256: row.bodySha256,
        contextRevision: row.contextRevision, state: row.state, attemptId: row.attemptId, providerMessageId: row.providerMessageId });
    },
    async claim(sendId, attemptId, attempt) {
      if (!isId(sendId) || !isId(attemptId)) throw Error('Invalid message identity');
      const data = await call('automation_channex_claim', { p_send_id: sendId, p_attempt_id: attemptId, p_attempt: attempt });
      if (typeof data !== 'boolean') throw Error('Uncertain message claim');
      return data;
    },
    async finish(sendId, attemptId, outcome) {
      if (!isId(sendId) || !isId(attemptId)) throw Error('Invalid message identity');
      const data = await call('automation_channex_finish', { p_send_id: sendId, p_attempt_id: attemptId,
        p_state: outcome.state, p_provider_id: 'providerMessageId' in outcome ? outcome.providerMessageId : null,
        p_rejection_status: 'status' in outcome ? outcome.status : null });
      if (typeof data !== 'boolean') throw Error('Uncertain message receipt');
      return data;
    },
  };
}
