import { discoverAirbnbThreads, type createAirbnbThreadReader } from './thread.ts';
import { z } from 'zod';
import { ingestAirbnbBookingRevisions, type AirbnbBookingStore, type AirbnbRevisionReader } from './ingestion.ts';
import {airbnbMappingSchema, type AirbnbBookingMapping } from './revision.ts';
const summary = z.object({ scanned: z.number().int().min(0).max(100), prepared: z.number().int().min(0),
  refreshed: z.number().int().min(0), blocked: z.number().int().min(0), canSend: z.literal(false) }).strict();
/** Explicit server adapters only. No timer, environment credentials or send action.
 * Sweep BEFORE ingestion recovers committed rows even when provider access fails.
 * Sweep AFTER ingestion picks up newly committed stays without waiting a tick.
 * The durable sweep, not the transient provider feed, owns queue recovery.
 */
export async function processAirbnbBookingCycle(client: AirbnbRevisionReader, store: AirbnbBookingStore,
  mapping: AirbnbBookingMapping,
  rpc: (name: string, args: Record<string, unknown>) => Promise<{data: unknown; error: unknown}>, limit = 25, threadReader?: ReturnType<typeof createAirbnbThreadReader>) {
  if (typeof window !== 'undefined' || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw Error('Invalid server processing cycle');
  const scope=Object.freeze(airbnbMappingSchema.parse(mapping));
  const sweep = async () => {
    try {
      const response = await rpc('helm_airbnb_messages_tick', {p_limit: limit});
      if (response.error) throw Error();
      const result = summary.parse(response.data);
      if (result.scanned > limit || result.prepared + result.refreshed + result.blocked > result.scanned) throw Error();
      return result;
    } catch { throw Error('Airbnb message recovery incomplete'); }
  };
  const recoveredThreads = threadReader ? await discoverAirbnbThreads(scope,threadReader,rpc,limit) : null;
  const recovered = await sweep();
  const ingestion = await ingestAirbnbBookingRevisions(client, store, scope);
  const newThreads = threadReader ? await discoverAirbnbThreads(scope,threadReader,rpc,limit) : null;
  const queued = await sweep();
  return {recoveredThreads, recovered, ingestion, newThreads, queued, canSend: false as const};
}
