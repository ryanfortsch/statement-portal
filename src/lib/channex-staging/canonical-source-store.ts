import { createClient } from '@supabase/supabase-js';
import { parseCanonicalSourceSnapshot, parseSourceBookings, type CanonicalSourceStore } from './canonical-source.ts';
export function createCanonicalSourceStore(url: string, key: string, fetcher: typeof fetch = fetch): CanonicalSourceStore {
  if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key.trim()) throw Error('Isolated source storage required');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  return {
    async read() {
      const { data, error } = await db.rpc('helm_pilot_source_read');
      if (error || !data) throw Error('Canonical source state unavailable');
      return parseCanonicalSourceSnapshot(data);
    },
    async certify(expected, bookings, observedAt, start, end) {
      const { data, error } = await db.rpc('helm_pilot_source_certify', { p_expected: parseCanonicalSourceSnapshot(expected),
        p_bookings: parseSourceBookings(bookings), p_observed_at: observedAt, p_start: start, p_end: end });
      if (error || typeof data !== 'boolean') throw Error('Source certification uncertain; reverify before retry');
      return data;
    },
  };
}
