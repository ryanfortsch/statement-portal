import { createClient } from '@supabase/supabase-js';
import { replayInventoryJournal } from './inventory-journal.ts';
import type { InventoryPlanningStore, PlanningState } from './inventory-planner.ts';
/** Dedicated synthetic staging store. Never falls back to production or initializes state. */
export function createInventoryPlanningStore(url: string, key: string, fetcher: typeof fetch = fetch): InventoryPlanningStore {
  if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key) {
    throw new Error('Explicit isolated staging storage required');
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  return {
    async read() {
      const { data, error } = await db.rpc('helm_pilot_inventory_planning_read');
      if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Planning snapshot unavailable');
      // Planner validates the snapshot and configuration before forming any command.
      return data as PlanningState;
    },
    async commit(expected, journal, freshUntil) {
      const normalized = replayInventoryJournal(journal).journal;
      for (const [value, min] of [[expected.snapshotVersion, 1], [expected.configurationVersion, 1], [expected.journalVersion, 0], [freshUntil, 0]]) {
        if (!Number.isSafeInteger(value) || value < min) throw new Error('Invalid planning version or freshness');
      }
      if (normalized.commands.length !== expected.journalVersion + 1 || normalized.commands.at(-1)?.kind !== 'enqueue') throw new Error('Expected one inventory plan');
      const { data, error } = await db.rpc('helm_pilot_inventory_plan_commit', {
        expected_snapshot: expected.snapshotVersion, expected_configuration: expected.configurationVersion,
        expected_journal: expected.journalVersion, next_journal: normalized, fresh_until: freshUntil,
      });
      if (error || typeof data !== 'boolean') throw new Error('Planning save uncertain; do not dispatch');
      return data;
    },
  };
}
