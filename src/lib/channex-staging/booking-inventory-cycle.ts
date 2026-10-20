/** One bounded canonical planning/delivery/reconciliation pass. No credentials,
 * loop, coverage renewal or automatic enablement. Restart uses the saved journal.
 */
import { ChannexAvailabilityClient } from './availability-client.ts';
import { consumeBookingInventory, parseBookingInventoryState, type BookingInventoryConsumerStore } from './booking-inventory-consumer.ts';
import { deliverBookingInventoryOnce } from './booking-inventory-delivery.ts';
import { recordInventoryCommand, replayInventoryJournal, type InventoryJournalStore } from './inventory-journal.ts';

export async function reconcileBookingInventoryOnce(store: InventoryJournalStore, client: ChannexAvailabilityClient, id: string) {
  const state = await store.read(), { journal, queue } = replayInventoryJournal(state.journal);
  if (state.version !== journal.commands.length) throw Error('Inventory journal version mismatch');
  const job = queue.list().find(j => j.id === id);
  if (!job || !['submitted', 'uncertain'].includes(job.status) || !job.task || !job.receipt || !job.request || !job.token) {
    return { status: 'blocked' as const };
  }
  const result = await client.completion(job);
  if (result.status !== 'completed') return { status: result.status };
  if (!result.complete) return { status: 'incomplete' as const };
  const saved = await recordInventoryCommand(store, { kind: 'reconcile', id, token: job.token,
    evidence: { settled: true, complete: true, digest: result.digest, generation: job.generation,
      task: result.task, requestDigest: result.requestDigest,
      completion: { receivedAt: result.receivedAt, executedAt: result.executedAt,
        finishedAt: result.finishedAt, observedAt: result.observedAt } } });
  // A lost/CAS-failed save never authorizes another provider write.
  return { status: !saved.saved ? 'superseded' as const : saved.result ? 'verified' as const : 'needs-review' as const };
}

export async function runBookingInventoryCycle(store: BookingInventoryConsumerStore, client: ChannexAvailabilityClient, clock = Date.now) {
  await recordInventoryCommand(store.journal, { kind: 'expire', now: clock() });
  const state = parseBookingInventoryState(await store.read(), store.property), c = state.configuration, r = client.route;
  if (r.helmProperty !== store.property || r.connection !== c.connection || r.generation !== c.generation || r.roomTypeId !== c.listing) {
    throw Error('Inventory cycle route mismatch');
  }
  const unresolved = replayInventoryJournal(state.journal).queue.list().find(j => !['pending', 'verified', 'superseded'].includes(j.status));
  if (unresolved) {
    const result = await reconcileBookingInventoryOnce(store.journal, client, unresolved.id);
    if (result.status !== 'verified') return { phase: 'reconcile' as const, ...result };
  }
  const planned = await consumeBookingInventory(store, clock);
  if (!['queued', 'unchanged'].includes(planned.status)) return { phase: 'plan' as const, status: planned.status };
  const current = parseBookingInventoryState(await store.read(), store.property);
  const pending = replayInventoryJournal(current.journal).queue.list().filter(j => j.status === 'pending').at(-1);
  if (!pending) return { phase: 'plan' as const, status: 'unchanged' as const };
  return { phase: 'deliver' as const, ...await deliverBookingInventoryOnce(store, client, pending.id, clock) };
}
