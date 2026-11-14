import 'server-only';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { cleanerTransportConfiguration } from './cleaner-runtime-config.ts';
import { newStayScheduleRequest } from './new-stay-schedule-runtime.ts';

export type NewStayAudience = 'guest' | 'cleaner';
export function newStayDeliveryConfiguration(audience: NewStayAudience, env: Record<string, string | undefined>) {
  const mode = env[audience === 'guest' ? 'HELM_CHANNEX_NEW_GUEST_MODE' : 'HELM_CHANNEX_NEW_CLEANER_MODE'];
  if (!mode || mode === 'off') return null;
  if (typeof window !== 'undefined' || !['calderwood-v1', 'receipts-only'].includes(mode)
    || env.VERCEL_ENV !== 'production' || env.NEXT_PUBLIC_SUPABASE_URL !== PRODUCTION_DB_URL
    || !env.SUPABASE_SERVICE_ROLE_KEY?.trim() || !env.CRON_SECRET?.trim()
    || env.HELM_ISOLATED_CALENDAR_ENABLED === 'true' || env.CHANNEX_WORKER_MODE === 'isolated-staging'
    || ((audience === 'guest' || mode === 'calderwood-v1') && !env.CHANNEX_PRODUCTION_API_KEY?.trim()))
    throw Error('New-stay delivery configuration unavailable');
  const transport = audience === 'cleaner' ? cleanerTransportConfiguration(env) : null;
  if (mode === 'receipts-only') return { mode, reference: null, transport } as const;
  try {
    const raw = env.HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE;
    if (!raw || Buffer.byteLength(raw) > 1024) throw Error();
    const reference = newStayScheduleRequest.omit({ bookingId: true }).parse(JSON.parse(raw));
    return { mode: 'calderwood-v1', reference, transport } as const;
  } catch { throw Error('New-stay delivery configuration unavailable'); }
}
