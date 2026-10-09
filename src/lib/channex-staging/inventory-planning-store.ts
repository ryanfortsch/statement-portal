import { projectInventory, type InventorySnapshot } from './inventory-projection.ts';
import { createClient } from '@supabase/supabase-js';
import { replayInventoryJournal } from './inventory-journal.ts';
import type { InventoryPlanningStore, PlanningState } from './inventory-planner.ts';
export interface InventorySnapshotStore extends InventoryPlanningStore {
  /** Capture expected versions BEFORE collecting source pages. No initialization/retry. */
  replaceSnapshot(expected: { snapshotVersion: number; configurationVersion: number },
    snapshot: InventorySnapshot, start: string, end: string, now: number): Promise<boolean>;
}
/** Dedicated synthetic staging store. Never falls back to production or initializes state. */
export function createInventoryPlanningStore(url: string, key: string, fetcher: typeof fetch = fetch): InventorySnapshotStore {
  if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key) {
    throw new Error('Explicit isolated staging storage required');
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  return {
    async replaceSnapshot(expected, snapshot, start, end, now) {
      for (const value of [expected.snapshotVersion, expected.configurationVersion]) {
        if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid snapshot expectation');
      }
      if (snapshot.version !== expected.snapshotVersion + 1 || !Number.isSafeInteger(snapshot.version)) throw new Error('Expected next snapshot version');
      if (!snapshot.listings.length) throw new Error('No mapped listings');
      for (const listing of snapshot.listings) projectInventory(snapshot, listing.id, start, end, now);
      // Incomplete evidence may be saved to invalidate older availability; it cannot be planned.
      const { data, error } = await db.rpc('helm_pilot_inventory_snapshot_replace', {
        expected_snapshot: expected.snapshotVersion, expected_configuration: expected.configurationVersion,
        next_snapshot: snapshot,
      });
      if (error || typeof data !== 'boolean') throw new Error('Snapshot save uncertain; reread before planning');
      return data;
    },
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
