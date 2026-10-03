/** One-shot completion-save fault drill. Provider writes are structurally unavailable. */
import { runClosure, inspectClosureSnapshot, type ClosureStore } from './closure-worker.ts';
import type { ChannexStagingClient } from './client.ts';
const drillId = 'preview-recovery-20270201';
export async function runRecoveryDrill(store: ClosureStore, client: Pick<ChannexStagingClient, 'readSnapshot'>) {
  const before = await store.read();
  if (before.operation.id === drillId) throw new Error('Drill already started; reconcile instead');
  if (before.operation.id !== 'preview-closure-20270201' || before.operation.status !== 'observed-closed'
      || before.operation.ownershipVerified !== false || before.operation.dates.length !== 1
      || before.operation.dates[0] !== '2027-02-01') throw new Error('Completed baseline required');
  if (!inspectClosureSnapshot(await client.readSnapshot(), ['2027-02-01'])) throw new Error('Drill requires closed inventory');
  if (!await store.replace(before.version, { id: drillId, dates: ['2027-02-01'], status: 'pending', ownershipVerified: false })) throw new Error('State changed; reread');
  const injected = new Error('Injected completion-save failure');
  const faultStore: ClosureStore = {
    read: () => store.read(),
    replace: async (version, operation) => {
      if (operation.status !== 'in-flight') throw injected;
      return store.replace(version, operation);
    },
  };
  // Preserve ordinary provider/read failures as failures, not successful drill evidence.
  let verifiedReads = 0;
  const readOnlyClient = {
    readSnapshot: async () => { const snapshot = await client.readSnapshot();
      if (!inspectClosureSnapshot(snapshot, ['2027-02-01'])) throw new Error('Inventory changed during drill');
      verifiedReads++; return snapshot;
    },
    publishStoppedInventory: async (): Promise<{ verifiedNights: number }> => { throw new Error('Provider writes forbidden in recovery drill'); },
  };
  try { await runClosure(faultStore, readOnlyClient); }
  catch (error) {
    const saved = await store.read();
    if (error !== injected || verifiedReads !== 2 || saved.version !== before.version + 2
        || saved.operation.id !== drillId || saved.operation.status !== 'in-flight') throw new Error('Drill incomplete; read history and reconcile');
    return { faultInjected: true, providerWrites: 0, result: saved.operation };
  }
  throw new Error('Fault was not reached');
}
