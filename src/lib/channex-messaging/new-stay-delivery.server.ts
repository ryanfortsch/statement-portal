import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { runNewStayDeliveryTick } from './new-stay-delivery-tick';
import type { NewStayAudience } from './new-stay-delivery-config';
export async function executeNewStayDeliveryTick(audience: NewStayAudience) {
  return runNewStayDeliveryTick(audience, process.env, { rpc: async (name, args) => {
    const { data, error } = await supabaseAdmin.rpc(name, args).abortSignal(AbortSignal.timeout(8000));
    return { data, error };
  } });
}
