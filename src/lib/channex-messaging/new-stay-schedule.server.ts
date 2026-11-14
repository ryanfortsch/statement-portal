import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { runNewStayScheduleTick } from './new-stay-schedule-tick';
export async function executeNewStayScheduleTick() {
  return runNewStayScheduleTick(process.env, { rpc: async (name, args) => {
    const { data, error } = await supabaseAdmin.rpc(name, args).abortSignal(AbortSignal.timeout(8000));
    return { data, error };
  } });
}
