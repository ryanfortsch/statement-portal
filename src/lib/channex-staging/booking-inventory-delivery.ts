import { inventoryStage, InventoryDeliveryError } from './inventory-diagnostics.ts';
/** One explicit attempt. No loop, env credentials, scheduler or production URL. */
import { ChannexAvailabilityClient } from './availability-client.ts';
import { bookingInventoryDispatchContext, parseBookingInventoryState, type BookingInventoryConsumerStore } from './booking-inventory-consumer.ts';
import { inventoryResumeAfter, recordInventoryCommand, replayInventoryJournal } from './inventory-journal.ts';
import { prepareInventoryDispatch } from './inventory-worker.ts';

export async function deliverBookingInventoryOnce(store: BookingInventoryConsumerStore, client: ChannexAvailabilityClient,
  id: string, clock = Date.now, fullSync?: { id: string; digest: string }) {
  // Expired leases that never submitted are safe to reclaim; expired submissions
  // become uncertain and remain blocked. This also works after process restart.
  await recordInventoryCommand(store.journal, { kind: 'expire', now: clock() });
  const state = parseBookingInventoryState(await store.read(), store.property), r = client.route, c = state.configuration;
  if (r.helmProperty !== store.property || r.connection !== c.connection || r.generation !== c.generation || r.roomTypeId !== c.listing) {
    throw new Error('Reviewed inventory route does not match persisted configuration');
  }
  const { journal, queue } = replayInventoryJournal(state.journal);
  const job = queue.list().find(j => j.id === id), now = clock();
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid inventory clock');
  // Recovered submitting/submitted/uncertain jobs NEVER enter the transport again.
  if (!job || job.status !== 'pending' || now < job.nextAttemptAt) return { status: 'blocked' as const };
  if (queue.list().some(j => j.id !== id && !['pending', 'verified', 'superseded'].includes(j.status))) return { status: 'blocked' as const };
  const context = await bookingInventoryDispatchContext(store, job, clock);
  if (!context.enabled || !context.complete || context.authority !== 'helm' || now >= context.freshUntil) return { status: 'blocked' as const };
  // Conservative property pacing survives process restarts through the journal.
  if (now < inventoryResumeAfter(journal)) return { status: 'blocked' as const };
  const permit = await inventoryStage('prepare', () => client.prepare(job, fullSync));
  if (!permit.request) return { status: 'already-matches' as const }; // Observation, not task settlement.
  const request = permit.request;
  let freshUntil = 0;
  const prepared = await inventoryStage('dispatch-save', () => prepareInventoryDispatch(store.journal, id, clock, 60_000, async claimed => {
    const latest = await bookingInventoryDispatchContext(store, claimed, clock);
    freshUntil = latest.freshUntil; return latest;
  }, request));
  if (!prepared) return { status: 'blocked' as const };
  // Any exception after this point leaves the durable barrier intact. Never infer
  // non-acceptance or automatically retry a response/save whose outcome is unknown.
  if (clock() >= freshUntil) throw new InventoryDeliveryError('before-send');
  const outcome = await inventoryStage('submit', () => permit.submit(prepared));
  const base = { id, token: prepared.token! };
  const command = outcome.status === 'accepted' ? { kind: 'accepted' as const, ...base, task: outcome.task,
    receipt: { requestDigest: permit.request.digest, receivedAt: clock() } }
    : outcome.status === 'ambiguous' ? { kind: 'ambiguous' as const, ...base }
    : { kind: 'rejected' as const, ...base, failure: outcome.failure, now: clock(), retryAfterMs: outcome.retryAfterMs, jitter: 0 };
  const saved = await inventoryStage('receipt-save', () => recordInventoryCommand(store.journal, command));
  if (!saved.saved) throw new InventoryDeliveryError('receipt-save');
  return { status: outcome.status === 'accepted' ? 'submitted' as const : outcome.status === 'ambiguous' ? 'uncertain' as const
    : outcome.failure === 'retryable' && prepared.attempts < 5 ? 'retry-pending' as const : 'needs-review' as const };
}
