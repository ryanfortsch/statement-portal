import 'server-only';
import { z } from 'zod';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { retainedStayRequestSchema } from './retained-stay.ts';
export const cleanerStayRequestSchema=retainedStayRequestSchema.extend({releaseId:z.uuid()}).strict();
export const cleanerManifestSchema=z.object({format:z.literal(1),stays:z.array(cleanerStayRequestSchema).min(1).max(4)})
  .strict().refine(m=>new Set(m.stays.map(s=>s.bookingId)).size===m.stays.length
    && new Set(m.stays.map(s=>s.releaseId)).size===1);
export type CleanerStayRequest=z.infer<typeof cleanerStayRequestSchema>;
type Env=Record<string,string|undefined>;
export function cleanerTransportConfiguration(env:Env) {
  if(typeof window!=='undefined'||env.VERCEL_ENV!=='production'||env.NEXT_PUBLIC_SUPABASE_URL!==PRODUCTION_DB_URL
    || !env.SUPABASE_SERVICE_ROLE_KEY?.trim() || !env.QUO_API_KEY?.trim()
    || !/^[a-f0-9]{64}$/.test(env.HELM_CHANNEX_CLEANER_RECEIPT_KEY??'')
    || !/^[a-zA-Z0-9_-]{1,48}$/.test(env.HELM_CHANNEX_CLEANER_KEY_ID??'')
    || env.HELM_ISOLATED_CALENDAR_ENABLED==='true'||env.CHANNEX_WORKER_MODE==='isolated-staging') throw Error('Cleaner configuration unavailable');
  return {apiKey:env.QUO_API_KEY!,receiptKey:env.HELM_CHANNEX_CLEANER_RECEIPT_KEY!,keyId:env.HELM_CHANNEX_CLEANER_KEY_ID!};
}
export function cleanerRuntimeConfiguration(env:Env) {
  const mode=env.HELM_CHANNEX_CLEANER_MODE;
  if(!mode||mode==='off') return null;
  if(!['retained-pilot-v1','receipts-only'].includes(mode)||!env.CRON_SECRET?.trim()) throw Error('Cleaner configuration unavailable');
  const transport=cleanerTransportConfiguration(env);
  if(mode==='retained-pilot-v1'&&!env.CHANNEX_PRODUCTION_API_KEY?.trim()) throw Error('Cleaner configuration unavailable');
  const raw=env.HELM_CHANNEX_CLEANER_MANIFEST;
  if(!raw||Buffer.byteLength(raw)>4096) throw Error('Cleaner configuration unavailable');
  try { return {mode:mode as 'retained-pilot-v1'|'receipts-only',transport,manifest:cleanerManifestSchema.parse(JSON.parse(raw))}; }
  catch { throw Error('Cleaner configuration unavailable'); }
}
