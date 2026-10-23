/** Calderwood ingestion bound to the same owner-reviewed route as inventory. */
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { CALDERWOOD_STAGING } from '../calderwood-readonly/channex.ts';
import { stagingInventoryRouteSchema, type StagingInventoryRoute } from './inventory-route.ts';
import { assertNoCanonicalConflict } from './canonical-conflicts.ts';
import { createCanonicalRevisionClient } from './canonical-revision-client.ts';
import { CANONICAL_PILOT_PROPERTY, ingestCanonicalRevisions, parseCanonicalRevision, type CanonicalRevisionStore } from './canonical-revisions.ts';

const count = z.number().int().min(0).max(100);
export const messageDateRefreshSchema = z.object({ scanned: count, refreshed: count, unchanged: count,
  blocked: count, inactive: count, canSend: z.literal(false) }).strict().refine(r =>
  r.scanned === r.refreshed + r.unchanged + r.blocked + r.inactive);
export const messageQueuePreparationSchema = z.object({ scanned: count, prepared: count,
  blocked: count, inactive: count, canSend: z.literal(false) }).strict().refine(r =>
  r.scanned === r.prepared + r.blocked + r.inactive);
export function parseCanonicalPilotRoute(raw: unknown): Readonly<StagingInventoryRoute> {
  const route = stagingInventoryRouteSchema.parse(raw);
  if (route.helmProperty !== CANONICAL_PILOT_PROPERTY ||
      route.propertyId !== CALDERWOOD_STAGING.propertyId || route.roomTypeId !== CALDERWOOD_STAGING.roomTypeId ||
      route.ratePlanId !== CALDERWOOD_STAGING.ratePlanId) throw Error('Reviewed Calderwood revision route required');
  return Object.freeze(route);
}
export function createMappedCanonicalRevisionAccess(url: string, key: string, fetcher: typeof fetch = fetch) {
  if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key.trim()) {
    throw Error('Explicit isolated staging storage required');
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    if (error || !data) throw Error('Mapped canonical revision route/save/read incomplete; no ACK allowed');
    return data;
  }
  return {
    route: async () => parseCanonicalPilotRoute(await rpc('helm_pilot_revision_route', {})),
    async refreshMessageDates(raw: StagingInventoryRoute) {
      const route = parseCanonicalPilotRoute(raw);
      try {
        return messageDateRefreshSchema.parse(await rpc('helm_pilot_message_times_refresh', {
          p_connection: route.connection, p_generation: route.generation, p_limit: 100,
        }));
      } catch { throw Error('Message date refresh unconfirmed; canonical receipts retained'); }
    },
    async prepareMessageQueue(raw: StagingInventoryRoute) {
      const route = parseCanonicalPilotRoute(raw);
      try {
        return messageQueuePreparationSchema.parse(await rpc('helm_pilot_message_queue_prepare', {
          p_connection: route.connection, p_generation: route.generation, p_limit: 100,
        }));
      } catch { throw Error('Message queue preparation unconfirmed; canonical receipts retained'); }
    },
    store(raw: StagingInventoryRoute): CanonicalRevisionStore {
      const route = parseCanonicalPilotRoute(raw);
      const binding = { p_connection: route.connection, p_generation: route.generation };
      return {
        async commit(rawRevision) {
          const revision = parseCanonicalRevision(rawRevision);
          const result = await rpc('helm_pilot_revision_observe_mapped', { ...binding, p_revision: revision });
          assertNoCanonicalConflict(result, revision);
          return result;
        },
        receipt(id) {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Error('Invalid revision ID');
          return rpc('helm_pilot_revision_receipt_mapped', { ...binding, p_id: id });
        },
      };
    },
  };
}
/** Both entry points resolve the route before any provider request. No legacy fallback. */
export async function runMappedCanonicalRevisions(input: {
  url: string; storageKey: string; providerKey: string; refreshMessageDates?: boolean; prepareMessageQueue?: boolean; revisionId?: string; bookingId?: string;
}, fetcher: typeof fetch = fetch) {
  if (input.prepareMessageQueue && !input.refreshMessageDates) throw Error('Message queue preparation requires automatic timing');
  const access = createMappedCanonicalRevisionAccess(input.url, input.storageKey, fetcher);
  const client = createCanonicalRevisionClient(input.providerKey, fetcher);
  const route = await access.route();
  const result = await ingestCanonicalRevisions(client, access.store(route), input.revisionId, input.bookingId);
  // ACKed revisions remain durable. Empty polling cycles recover a lost refresh
  // response or a restart between the ACK and this independently idempotent step.
  if (input.refreshMessageDates === true) {
    const timing = await access.refreshMessageDates(route);
    // Separate transaction: newly committed observations must be visible to
    // schedule resolution. Empty cycles recover an interrupted preparation.
    if (input.prepareMessageQueue === true) return { ...result, timing, queue: await access.prepareMessageQueue(route) };
    return { ...result, timing };
  }
  return result;
}
