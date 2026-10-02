import { createClient } from '@supabase/supabase-js';
import type { ClosureStore, ClosureState } from './closure-worker.ts';
/** Explicit staging-only configuration. Never fall back to Helm's database environment variables. */
export function createClosureStore(url: string, serviceKey: string, approvedProjectRef: string): ClosureStore {
  if (typeof window !== 'undefined') throw new Error('Server-only staging storage');
  if (!/^[a-z0-9]{20}$/.test(approvedProjectRef) || url !== `https://${approvedProjectRef}.supabase.co` || !serviceKey) throw new Error('Explicit staging project configuration required');
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async read() {
      const { data, error } = await db.from('helm_pilot_closure_state').select('version,operation').eq('id',1).single();
      if (error || !data) throw new Error('Staging closure state unavailable');
      return data as ClosureState;
    },
    async replace(expectedVersion, operation) {
      const { data, error } = await db.rpc('helm_pilot_closure_cas', { expected_version: expectedVersion, next_operation: operation });
      if (error || typeof data !== 'boolean') throw new Error('Staging closure state could not be saved');
      return data;
    },
  };
}
