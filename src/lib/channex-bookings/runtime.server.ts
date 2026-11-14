import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { runProductionBookingTick } from './runtime';

/** Called only after the route's exact cron credential check. */
export function executeProductionBookingTick() {
  return runProductionBookingTick(process.env, {
    rpc: async (name, args, signal) => {
      const { data, error } = await supabaseAdmin.rpc(name, args).abortSignal(signal);
      return { data, error };
    },
  });
}
