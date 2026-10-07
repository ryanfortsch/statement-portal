/** Isolated synthetic worker exercise. Never import a Channex transport here. */
import { recordInventoryCommand, replayInventoryJournal, type InventoryJournalStore } from './inventory-journal.ts';
import { prepareInventoryDispatch } from './inventory-worker.ts';
import type { InventoryJob } from './inventory-outbox.ts';

export interface SyntheticInventoryProvider {
  kind: 'synthetic';
  submit(job: InventoryJob): Promise<string>;
  inspect(job: InventoryJob): Promise<{ settled: boolean; complete: boolean; digest: string; generation: number }>;
}
export async function runInventoryRehearsal(
  store: InventoryJournalStore, provider: SyntheticInventoryProvider, runId: string,
  phase: 'dispatch' | 'recover', clock: () => number,
  afterSubmit?: () => never, leaseMs = 30_000,
) {
  if (provider.kind !== 'synthetic' || !/^rehearsal-[a-z0-9-]{1,60}$/.test(runId)) throw new Error('Synthetic rehearsal required');
  const id = runId;
  if (phase === 'dispatch') {
    await recordInventoryCommand(store, { kind: 'enqueue', now: clock(), intent: {
      id, environment: 'staging', connection: `synthetic-${runId}`, property: 'synthetic-inventory-home',
      generation: 1, version: 1, days: [{ date: '2027-02-01', available: 0, stopSell: true }],
    } });
    const job = await prepareInventoryDispatch(store, id, clock, leaseMs, async j => ({
      environment: j.environment, connection: j.connection, property: j.property,
      generation: j.generation, version: j.version, digest: j.digest, authority: 'helm',
      enabled: true, complete: true, freshUntil: clock() + leaseMs,
    }));
    if (!job) return { result: 'not-dispatched', submissions: 0 };
    // The durable barrier is already committed. Any exception leaves an uncertain attempt.
    const task = await provider.submit(job);
    afterSubmit?.();
    const saved = await recordInventoryCommand(store, { kind: 'accepted', id, token: job.token!, task });
    return { result: saved.saved ? 'submitted' : 'save-unconfirmed', submissions: 1 };
  }
  if (phase !== 'recover') throw new Error('Unknown rehearsal phase');
  await recordInventoryCommand(store, { kind: 'expire', now: clock() });
  const { queue } = replayInventoryJournal((await store.read()).journal);
  const job = queue.list().find(j => j.id === id);
  if (!job || job.connection !== `synthetic-${runId}` || job.property !== 'synthetic-inventory-home') throw new Error('Rehearsal identity mismatch');
  if (job.status === 'verified') return { result: 'verified', submissions: 0 };
  if (job.status !== 'submitted' && job.status !== 'uncertain') return { result: 'waiting', submissions: 0 };
  const evidence = await provider.inspect(job);
  const saved = await recordInventoryCommand(store, { kind: 'reconcile', id, token: job.token!, evidence });
  return { result: saved.saved && saved.result === true ? 'verified' : 'unresolved', submissions: 0 };
}
