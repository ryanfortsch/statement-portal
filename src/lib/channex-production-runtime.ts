import 'server-only';
import { z } from 'zod';
import { CALDERWOOD_PRODUCTION as m, inspectCalderwoodProduction, ProductionPreflightError } from './channex-production-preflight.ts';

export const PRODUCTION_DB_URL = 'https://qjueexujiuticjrtqdyj.supabase.co';
type Env = Record<string, string | undefined>;
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const storageSchema = z.object({
  propertyId: z.literal(m.helmPropertyId), environment: z.literal('production'),
  remotePropertyId: z.literal(m.propertyId), roomTypeId: z.literal(m.roomTypeId),
  ratePlanId: z.literal(m.ratePlanId), generation: z.literal(1),
  importEnabled: z.literal(false), captureEnabled: z.literal(false),
  calendarAuthority: z.literal('guesty'), receipts: z.literal(0), inventoryEvents: z.literal(0),
}).strict();
const inventorySchema = z.object({ format: z.literal(1), planningEnabled: z.literal(false),
  publishingEnabled: z.literal(false), headVersion: z.literal(0), plans: z.literal(0),
  coverageSources: z.literal(0), maxDays: z.literal(500) }).strict();
const deliverySchema = z.object({ format: z.literal(1), enabled: z.literal(false), attempts: z.literal(0),
  unresolved: z.literal(0), settlementEnabled: z.literal(false) }).strict();
export type ChannexRuntimeCode = 'CONFIGURATION_REQUIRED' | 'STORAGE_NOT_READY'
  | 'CHECKPOINT_FAILED' | 'PROVIDER_CHECK_FAILED' | ProductionPreflightError['code'];
export class ChannexRuntimeError extends Error {
  readonly code: ChannexRuntimeCode;
  constructor(code: ChannexRuntimeCode) { super(code); this.code = code; }
}

/** This deployed mode verifies the production runtime; it CANNOT ingest or ACK.
 * Activating the generic receipt processor is a separate cutover change. */
export function requireProductionInspectionEnvironment(env: Env) {
  if (typeof window !== 'undefined' || env.VERCEL_ENV !== 'production'
    || env.CHANNEX_PRODUCTION_MODE !== 'inspect'
    || env.NEXT_PUBLIC_SUPABASE_URL !== PRODUCTION_DB_URL
    || !env.SUPABASE_SERVICE_ROLE_KEY?.trim() || !env.CHANNEX_PRODUCTION_API_KEY?.trim()
    || env.HELM_ISOLATED_CALENDAR_ENABLED === 'true' || env.CHANNEX_WORKER_MODE === 'isolated-staging') {
    throw new ChannexRuntimeError('CONFIGURATION_REQUIRED');
  }
}

/** Read-only guard shared with the owner-triggered booking comparison. */
export async function verifyDormantProductionStorage(rpc: Rpc) {
  for (const [name, schema] of [
    ['helm_channex_storage_status', storageSchema],
    ['helm_channex_inventory_status', inventorySchema],
    ['helm_channex_delivery_status', deliverySchema],
  ] as const) {
    const response = await rpc(name, {});
    if (response.error || !schema.safeParse(response.data).success) throw new ChannexRuntimeError('STORAGE_NOT_READY');
  }
}

export async function inspectProductionRuntime(env: Env, rpc: Rpc, fetcher: typeof fetch = fetch) {
  // Explicitly retire the dormant-state health check at a future cutover.
  // This is not a health claim about the independent booking intake worker.
  if (env.CHANNEX_PRODUCTION_MODE === 'off') return { ok: true, mode: 'inspect' as const,
    state: 'disabled' as const, readyForCutover: false as const };
  requireProductionInspectionEnvironment(env);
  const checkpoint = async (ok: boolean, code: string) => {
    try {
      const r = await rpc('helm_channex_runtime_checkpoint', { p_ok: ok, p_code: code });
      if (r.error || r.data !== true) throw Error();
    } catch { throw new ChannexRuntimeError('CHECKPOINT_FAILED'); }
  };
  try {
    await verifyDormantProductionStorage(rpc);
    const provider = await inspectCalderwoodProduction(env.CHANNEX_PRODUCTION_API_KEY!, fetcher);
    await checkpoint(true, 'OK');
    return { ok: true, mode: 'inspect', checkedAt: provider.checkedAt,
      property: m.helmPropertyId, mappingVerified: true, storageVerified: true, inventoryStorageVerified: true,
      deliveryStorageVerified: true, deliveryAttempts: 0,
      planningEnabled: false, availabilityPublishingEnabled: false,
      channels: 0, importEnabled: false, captureEnabled: false,
      providerWrites: 0, bookingsChanged: 0, messagesSent: 0, readyForCutover: false };
  } catch (error) {
    const code = error instanceof ChannexRuntimeError || error instanceof ProductionPreflightError
      ? error.code : 'PROVIDER_CHECK_FAILED';
    if (code !== 'CHECKPOINT_FAILED') await checkpoint(false, code);
    throw new ChannexRuntimeError(code);
  }
}
