import { supabaseAdmin } from '../supabase-admin';
import { cleanerConfig, runScheduledCleanerMessages } from './scheduled';
export async function dispatchScheduledCleaners(options: { propertyId: string | null; dry: boolean }) {
  return runScheduledCleanerMessages({ ...options, config: cleanerConfig(process.env),
    rpc: async (name, args) => { const { data, error } = await supabaseAdmin.rpc(name, args); return { data, error }; } });
}
