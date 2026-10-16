/** Signed, fixed-fixture ingress. A 2xx means the receipt is durably saved, not delivered. */
import { cleanerReceiptsEnabled, cleanerReceiptTestKey, createCleanerReceiptRuntime } from './cleaner-receipt-runtime.ts';
import { verifyCleanerDeliveryReceipt } from './cleaner-delivery-receipts.ts';
import type { VerifiedCleanerReceipt } from './cleaner-delivery-receipts.ts';
const headers = { 'Cache-Control': 'private, no-store' };
const MAX_BYTES = 65536;
class BodyFailure extends Error { status: number; constructor(status: number) { super('Receipt body rejected'); this.status = status; } }
async function readBody(request: Request, timeoutMs: number) {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new BodyFailure(400);
  if (length !== null && Number(length) > MAX_BYTES) throw new BodyFailure(413);
  if (!request.body || request.signal.aborted) throw new BodyFailure(400);
  const reader = request.body.getReader();
  let timedOut = false, bytes = 0;
  const chunks: Uint8Array[] = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const part = await reader.read();
      if (timedOut) throw new BodyFailure(408);
      if (request.signal.aborted) throw new BodyFailure(400);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) { cancel(); throw new BodyFailure(413); }
      chunks.push(part.value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
type Options = {
  env: Record<string, string | undefined>; now?: () => number; bodyTimeoutMs?: number;
  save?: (receipt: VerifiedCleanerReceipt, signal: AbortSignal) => Promise<'stored' | 'duplicate'>;
};
export async function handleCleanerReceipt(request: Request, options: Options) {
  if (!cleanerReceiptsEnabled(options.env, 'preview')) return Response.json({ error: 'Unavailable' }, { status: 404, headers });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'POST' } });
  let key: string;
  try { key = cleanerReceiptTestKey(options.env); }
  catch { return Response.json({ error: 'Receipt intake unavailable' }, { status: 503, headers }); }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return Response.json({ error: 'JSON required' }, { status: 415, headers });
  }
  let rawBody: string;
  try { rawBody = await readBody(request, options.bodyTimeoutMs ?? 5000); }
  catch (error) { return Response.json({ error: 'Receipt body rejected' }, { status: error instanceof BodyFailure ? error.status : 400, headers }); }
  let receipt: VerifiedCleanerReceipt;
  try { receipt = verifyCleanerDeliveryReceipt({ rawBody, signature: request.headers.get('x-helm-rehearsal-signature'),
    testSigningKey: key, now: (options.now ?? Date.now)() }); }
  catch { return Response.json({ error: 'Receipt authentication rejected' }, { status: 401, headers }); }
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
    const status = await (options.save ?? ((value, abort) => createCleanerReceiptRuntime(options.env, 'preview', abort).inbox.enqueue(value)))(receipt, signal);
    if (!['stored', 'duplicate'].includes(status)) throw Error('Uncertain save');
    return Response.json({ status, canSend: false }, { headers });
  } catch { return Response.json({ error: 'Receipt save unconfirmed' }, { status: 503, headers: { ...headers, 'Retry-After': '60' } }); }
}
