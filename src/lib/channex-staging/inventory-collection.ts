/** Collection orchestration only. A source-specific, verified collector must be injected. */
import { assembleInventorySnapshot, type InventorySourceScan, type SnapshotConfiguration } from './inventory-snapshot.ts';
import { projectInventory } from './inventory-projection.ts';
import type { InventorySnapshotStore } from './inventory-planning-store.ts';
export type InventoryCollectionRequest = {
  connection: string; property: string; generation: number;
  configuration: SnapshotConfiguration; start: string; end: string;
};
export async function collectInventorySnapshot(
  store: Pick<InventorySnapshotStore,'read'|'replaceSnapshot'>,
  collect: (request: InventoryCollectionRequest) => Promise<InventorySourceScan[]>,
  start: string, end: string, clock: () => number,
) {
  // Do not reread and rebase the completed scan onto a newer database version.
  const baseline = structuredClone(await store.read());
  for (const value of [baseline.snapshot.version,baseline.configurationVersion,baseline.generation]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid collection baseline');
  }
  if (baseline.snapshot.version === Number.MAX_SAFE_INTEGER) throw new Error('Snapshot version exhausted');
  projectInventory(baseline.snapshot,baseline.listing,start,end,clock());
  const configuration: SnapshotConfiguration = {
    version:baseline.snapshot.version+1, resources:baseline.snapshot.resources,
    listings:baseline.snapshot.listings,requiredSources:baseline.snapshot.requiredSources,holds:baseline.snapshot.holds,
  };
  const scans = await collect({connection:baseline.connection,property:baseline.property,generation:baseline.generation,
    configuration:structuredClone(configuration),start,end});
  const now = clock();
  const snapshot = assembleInventorySnapshot(configuration,scans,start,end,now);
  const complete = snapshot.listings.every(l=>projectInventory(snapshot,l.id,start,end,now).complete);
  const saved = await store.replaceSnapshot({snapshotVersion:baseline.snapshot.version,
    configurationVersion:baseline.configurationVersion},snapshot,start,end,now);
  return {status:saved ? (complete ? 'saved' as const : 'saved-incomplete' as const) : 'superseded' as const,
    snapshotVersion:snapshot.version};
}
