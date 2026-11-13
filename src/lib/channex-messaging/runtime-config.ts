import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { retainedStayRequestSchema } from './retained-stay.ts';

export const retainedPilotManifestSchema = z.object({ format: z.literal(1),
  stays: z.array(retainedStayRequestSchema).min(1).max(4),
}).strict().refine(m => new Set(m.stays.map(s => s.bookingId)).size === m.stays.length);
export type RetainedPilotManifest = z.infer<typeof retainedPilotManifestSchema>;
type Env = Record<string, string | undefined>;

/** This is a separate, explicit activation gate. The existing production
 * inspection mode remains read-only. No request body/query supplies the manifest.
 * A valid manifest is NOT handover proof; SQL and the fresh provider checks still
 * require the independently reviewed source scope, bindings and template release.
 */
export function retainedPilotConfiguration(env: Env) {
  const mode = env.HELM_CHANNEX_MESSAGES_MODE;
  if (!mode || mode === 'off') return null;
  if (typeof window !== 'undefined' || mode !== 'retained-pilot-v1' || env.VERCEL_ENV !== 'production'
    || env.NEXT_PUBLIC_SUPABASE_URL !== PRODUCTION_DB_URL || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || !env.CHANNEX_PRODUCTION_API_KEY?.trim() || !env.CRON_SECRET?.trim()
    || env.HELM_ISOLATED_CALENDAR_ENABLED === 'true' || env.CHANNEX_WORKER_MODE === 'isolated-staging') throw Error('Runtime configuration unavailable');
  const raw = env.HELM_CHANNEX_MESSAGES_MANIFEST;
  if (!raw || Buffer.byteLength(raw) > 4096) throw Error('Runtime configuration unavailable');
  try { return retainedPilotManifestSchema.parse(JSON.parse(raw)); }
  catch { throw Error('Runtime configuration unavailable'); }
}

/** No signed-in owner, browser cookie, user agent or query-token fallback. */
export function hasMessageCronCredential(request: Request, secret: string | undefined) {
  if (!secret?.trim() || secret.length > 4096) return false;
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(request.headers.get('authorization') ?? '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
