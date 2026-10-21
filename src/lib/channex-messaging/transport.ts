/**
 * Server/CLI transport. Scheduling and credentials belong to the scheduled adapter.
 * The caller must durably claim a send and recheck booking/hold/sender ownership in
 * beforePost. This module is not a queue or a cross-process idempotency mechanism.
 * Contract: https://docs.channex.io/api-v.1-documentation/messages-collection
 */
import { createHash } from 'node:crypto';

export type MessageScope = Readonly<{
  environment: 'staging' | 'production';
  propertyId: string;
  channelId: string;
  provider: 'Airbnb' | 'BookingCom';
}>;
export type MessageTarget = Readonly<{ bookingId: string; threadId: string }>;
export type MessageAttempt = MessageScope & MessageTarget & { bodySha256: string };
export type MessageReceipt = MessageAttempt & { providerMessageId: string };
export type MessageSendResult =
  | { state: 'not_sent'; reason: 'disabled' | 'invalid_input' | 'thread_unavailable' | 'target_mismatch' | 'thread_closed' | 'dispatch_not_authorized' }
  | { state: 'rejected'; status: number }
  | { state: 'unknown'; reason: 'transport_error' | 'unexpected_response' }
  | { state: 'accepted'; receipt: MessageReceipt };
export type MessageReadback = { state: 'recorded' } | { state: 'unconfirmed' };
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
type Json = Record<string, unknown>;
const BASES = { staging: 'https://staging.channex.io/api/v1', production: 'https://app.channex.io/api/v1' } as const;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_TEXT_BYTES = 10_240; // Our bounded pilot limit, not a claimed provider limit.
const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const object = (v: unknown): Json => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Json : {};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const relation = (row: Json, key: string) => object(object(object(row.relationships)[key]).data).id;
const validTarget = (v: MessageTarget) => isId(v?.bookingId) && isId(v?.threadId);

