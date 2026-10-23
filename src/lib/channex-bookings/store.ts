import { parseAirbnbBookingRevision } from './revision.ts';
import type { AirbnbBookingStore } from './ingestion.ts';
/** Caller supplies an authenticated server RPC adapter. No ambient credentials. */
export function createAirbnbBookingStore(rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>): AirbnbBookingStore {
  async function call(name: string, args: Record<string, unknown>) {
    if (typeof window !== 'undefined') throw Error('Server booking storage required');
    try {
      const result = await rpc(name, args);
      if (result.error || !result.data) throw Error();
      return result.data;
    } catch { throw Error('Airbnb booking storage incomplete; no acknowledgement allowed'); }
  }
  return {
    commit: revision => call('helm_airbnb_revision_commit', { p_revision: parseAirbnbBookingRevision(revision) }),
    receipt: id => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Error('Invalid revision ID');
      return call('helm_airbnb_revision_receipt', { p_id: id });
    },
  };
}
