/** Closure-only staging worker. No reopening or Guesty publisher. */
import type { ChannexStagingClient, StagingSnapshot } from './client.ts';
import { nights, TEST_START, TEST_END, type AvailabilityDay } from './core.ts';
export type ClosureOperation = { id: string; dates: string[]; status: 'pending' | 'in-flight' | 'observed-closed' | 'needs-review'; ownershipVerified: false };
export type ClosureState = { version: number; operation: ClosureOperation };
export interface ClosureStore {
  read(): Promise<ClosureState>;
  /** Atomic compare-and-swap; false means another writer changed the state. */
  replace(expectedVersion: number, operation: ClosureOperation): Promise<boolean>;
}
type Client = Pick<ChannexStagingClient, 'readSnapshot' | 'publishStoppedInventory'>;
function validate(op: ClosureOperation) {
  if (!op || !/^[A-Za-z0-9_-]{1,160}$/.test(op.id) || op.ownershipVerified !== false || !['pending','in-flight','observed-closed','needs-review'].includes(op.status) || !Array.isArray(op.dates) || !op.dates.length || op.dates.length > 120 || new Set(op.dates).size !== op.dates.length) throw new Error('Invalid closure operation');
  const allowed = new Set(nights(TEST_START, TEST_END));
  if (op.dates.some(d => !allowed.has(d))) throw new Error('Date outside pilot');
}
export function inspectClosureSnapshot(snapshot: StagingSnapshot, dates: string[]): boolean {
  if (snapshot.bookings.some(b => b.status !== 'cancelled')) throw new Error('Active stays require review');
  const expected = new Set(['front','back'].flatMap(u => nights(TEST_START, TEST_END).map(d => `${u}:${d}`)));
  for (const n of snapshot.inventory) {
    if (!expected.delete(`${n.unit}:${n.date}`) || n.stopSell !== true || n.minStay !== 20 || (n.inventory !== 0 && n.inventory !== 1)) throw new Error('Unsafe staging snapshot');
  }
  if (expected.size) throw new Error('Incomplete staging snapshot');
  return snapshot.inventory.filter(n => dates.includes(n.date)).every(n => n.inventory === 0);
}
/** Save intent before IO. An interrupted in-flight operation is NEVER sent again automatically. */
export async function runClosure(store: ClosureStore, client: Client, recover = false): Promise<ClosureOperation> {
  const state = await store.read(); validate(state.operation);
  if (!Number.isSafeInteger(state.version) || state.version < 0) throw new Error('Invalid storage version');
  const op = state.operation;
  if (op.status === 'observed-closed') return op;
  if (recover) {
    if (op.status !== 'in-flight' && op.status !== 'needs-review') throw new Error('No interrupted operation to reconcile');
    // Read-only recovery: matching inventory is observation, not ownership or delivery proof.
    const closed = inspectClosureSnapshot(await client.readSnapshot(), op.dates);
    const result: ClosureOperation = { ...op, status: closed ? 'observed-closed' : 'needs-review' };
    if (!await store.replace(state.version, result)) throw new Error('Concurrent reconciliation; reread state');
    return result;
  }
  if (op.status !== 'pending') throw new Error('Uncertain operation requires read-only reconciliation');
  const intent: ClosureOperation = { ...op, status: 'in-flight' };
  if (!await store.replace(state.version, intent)) throw new Error('Another worker acquired the operation');
  const version = state.version + 1;
  try {
    const alreadyClosed = inspectClosureSnapshot(await client.readSnapshot(), op.dates);
    if (!alreadyClosed) {
      const days: AvailabilityDay[] = ['front','back'].flatMap(member => op.dates.map(date => ({ member: member as 'front'|'back', date, availability: 0, blockers: ['staging-closure-only'] })));
      await client.publishStoppedInventory(days);
    }
    if (!inspectClosureSnapshot(await client.readSnapshot(), op.dates)) throw new Error('Read-back mismatch');
    const result: ClosureOperation = { ...op, status: 'observed-closed' };
    if (!await store.replace(version, result)) throw new Error('Completion could not be recorded');
    return result;
  } catch (error) {
    // Failure to save leaves durable in-flight intent for later read-only reconciliation.
    await store.replace(version, { ...op, status: 'needs-review' });
    throw error;
  }
}
