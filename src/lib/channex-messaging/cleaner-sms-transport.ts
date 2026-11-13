import 'server-only';
/** Calderwood SMS boundary. No environment loader, scheduler or production caller.
 * Quo contract: https://www.quo.com/docs/mdx/api-reference/messages/send-a-text-message
 * A 202 is acceptance, not delivery. Never retry a POST after any response. */
import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { overrideBodyProblem } from '../automations-core.ts';
import { QUO_LINES, quoFromNumber } from '../quo-lines.ts';

export type CleanerSmsAttempt = Readonly<{ keyId: string; targetHmac: string; bodySha256: string }>;
export type CleanerSmsReceipt = CleanerSmsAttempt & Readonly<{ providerMessageId: string }>;
export type CleanerSmsStatus = 'queued' | 'sent' | 'delivered' | 'undelivered';
export type CleanerSmsResult =
  | { state: 'not_sent' }
  | { state: 'unknown' }
  | { state: 'rejected'; status: number }
  | { state: 'accepted'; receipt: CleanerSmsReceipt; status: CleanerSmsStatus };
export type CleanerSmsReadback = { state: 'unconfirmed' }
  | { state: 'verified'; status: CleanerSmsStatus; updatedAt: string };
export type CleanerSmsFetcher = (url: string, init: RequestInit) => Promise<Response>;
const BASE = 'https://api.quo.com/v1/messages';
const phone = (v: unknown): v is string => typeof v === 'string' && /^\+[1-9]\d{7,14}$/.test(v);
export const cleanerSmsId = (v: unknown): v is string => typeof v === 'string' && /^AC[A-Za-z0-9_-]{1,100}$/.test(v);
const hashPattern = /^[a-f0-9]{64}$/;
const statuses: readonly string[] = ['queued', 'sent', 'delivered', 'undelivered'];
const instant = z.iso.datetime({ offset: true });
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
export function validCleanerSmsText(text: unknown): text is string {
  return typeof text === 'string' && !!text.trim() && [...text].length <= 1600
    && Buffer.byteLength(text) <= 6400 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
    && !/\{\{|\}\}/.test(text) && !overrideBodyProblem(text);
}
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
  ? v as Record<string, unknown> : {};
