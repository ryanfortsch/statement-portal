/** Snapshot-to-outbox transaction boundary. No production adapter or provider IO. */
import { createHash } from 'node:crypto';
import { projectInventory, type InventorySnapshot } from './inventory-projection.ts';
import { replayInventoryJournal, type InventoryJournal } from './inventory-journal.ts';
import type { InventoryIntent } from './inventory-outbox.ts';
export type PlanningState = {
  snapshot: InventorySnapshot;
  configurationVersion: number;
  journalVersion: number;
  journal: unknown;
  connection: string;
  property: string;
  listing: string;
  generation: number;
};
export type PlanningExpectation = Pick<PlanningState, 'configurationVersion' | 'journalVersion'> & { snapshotVersion: number };
export interface InventoryPlanningStore {
  /** Snapshot, routing configuration and journal must be read consistently. */
  read(): Promise<PlanningState>;
  /** Atomically compare ALL versions and append the single event. No provider IO.
   * Must also reject expired coverage at commit time. Never adapt using separate reads/writes.
   */
  commit(expected: PlanningExpectation, journal: InventoryJournal, freshUntil: number): Promise<boolean>;
}
export async function planInventory(store: InventoryPlanningStore, start: string, end: string, clock: () => number) {
  const state = await store.read();
  for (const v of [state.configurationVersion, state.generation]) {
    if (!Number.isSafeInteger(v) || v < 1) throw new Error('Invalid planning configuration');
  }
  const { journal, queue } = replayInventoryJournal(state.journal);
  if (state.journalVersion !== journal.commands.length) throw new Error('Planning journal version mismatch');
  const now = clock();
  const projection = projectInventory(state.snapshot, state.listing, start, end, now);
  if (!projection.complete) return { status: 'blocked' as const, projection };
  const identity = JSON.stringify(['staging', state.connection, state.property, state.listing,
    state.generation, state.configurationVersion, projection.version, start, end]);
  const intent: InventoryIntent = {
    id: `projection-${createHash('sha256').update(identity).digest('hex')}`,
    environment: 'staging', connection: state.connection, property: state.property,
    generation: state.generation, version: projection.version, days: projection.days,
  };
  const before = JSON.stringify(queue.list());
  queue.enqueue(intent, now); // Enforces ordering and detects reused identity with changed content.
  if (before === JSON.stringify(queue.list())) return { status: 'unchanged' as const, projection };
  if (journal.commands.length >= 10_000) throw new Error('Inventory journal needs reviewed compaction');
  journal.commands.push({ kind: 'enqueue', intent, now });
  const saved = await store.commit({ snapshotVersion: projection.version,
    configurationVersion: state.configurationVersion, journalVersion: state.journalVersion }, journal, projection.freshUntil);
  return { status: saved ? 'queued' as const : 'superseded' as const, projection };
}
