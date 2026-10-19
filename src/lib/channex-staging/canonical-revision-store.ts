import { createClient } from '@supabase/supabase-js';
import { parseCanonicalRevision, type CanonicalRevisionStore } from './canonical-revisions.ts';
export function createCanonicalRevisionStore(url: string, key: string, fetcher: typeof fetch = fetch): CanonicalRevisionStore {
  if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key.trim()) {
    throw Error('Explicit isolated staging storage required');
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    if (error || !data) throw Error('Canonical revision save/read incomplete; no ACK allowed');
    return data;
  }
  return {
    commit: r => rpc('helm_pilot_revision_commit', { p_revision: parseCanonicalRevision(r) }),
    receipt: id => {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('Invalid revision ID');
      return rpc('helm_pilot_revision_receipt', { p_id: id });
    },
  };
}
