import { createClient } from '@supabase/supabase-js';
import { replayInventoryJournal, type InventoryJournalStore } from './inventory-journal.ts';
/** No environment fallbacks or automatic initialization. Apply reviewed staging SQL first. */
export function createInventoryJournalStore(url: string, key: string, fetcher: typeof fetch = fetch): InventoryJournalStore {
  if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key) {
    throw new Error('Explicit isolated staging storage required');
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  return {
    async read() {
      const { data, error } = await db.from('helm_pilot_inventory_state').select('version,journal').eq('id', 1).single();
      if (error || !data || !Number.isSafeInteger(data.version) || data.version < 0) throw new Error('Inventory history unavailable');
      const { journal } = replayInventoryJournal(data.journal);
      if (journal.commands.length !== data.version) throw new Error('Inventory history version mismatch');
      return { version: data.version, journal };
    },
    async append(expectedVersion, journal) {
      const normalized = replayInventoryJournal(journal).journal;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || normalized.commands.length !== expectedVersion + 1) {
        throw new Error('Invalid inventory append');
      }
      const { data, error } = await db.rpc('helm_pilot_inventory_append', {
        expected_version: expectedVersion, next_journal: normalized,
      });
      if (error || typeof data !== 'boolean') throw new Error('Inventory save uncertain; do not dispatch');
      return data;
    },
  };
}
