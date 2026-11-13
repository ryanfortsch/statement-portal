import 'server-only';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PRODUCTION_DB_URL } from '@/lib/channex-production-runtime';
import { MESSAGE_SCHEDULE_LEDGER_FIELDS } from './schedule-plan';
import { AUTOMATION_HISTORY_LIMIT, readAutomationOperations } from './operations';

export async function loadAutomationOperations() {
  await requireOwnerEmail();
  const production = process.env.VERCEL_ENV === 'production'
    && process.env.NEXT_PUBLIC_SUPABASE_URL === PRODUCTION_DB_URL
    && !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return readAutomationOperations(process.env, {
    history: async () => {
      if (!production) throw Error('Production history unavailable');
      const { data, count, error } = await supabaseAdmin.from('automation_sends')
        .select(MESSAGE_SCHEDULE_LEDGER_FIELDS, { count: 'exact' }).eq('property_id', '65_calderwood')
        .order('fire_at', { ascending: false }).order('id').limit(AUTOMATION_HISTORY_LIMIT).abortSignal(AbortSignal.timeout(10_000));
      if (error || !data || count === null) throw Error('Message history unavailable');
      return { data, total: count };
    },
    rpc: async (name, args) => {
      // Defense in depth: this observation path cannot invoke a write RPC.
      if (!production || !['helm_channex_message_read', 'helm_channex_cleaner_read'].includes(name)) throw Error();
      const { data, error } = await supabaseAdmin.rpc(name, args).abortSignal(AbortSignal.timeout(10_000)); return { data, error };
    },
  });
}