async function boundedJson(response: Response) {
  if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw Error('Invalid receipt');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) throw Error('Receipt limit');
      chunks.push(value);
    }
    const parsed = obj(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    if ('error' in parsed || 'errors' in parsed) throw Error('Invalid receipt');
    return obj(parsed.data);
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
function cancel(response: Response) { void response.body?.cancel().catch(() => undefined); }

export class CleanerSmsTransport {
  #apiKey: string;
  #receiptKey: string;
  #keyId: string;
  #from: string;
  #phoneNumberId: string;
  #fetch: CleanerSmsFetcher;
  #clock: () => number;
  #enabled: boolean;
  constructor(options: { apiKey: string; receiptKey: string; keyId: string; sendEnabled?: boolean;
    fetcher?: CleanerSmsFetcher; clock?: () => number }) {
    if (typeof window !== 'undefined') throw Error('Cleaner SMS requires a server');
    if (typeof options.apiKey !== 'string' || !options.apiKey || options.apiKey.length > 4096
      || /[\x00-\x20\x7f]/.test(options.apiKey) || typeof options.receiptKey !== 'string'
      || !/^[a-f0-9]{64}$/.test(options.receiptKey) || !/^[a-zA-Z0-9_-]{1,48}$/.test(options.keyId))
      throw Error('Invalid cleaner SMS configuration');
    this.#from = quoFromNumber('ops');
    // Renumbering needs a reviewed line ID as well as a number. Never guess an ID
    // or allow the ops environment override to redirect this pilot to guest SMS.
    if (this.#from !== QUO_LINES.ops.number) throw Error('Cleaner SMS line requires review');
    this.#phoneNumberId = QUO_LINES.ops.id;
    this.#apiKey = options.apiKey; this.#receiptKey = options.receiptKey; this.#keyId = options.keyId;
    this.#fetch = options.fetcher ?? fetch; this.#clock = options.clock ?? Date.now;
    this.#enabled = options.sendEnabled === true;
  }
  /** HMAC prevents offline guessing of a cleaner's phone from an audit digest.
   * The private key must survive receipt reconciliation; keyId identifies it. */
  fingerprint(domain: 'target' | 'recipient', value: string): string {
    return createHmac('sha256', Buffer.from(this.#receiptKey, 'hex'))
      .update(`helm:calderwood:cleaner-sms:v1:${this.#keyId}:${domain}\0${value}`).digest('hex');
  }
  attempt(to: string, text: string): CleanerSmsAttempt | null {
    if (!phone(to) || !validCleanerSmsText(text) || Object.values(QUO_LINES).some(l => l.number === to)) return null;
    return Object.freeze({ keyId: this.#keyId, targetHmac: this.fingerprint('target', JSON.stringify([
      this.#from, this.#phoneNumberId, to])), bodySha256: sha(text) });
  }
  #request(url: string, body?: string) {
    return this.#fetch(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(15000), headers: { Authorization: this.#apiKey, Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body }) });
  }
  #matches(row: Record<string, unknown>, expected: CleanerSmsAttempt, earliestCreation = -Infinity): boolean {
    const now = this.#clock();
    return cleanerSmsId(row.id) && row.direction === 'outgoing' && row.from === this.#from
      && row.phoneNumberId === this.#phoneNumberId && Array.isArray(row.to) && row.to.length === 1 && phone(row.to[0])
      && typeof row.text === 'string' && sha(row.text) === expected.bodySha256
      && this.fingerprint('target', JSON.stringify([row.from, row.phoneNumberId, row.to[0]])) === expected.targetHmac
      && statuses.includes(String(row.status)) && (row.media === undefined || Array.isArray(row.media) && row.media.length === 0)
      && typeof row.createdAt === 'string' && typeof row.updatedAt === 'string'
      && instant.safeParse(row.createdAt).success && instant.safeParse(row.updatedAt).success
      && Number.isFinite(now) && Date.parse(row.createdAt) >= earliestCreation
      && Date.parse(row.updatedAt) >= Date.parse(row.createdAt)
      // Allow one minute of provider clock skew; reject timestamps beyond it.
      && Date.parse(row.updatedAt) <= now + 60000;
  }
  async send(to: string, text: string, beforePost: (attempt: CleanerSmsAttempt) => Promise<boolean>): Promise<CleanerSmsResult> {
    if (!this.#enabled) return { state: 'not_sent' };
    const attempt = this.attempt(to, text), started = this.#clock();
    if (!attempt || !Number.isFinite(started) || typeof beforePost !== 'function') return { state: 'not_sent' };
    try {
      if (await beforePost(attempt) !== true) return { state: 'not_sent' };
      const elapsed = this.#clock() - started;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 5000) return { state: 'not_sent' };
    } catch { return { state: 'not_sent' }; }
    try {
      // No inbox-status change, recipient expansion, attachments, fallback host,
      // undocumented idempotency header or SDK retry.
      const response = await this.#request(BASE, JSON.stringify({ content: text, from: this.#from, to: [to] }));
      if (!response.redirected && [400, 401, 402, 403, 404].includes(response.status)) {
        cancel(response); return { state: 'rejected', status: response.status };
      }
      if (response.redirected || response.status !== 202) { cancel(response); return { state: 'unknown' }; }
      const row = await boundedJson(response);
      if (!this.#matches(row, attempt, started - 60000)) return { state: 'unknown' };
      return { state: 'accepted', receipt: { ...attempt, providerMessageId: row.id as string }, status: row.status as CleanerSmsStatus };
    } catch { return { state: 'unknown' }; }
  }
  /** Exact message GET only. Works after recipient revocation without resolving
   * or exposing the current portal link. No list/search fallback or resend. */
  async verify(receipt: CleanerSmsReceipt): Promise<CleanerSmsReadback> {
    if (!receipt || receipt.keyId !== this.#keyId || !cleanerSmsId(receipt.providerMessageId)
      || !hashPattern.test(receipt.targetHmac) || !hashPattern.test(receipt.bodySha256)) return { state: 'unconfirmed' };
    const saved = Object.freeze({ ...receipt });
    try {
      const response = await this.#request(`${BASE}/${encodeURIComponent(saved.providerMessageId)}`);
      if (response.status !== 200 || response.redirected) { cancel(response); return { state: 'unconfirmed' }; }
      const row = await boundedJson(response);
      if (row.id !== saved.providerMessageId || !this.#matches(row, saved)) return { state: 'unconfirmed' };
      return { state: 'verified', status: row.status as CleanerSmsStatus, updatedAt: row.updatedAt as string };
    } catch { return { state: 'unconfirmed' }; }
  }
}
