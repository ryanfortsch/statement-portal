import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CALDERWOOD_STAGING } from '../calderwood-readonly/channex.ts';

type Environment = { VERCEL_ENV?: string; VERCEL_GIT_COMMIT_REF?: string;
  CHANNEX_STAGING_ENABLED?: string; CHANNEX_CANONICAL_REHEARSAL_ENABLED?: string };
export function canonicalRehearsalEnabled(env: Environment) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'codex/channex-staging-pilot' &&
    env.CHANNEX_STAGING_ENABLED === 'true' && env.CHANNEX_CANONICAL_REHEARSAL_ENABLED === 'true';
}
const noticeSchema = z.object({
  event: z.literal('booking'), property_id: z.literal(CALDERWOOD_STAGING.propertyId),
  payload: z.object({ booking_id: z.string().uuid(), revision_id: z.string().uuid(),
    property_id: z.literal(CALDERWOOD_STAGING.propertyId) }),
});
const headers = { 'Cache-Control': 'no-store' };
const result = (status: number, message: string) => Response.json({ message }, { status, headers });
/** Channex's documented timestamp.raw-byte HMAC protocol. No unsigned fallback. */
export function verifyCanonicalSignature(raw: Uint8Array, requestHeaders: Headers, secret: string, now: number) {
  const ts = requestHeaders.get('x-hmac-timestamp') ?? '', signatures = requestHeaders.get('x-hmac-signature-256') ?? '';
  if (!secret || !/^\d{10}$/.test(ts) || !Number.isFinite(now) || Math.abs(now / 1000 - Number(ts)) > 300 ||
      !/^[a-f0-9]{64}(,\s*[a-f0-9]{64})?$/.test(signatures)) return false;
  const expected = createHmac('sha256', secret).update(ts + '.').update(raw).digest();
  return signatures.split(',').some(sig => timingSafeEqual(Buffer.from(sig.trim(), 'hex'), expected));
}
export async function handleCanonicalRevisionWebhook(request: Request, options: {
  enabled: boolean; secret: string; now: () => number;
  run: (revisionId: string, bookingId: string) => Promise<unknown>;
}) {
  if (!options.enabled || !options.secret) return result(404, 'Unavailable');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return result(415, 'JSON required');
  if (!request.body) return result(400, 'Body required');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 16384) { await reader.cancel(); return result(413, 'Notice too large'); }
      chunks.push(part.value);
    }
  } catch { return result(400, 'Body incomplete'); } finally { reader.releaseLock(); }
  const raw = Buffer.concat(chunks);
  if (!verifyCanonicalSignature(raw, request.headers, options.secret, options.now())) return result(401, 'Invalid signature');
  let notice: z.infer<typeof noticeSchema>;
  try { notice = noticeSchema.parse(JSON.parse(raw.toString('utf8'))); } catch { return result(400, 'Invalid booking notice'); }
  try {
    // Notice is only a wake-up hint. Pull authoritative revision; do not trust embedded stay/customer data.
    await options.run(notice.payload.revision_id, notice.payload.booking_id);
    return result(200, 'Revision durably processed');
  } catch {
    // Retries return through the same durable identity path. Never log provider payloads.
    return result(503, 'Processing incomplete; retry required');
  }
}
