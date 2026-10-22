/** Quo SMS, exactly one recipient and one POST. No retry or provider-side dedupe assumption.
 * https://www.quo.com/docs/mdx/api-reference/messages/send-a-text-message
 * https://www.quo.com/docs/mdx/api-reference/messages/get-a-message-by-id
 */
import { createHash } from 'node:crypto';
import { quoFromNumber } from '../quo-lines.ts';
import { overrideBodyProblem } from '../automations-core.ts';
export type CleanerTarget = Readonly<{ from: string; to: string; bodySha256: string }>;
export type CleanerOutcome = { state: 'unknown' | 'rejected' } | { state: 'accepted' | 'delivered' | 'undelivered'; providerMessageId: string };
export type CleanerTransport = {
  send(target: CleanerTarget, text: string, claim: () => Promise<boolean>): Promise<CleanerOutcome | { state: 'blocked' }>;
  receipt(target: CleanerTarget, providerMessageId: string): Promise<'delivered' | 'undelivered' | 'unconfirmed'>;
};
const phone = (v: string) => /^\+[1-9]\d{1,14}$/.test(v);
export const messageHash = (v: string) => createHash('sha256').update(v).digest('hex');
const messageId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
async function readMessage(response: Response) {
  if (!response.body) throw Error('Missing Quo response');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 65_536) throw Error('Quo response limit'); chunks.push(part.value);
    }
    const json = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    if (json.error !== undefined || json.errors !== undefined) throw Error('Quo error envelope');
    return object(json.data);
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
function matches(row: Record<string, unknown>, target: CleanerTarget) {
  return messageId(row.id) && row.direction === 'outgoing' && row.from === target.from
    && Array.isArray(row.to) && row.to.length === 1 && row.to[0] === target.to
    && typeof row.text === 'string' && messageHash(row.text) === target.bodySha256
    && (row.media === undefined || (Array.isArray(row.media) && row.media.length === 0));
}
export function createCleanerTransport(options: { apiKey: string; enabled?: boolean; fetcher?: typeof fetch }): CleanerTransport {
  if (typeof window !== 'undefined' || !options.apiKey.trim() || /[\r\n]/.test(options.apiKey)) throw Error('Invalid cleaner transport configuration');
  const fetcher = options.fetcher ?? fetch;
  const request = (path: string, body?: string) => fetcher(`https://api.quo.com/v1/messages${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: options.apiKey.trim(), 'Content-Type': 'application/json' },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000), ...(body === undefined ? {} : { body }),
  });
  return {
    async send(input, text, claim) {
      const target = Object.freeze({ ...input });
      if (!options.enabled || target.from !== quoFromNumber('ops') || !phone(target.from) || !phone(target.to)
        || target.to === target.from || !text.trim() || text.length > 1600 || overrideBodyProblem(text)
        || /{{|}}/.test(text) || messageHash(text) !== target.bodySha256) return { state: 'blocked' };
      try { if (await claim() !== true) return { state: 'blocked' }; } catch { return { state: 'blocked' }; }
      try {
        const response = await request('', JSON.stringify({ from: target.from, to: [target.to], content: text }));
        if ([400,401,402,403,404].includes(response.status)) { await response.body?.cancel(); return { state: 'rejected' }; }
        // Even throttling is held for review; no automatic send retries.
        if (response.status !== 202) { await response.body?.cancel(); return { state: 'unknown' }; }
        const row = await readMessage(response);
        if (!matches(row, target)) return { state: 'unknown' };
        return { state: 'accepted', providerMessageId: row.id as string };
      } catch { return { state: 'unknown' }; }
    },
    async receipt(input, providerMessageId) {
      const target = Object.freeze({ ...input });
      // Readback binds to the historical sender, even if the configured ops line changes.
      if (!phone(target.from) || !phone(target.to) || !messageId(providerMessageId)) return 'unconfirmed';
      try {
        const response = await request(`/${encodeURIComponent(providerMessageId)}`);
        if (response.status !== 200) { await response.body?.cancel(); return 'unconfirmed'; }
        const row = await readMessage(response);
        if (row.id !== providerMessageId || !matches(row, target)) return 'unconfirmed';
        if (row.status === 'delivered') return 'delivered';
        if (row.status === 'undelivered') return 'undelivered';
        return 'unconfirmed';
      } catch { return 'unconfirmed'; }
    },
  };
}
