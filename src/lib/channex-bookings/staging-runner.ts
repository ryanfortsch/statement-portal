/** One bounded staging rehearsal. Importing this module never starts processing. */
import { CALDERWOOD_STAGING } from '../calderwood-readonly/channex.ts';
import { createAirbnbRevisionReader } from './client.ts';
import { createAirbnbBookingStore } from './store.ts';
import { createAirbnbThreadReader } from './thread.ts';
import { processAirbnbBookingCycle } from './cycle.ts';
type Env = Record<string, string | undefined>;
const database = 'https://jgkblfozftcvymvwhhii.supabase.co';
export function createStagingProviderRunner(env: Env, fetcher: typeof fetch = fetch) {
  if (env.CHANNEX_AIRBNB_REHEARSAL_ENABLED !== 'true') return null;
  const generation = Number(env.CHANNEX_AIRBNB_MAPPING_GENERATION);
  if (typeof window !== 'undefined' || env.CHANNEX_WORKER_MODE !== 'isolated-staging'
      || env.VERCEL_ENV || env.CHANNEX_STAGING_DB_URL !== database
      || env.CHANNEX_STAGING_DB_PROJECT_REF !== 'jgkblfozftcvymvwhhii'
      || env.CHANNEX_CANONICAL_POLLING_ENABLED === 'true'
      || env.CHANNEX_AIRBNB_ACK_ENABLED !== 'true'
      || !/^[1-9]\d*$/.test(env.CHANNEX_AIRBNB_MAPPING_GENERATION ?? '')
      || !Number.isSafeInteger(generation))
    throw Error('Isolated provider rehearsal configuration required');
  const key = env.CHANNEX_STAGING_API_KEY, storageKey = env.CHANNEX_STAGING_DB_SERVICE_KEY;
  if (![key, storageKey].every(v => v?.trim() && !/[\r\n]/.test(v)))
    throw Error('Explicit staging credentials required');
  const mapping = Object.freeze({ ...CALDERWOOD_STAGING, environment: 'staging' as const, generation });
  const providerKey = key!.trim(), dbKey = storageKey!.trim();
  return async (signal: AbortSignal) => {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    const boundedFetch: typeof fetch = (url, init) => {
      deadline.throwIfAborted();
      const origin = new URL(String(url)).origin;
      if (![database, 'https://staging.channex.io'].includes(origin)) throw Error('Non-staging request refused');
      return fetcher(url, { ...init, redirect: 'error', cache: 'no-store',
        signal: AbortSignal.any([deadline, AbortSignal.timeout(20_000), ...(init?.signal ? [init.signal] : [])]) });
    };
    const rpc = async (name: string, args: Record<string, unknown>) => {
      if (!['helm_airbnb_thread_candidates', 'helm_airbnb_thread_register', 'helm_airbnb_messages_tick',
        'helm_airbnb_revision_commit', 'helm_airbnb_revision_receipt'].includes(name)) throw Error('RPC refused');
      try {
        const response = await boundedFetch(database + '/rest/v1/rpc/' + name, { method: 'POST',
          headers: { apikey: dbKey, Authorization: 'Bearer ' + dbKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(args) });
        if (!response.ok || response.redirected) throw Error();
        return { data: await response.json(), error: null };
      } catch { throw Error('Staging provider storage unavailable'); }
    };
    try {
      return await processAirbnbBookingCycle(
        createAirbnbRevisionReader({ mapping, apiKey: providerKey, acknowledgeEnabled: true }, boundedFetch),
        createAirbnbBookingStore(rpc), mapping, rpc, 25, createAirbnbThreadReader(providerKey, boundedFetch));
    } catch { throw Error('Staging provider rehearsal incomplete; no send authority granted'); }
  };
}
