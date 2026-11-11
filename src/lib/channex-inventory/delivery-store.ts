import 'server-only';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { deliveryAttemptSchema, deliveryOutcomeSchema, type InventoryDeliveryStore } from './delivery.ts';
const claim = z.union([
  z.object({ status: z.enum(['claimed', 'existing']), attempt: deliveryAttemptSchema }).strict(),
  z.object({ status: z.enum(['disabled', 'blocked', 'stale']) }).strict(),
]);
const begin = z.union([z.object({ status: z.literal('started'), expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ status: z.literal('blocked') }).strict()]);
/** No environment fallback or activation method. Database defaults remain off. */
export function createInventoryDeliveryStore(url: string, key: string, fetcher: typeof fetch = fetch): InventoryDeliveryStore {
  if (typeof window !== 'undefined' || url !== PRODUCTION_DB_URL || !key.trim()) throw Error('Explicit production storage required');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  async function rpc(name: string, args: Record<string, unknown>) {
    try { const r = await db.rpc(name, args); if (r.error || r.data === null) throw Error(); return r.data; }
    catch { throw Error('Availability delivery checkpoint uncertain; do not resend'); }
  }
  return {
    async claim(token) { return claim.parse(await rpc('helm_channex_delivery_claim', { p_token: z.string().uuid().parse(token) })); },
    async begin(token, requestDigest) { return begin.parse(await rpc('helm_channex_delivery_begin', { p_token: token, p_digest: requestDigest })); },
    async record(token, requestDigest, outcome) {
      const r = await rpc('helm_channex_delivery_record', { p_token: token, p_digest: requestDigest, p_outcome: deliveryOutcomeSchema.parse(outcome) });
      if (r !== true) throw Error('Availability delivery outcome unconfirmed; do not resend');
    },
  };
}