async function json(response: Response): Promise<Json> {
  if (!response.body) throw Error('Missing provider body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw Error('Provider response limit');
      chunks.push(part.value);
    }
    const result = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    const warnings = object(result.meta).warnings;
    if (result.errors !== undefined || (warnings !== undefined && (!Array.isArray(warnings) || warnings.length))) throw Error('Provider error envelope');
    return result;
  } finally {
    // Do not preserve response bodies or raw provider errors in logs/results.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class ChannexMessageTransport {
  #scope: MessageScope;
  #key: string;
  #fetch: Fetcher;
  #sendEnabled: boolean;
  constructor(options: { scope: MessageScope; apiKey: string; sendEnabled?: boolean; fetcher?: Fetcher }) {
    if (typeof window !== 'undefined') throw Error('Channex messages require a server');
    const s = options.scope;
    if (!s || !['staging', 'production'].includes(s.environment) || !isId(s.propertyId) || !isId(s.channelId)
        || !['Airbnb', 'BookingCom'].includes(s.provider) || typeof options.apiKey !== 'string'
        || !options.apiKey.trim() || /[\r\n]/.test(options.apiKey)) throw Error('Invalid message transport configuration');
    this.#scope = Object.freeze({ environment: s.environment, propertyId: s.propertyId, channelId: s.channelId, provider: s.provider });
    this.#key = options.apiKey.trim();
    this.#fetch = options.fetcher ?? fetch;
    this.#sendEnabled = options.sendEnabled === true;
  }
  #request(path: string, text?: string) {
    return this.#fetch(`${BASES[this.#scope.environment]}${path}`, {
      method: text === undefined ? 'GET' : 'POST', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-api-key': this.#key, Accept: 'application/json', ...(text === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(text === undefined ? {} : { body: JSON.stringify({ message: { message: text } }) }),
    });
  }
  async #inspect(target: MessageTarget, requireOpen: boolean): Promise<MessageSendResult | null> {
    try {
      const response = await this.#request(`/message_threads/${target.threadId}`);
      if (response.status !== 200) { await response.body?.cancel(); return { state: 'not_sent', reason: 'thread_unavailable' }; }
      const row = object((await json(response)).data), attrs = object(row.attributes);
      if (row.id !== target.threadId || row.type !== 'message_thread'
          || relation(row, 'property') !== this.#scope.propertyId || relation(row, 'channel') !== this.#scope.channelId
          || relation(row, 'booking') !== target.bookingId || attrs.provider !== this.#scope.provider
          || typeof attrs.is_closed !== 'boolean') return { state: 'not_sent', reason: 'target_mismatch' };
      if (requireOpen && attrs.is_closed) return { state: 'not_sent', reason: 'thread_closed' };
      return null;
    } catch { return { state: 'not_sent', reason: 'thread_unavailable' }; }
  }
  #matches(row: Json, target: MessageTarget, bodySha256: string) {
    const attrs = object(row.attributes);
    return row.type === 'message' && isId(row.id) && relation(row, 'message_thread') === target.threadId
      && attrs.sender === 'property' && typeof attrs.message === 'string' && hash(attrs.message) === bodySha256
      && Array.isArray(attrs.attachments) && attrs.attachments.length === 0;
  }
  /**
   * One POST, never automatically retried. Unknown outcomes must remain unresolved
   * in the durable ledger; do not call again to repair a lost response. A successful
   * response means Channex accepted the message, not that the guest received it.
   * beforePost must atomically claim/revalidate the exact target and body digest.
   */
  async sendText(input: MessageTarget & { text: string }, beforePost: (attempt: MessageAttempt) => Promise<boolean>): Promise<MessageSendResult> {
    if (!this.#sendEnabled) return { state: 'not_sent', reason: 'disabled' };
    if (!validTarget(input) || typeof input.text !== 'string' || !input.text.trim()
        || Buffer.byteLength(input.text) > MAX_TEXT_BYTES || /\{\{|\}\}/.test(input.text)
        || typeof beforePost !== 'function') return { state: 'not_sent', reason: 'invalid_input' };
    // Snapshot caller-owned objects before asynchronous reads.
    const target = Object.freeze({ bookingId: input.bookingId, threadId: input.threadId });
    const text = input.text, bodySha256 = hash(text);
    const blocked = await this.#inspect(target, true);
    if (blocked) return blocked;
    try {
      if (await beforePost(Object.freeze({ ...this.#scope, ...target, bodySha256 })) !== true) return { state: 'not_sent', reason: 'dispatch_not_authorized' };
    } catch { return { state: 'not_sent', reason: 'dispatch_not_authorized' }; }
    try {
      const response = await this.#request(`/message_threads/${target.threadId}/messages`, text);
      // Only documented terminal refusals establish rejection. 429, 5xx, redirects,
      // unexpected 2xx and lost/malformed replies all remain uncertain.
      if ([401, 403, 404, 422].includes(response.status)) {
        await response.body?.cancel();
        return { state: 'rejected', status: response.status };
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        return { state: 'unknown', reason: 'unexpected_response' };
      }
      const row = object((await json(response)).data);
      if (!this.#matches(row, target, bodySha256)) return { state: 'unknown', reason: 'unexpected_response' };
      return { state: 'accepted', receipt: { ...this.#scope, ...target, providerMessageId: row.id as string, bodySha256 } };
    } catch { return { state: 'unknown', reason: 'transport_error' }; }
  }
  /** GET only. Missing/unreadable history never authorizes resending. */
  async verifyReceipt(receipt: MessageReceipt): Promise<MessageReadback> {
    const unconfirmed: MessageReadback = { state: 'unconfirmed' };
    if (!receipt || !validTarget(receipt) || !isId(receipt.providerMessageId)
        || !/^[a-f0-9]{64}$/.test(receipt.bodySha256)
        || (Object.keys(this.#scope) as Array<keyof MessageScope>).some(k => receipt[k] !== this.#scope[k])) return unconfirmed;
    const saved = { ...receipt };
    if (await this.#inspect(saved, false)) return unconfirmed;
    const ids = new Set<string>();
    let expectedTotal: number | undefined;
    try {
      for (let page = 1; page <= 5; page++) {
        const params = new URLSearchParams({ 'pagination[page]': String(page), 'pagination[limit]': '100' });
        const response = await this.#request(`/message_threads/${saved.threadId}/messages?${params}`);
        if (response.status !== 200) { await response.body?.cancel(); return unconfirmed; }
        const result = await json(response), meta = object(result.meta);
        if (!Array.isArray(result.data) || meta.page !== page || !Number.isSafeInteger(meta.total)
            || Number(meta.total) < 0 || !Number.isSafeInteger(meta.limit) || Number(meta.limit) < 1
            || result.data.length > Number(meta.limit) || (expectedTotal !== undefined && meta.total !== expectedTotal)) return unconfirmed;
        expectedTotal = Number(meta.total);
        let found = false;
        for (const entry of result.data) {
          const row = object(entry);
          if (!isId(row.id) || ids.has(row.id) || relation(row, 'message_thread') !== saved.threadId) return unconfirmed;
          ids.add(row.id);
          if (row.id === saved.providerMessageId) {
            if (!this.#matches(row, saved, saved.bodySha256)) return unconfirmed;
            found = true;
          }
        }
        if (ids.size > expectedTotal) return unconfirmed;
        if (found) return { state: 'recorded' };
        if (ids.size === expectedTotal || !result.data.length) return unconfirmed;
      }
    } catch { /* Includes timeout, bad JSON, oversized data; no raw errors escape. */ }
    return unconfirmed;
  }
}
