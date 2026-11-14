import 'server-only';
import { z } from 'zod';
import { CALDERWOOD_PRODUCTION as m } from '../channex-production-preflight.ts';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { createAirbnbRevisionReader } from './client.ts';
import { createAirbnbBookingStore } from './store.ts';
import { ingestAirbnbBookingRevisions } from './ingestion.ts';
import { normalizeAirbnbBookingRevision } from './revision.ts';
import { createNewStayStore } from '../channex-messaging/new-stay-store.ts';

type Env = Record<string, string | undefined>;
type Rpc = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<{ data: unknown; error: unknown }>;
export const BOOKING_TICK_LIMIT = 5;
export const BOOKING_TICK_TIMEOUT_MS = 90_000;
const mapping = Object.freeze({ environment: 'production' as const, propertyId: m.propertyId,
  roomTypeId: m.roomTypeId, ratePlanId: m.ratePlanId, generation: 1 });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const activeStorage = z.object({
  propertyId: z.literal(m.helmPropertyId), environment: z.literal('production'),
  remotePropertyId: z.literal(m.propertyId), roomTypeId: z.literal(m.roomTypeId),
  ratePlanId: z.literal(m.ratePlanId), generation: z.literal(1),
  importEnabled: z.literal(true), captureEnabled: z.literal(true), calendarAuthority: z.literal('helm'),
  receipts: count, inventoryEvents: count,
}).strict();
const credential = (v: string | undefined): v is string => typeof v === 'string'
  && v.length > 0 && v.length <= 4096 && !/[\x00-\x20\x7f]/.test(v);

/** Separate from read-only inspection and message delivery. No request parameter
 * can select a scope, database, generation, credential or activation mode. */
export function bookingIntakeConfiguration(env: Env) {
  const mode = env.HELM_CHANNEX_BOOKINGS_MODE;
  if (!mode || mode === 'off') return null;
  if (typeof window !== 'undefined' || mode !== 'calderwood-v1' || env.VERCEL_ENV !== 'production'
    || env.CHANNEX_PRODUCTION_MODE !== 'off' || env.NEXT_PUBLIC_SUPABASE_URL !== PRODUCTION_DB_URL
    || !credential(env.SUPABASE_SERVICE_ROLE_KEY) || !credential(env.CHANNEX_PRODUCTION_API_KEY)
    || !credential(env.CRON_SECRET) || env.HELM_ISOLATED_CALENDAR_ENABLED === 'true'
    || env.CHANNEX_WORKER_MODE === 'isolated-staging'
    || ![undefined, '', 'off', 'calderwood-v1'].includes(env.HELM_CHANNEX_NEW_STAYS_MODE)) throw Error('Booking intake configuration unavailable');
  return Object.freeze({ apiKey: env.CHANNEX_PRODUCTION_API_KEY,
    admitNewStays: env.HELM_CHANNEX_NEW_STAYS_MODE === 'calderwood-v1' });
}

/** One page-one pull, at most five revisions, bounded by a shared IO deadline.
 * SQL serializes competing commits and returns immutable receipts on replay.
 * Concurrent ACKs may still race: a rejected/lost ACK is incomplete, never an
 * invitation to re-create a booking or infer that no write happened.
 */
export async function runProductionBookingTick(env: Env, dependencies: {
  rpc: Rpc; fetcher?: typeof fetch; signal?: AbortSignal;
}) {
  const invariant = { completeCoverage: false as const, canSend: false as const };
  let config: ReturnType<typeof bookingIntakeConfiguration>;
  try { config = bookingIntakeConfiguration(env); }
  catch { return { ...invariant, state: 'configuration_required' as const, ok: false }; }
  // No database/provider access, even to inspect status, while the mode is off.
  if (!config) return { ...invariant, state: 'disabled' as const, ok: true };
  const deadline = AbortSignal.timeout(BOOKING_TICK_TIMEOUT_MS);
  const signal = dependencies.signal ? AbortSignal.any([deadline, dependencies.signal]) : deadline;
  const rpc: Rpc = async (name, args) => {
    signal.throwIfAborted();
    return dependencies.rpc(name, args, AbortSignal.any([signal, AbortSignal.timeout(8_000)]));
  };
  const verifyStorage = async () => {
    const r = await rpc('helm_channex_storage_status', {}, signal);
    if (r.error || !activeStorage.safeParse(r.data).success) throw Error();
  };
  let validated = 0, acknowledged = 0, writeAttempted = false;
  try {
    await verifyStorage();
    const fetcher: typeof fetch = async (input, init) => {
      signal.throwIfAborted();
      return (dependencies.fetcher ?? fetch)(input, { ...init,
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    };
    const provider = createAirbnbRevisionReader({ mapping, apiKey: config.apiKey, acknowledgeEnabled: true }, fetcher);
    const store = createAirbnbBookingStore((name, args) => rpc(name, args, signal));
    const result = await ingestAirbnbBookingRevisions({
      ...provider,
      feed: async () => {
        const all = await provider.feed();
        // Validate EVERY row before selecting the bounded prefix. A foreign or
        // malformed row beyond the processing limit must still stop all writes.
        const ordered = all.map(raw => ({ raw, revision: normalizeAirbnbBookingRevision(raw, mapping) }))
          .sort((a, b) => a.revision.providerReceivedAt.localeCompare(b.revision.providerReceivedAt)
            || a.revision.revisionId.localeCompare(b.revision.revisionId));
        validated = ordered.length;
        return ordered.slice(0, BOOKING_TICK_LIMIT).map(r => r.raw);
      },
      acknowledge: async revision => {
        await verifyStorage();
        await provider.acknowledge(revision);
        acknowledged++;
      },
    }, {
      receipt: store.receipt,
      commit: async revision => {
        await verifyStorage();
        // A timeout can occur after SQL committed. Never claim zero effects.
        writeAttempted = true;
        return store.commit(revision);
      },
    }, mapping);
    // Separate optional admission, after durable intake. Even an empty feed runs
    // this step, recovering a prior committed admission with a lost response.
    // SQL reads the independently reviewed epoch; no request creates origin proof.
    const admissions = await createNewStayStore((name, args) => rpc(name, args, signal),
      { enabled: config.admitNewStays }).admit();
    return { ...invariant, state: validated > result.acknowledged ? 'more_pending' as const : 'page_processed' as const,
      ok: admissions.state !== 'uncertain', admissions,
      validatedRevisions: validated, acknowledgedRevisions: acknowledged,
      appliedReceipts: result.applied, staleReceipts: result.stale,
      deferredRevisions: validated - result.acknowledged };
  } catch {
    // Counters are a lower bound on confirmed progress, NOT total side effects.
    // No provider response, booking ID, contact detail, or exception is returned.
    return { ...invariant, state: 'incomplete' as const, ok: false,
      validatedRevisions: validated, acknowledgedRevisions: acknowledged,
      partialEffectsPossible: writeAttempted };
  }
}
