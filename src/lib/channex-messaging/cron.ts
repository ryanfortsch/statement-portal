import { supabaseAdmin } from '../supabase-admin';
import { messageCronConfig, runScheduledChannexMessages } from './scheduled';

/** The existing authenticated automation cron is the only caller. */
export async function dispatchScheduledChannex(options: { propertyId: string | null; dry: boolean }) {
  return runScheduledChannexMessages({ ...options, config: messageCronConfig(process.env),
    rpc: async (name, args) => { const { data, error } = await supabaseAdmin.rpc(name, args); return { data, error }; } });
}
