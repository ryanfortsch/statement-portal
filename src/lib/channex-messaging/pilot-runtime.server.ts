import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { retainedPilotConfiguration } from './runtime-config';
import { runRetainedCalderwoodPilot } from './pilot-runtime';

/** Called only after the route's exact cron credential check. All network RPCs
 * are time-bounded. Credential loading reads the shared token cache only: a
 * potentially long OAuth retry must not delay a due send or refresh implicitly.
 */
export async function executeRetainedMessageTick() {
  const manifest = retainedPilotConfiguration(process.env);
  if (!manifest) return { state: 'disabled', ok: true, stays: [] };
  let credentials: Promise<{ guestyToken: string; channexKey: string }> | undefined;
  return runRetainedCalderwoodPilot(manifest, {
    rpc: async (name, args) => {
      const { data, error } = await supabaseAdmin.rpc(name, args).abortSignal(AbortSignal.timeout(8000));
      return { data, error };
    },
    receiptKey: async () => process.env.CHANNEX_PRODUCTION_API_KEY!,
    credentials: () => credentials ??= (async () => {
      const { data, error } = await supabaseAdmin.from('guesty_auth').select('access_token,expires_at')
        .eq('id', 1).abortSignal(AbortSignal.timeout(8000)).maybeSingle();
      if (error || !data || typeof data.access_token !== 'string' || !data.access_token.trim()
        || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now() + 120_000) throw Error('Credentials unavailable');
      return { guestyToken: data.access_token, channexKey: process.env.CHANNEX_PRODUCTION_API_KEY! };
    })(),
  }, { enabled: true });
}
