/** One explicit attempt. No loop, env credentials, scheduler or production URL. */
import { ChannexAvailabilityClient } from './availability-client.ts';
import { bookingInventoryDispatchContext, parseBookingInventoryState, type BookingInventoryConsumerStore } from './booking-inventory-consumer.ts';
import { recordInventoryCommand, replayInventoryJournal } from './inventory-journal.ts';
import { prepareInventoryDispatch } from './inventory-worker.ts';

export async function deliverBookingInventoryOnce(store: BookingInventoryConsumerStore, client: ChannexAvailabilityClient,
  id: string, clock = Date.now) {
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
  const lastAttempt = Math.max(-6000, ...journal.commands.filter(cmd => cmd.kind === 'dispatch').map(cmd => cmd.now));
  const retryUntil = Math.max(0, ...journal.commands.filter(cmd => cmd.kind === 'rejected' && cmd.failure === 'retryable')
    .map(cmd => cmd.kind === 'rejected' ? cmd.now + Math.max(60_000, cmd.retryAfterMs) : 0));
  if (now < lastAttempt + 6000 || now < retryUntil) return { status: 'blocked' as const };
  const permit = await client.prepare(job);
  if (!permit.request) return { status: 'already-matches' as const }; // Observation, not task settlement.
  let freshUntil = 0;
  const prepared = await prepareInventoryDispatch(store.journal, id, clock, 60_000, async claimed => {
    const latest = await bookingInventoryDispatchContext(store, claimed, clock);
    freshUntil = latest.freshUntil; return latest;
  }, permit.request);
  if (!prepared) return { status: 'blocked' as const };
  // Any exception after this point leaves the durable barrier intact. Never infer
  // non-acceptance or automatically retry a response/save whose outcome is unknown.
  if (clock() >= freshUntil) throw new Error('Inventory expired after submitting save; review without sending');
  const outcome = await permit.submit(prepared);
  const base = { id, token: prepared.token! };
  const command = outcome.status === 'accepted' ? { kind: 'accepted' as const, ...base, task: outcome.task,
    receipt: { requestDigest: permit.request.digest, receivedAt: clock() } }
    : outcome.status === 'ambiguous' ? { kind: 'ambiguous' as const, ...base }
    : { kind: 'rejected' as const, ...base, failure: outcome.failure, now: clock(), retryAfterMs: outcome.retryAfterMs, jitter: 0 };
  const saved = await recordInventoryCommand(store.journal, command);
  if (!saved.saved) throw new Error('Inventory response save uncertain; reread without resending');
  return { status: outcome.status === 'accepted' ? 'submitted' as const : outcome.status === 'ambiguous' ? 'uncertain' as const
    : outcome.failure === 'retryable' && prepared.attempts < 5 ? 'retry-pending' as const : 'needs-review' as const };
}
