import 'server-only';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { newStayScheduleRequest } from './new-stay-schedule-runtime.ts';
export function newStayScheduleConfiguration(env: Record<string, string | undefined>) {
  if (!env.HELM_CHANNEX_NEW_STAY_SCHEDULE_MODE || env.HELM_CHANNEX_NEW_STAY_SCHEDULE_MODE === 'off') return null;
  if (typeof window !== 'undefined' || env.HELM_CHANNEX_NEW_STAY_SCHEDULE_MODE !== 'calderwood-v1'
    || env.VERCEL_ENV !== 'production' || env.NEXT_PUBLIC_SUPABASE_URL !== PRODUCTION_DB_URL
    || !env.SUPABASE_SERVICE_ROLE_KEY?.trim() || !env.CRON_SECRET?.trim() || !env.CHANNEX_PRODUCTION_API_KEY?.trim()
    || !/^[a-f0-9]{64}$/.test(env.HELM_CHANNEX_CLEANER_RECEIPT_KEY ?? '')
    || !/^[a-zA-Z0-9_-]{1,48}$/.test(env.HELM_CHANNEX_CLEANER_KEY_ID ?? '')
    || env.HELM_ISOLATED_CALENDAR_ENABLED === 'true' || env.CHANNEX_WORKER_MODE === 'isolated-staging') throw Error('New-stay scheduling configuration unavailable');
  const raw = env.HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE;
  if (!raw || Buffer.byteLength(raw) > 1024) throw Error('New-stay scheduling configuration unavailable');
  const reference = newStayScheduleRequest.omit({ bookingId: true }).parse(JSON.parse(raw));
  return { reference, receiptKey: env.HELM_CHANNEX_CLEANER_RECEIPT_KEY!, keyId: env.HELM_CHANNEX_CLEANER_KEY_ID! };
}
