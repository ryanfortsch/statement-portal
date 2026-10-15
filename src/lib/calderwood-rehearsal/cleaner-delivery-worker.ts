/** Synthetic worker only. No phone numbers, message bodies, env or SMS client. */
import { createHash } from 'node:crypto';
import type { createCleanerDeliveryDb } from './cleaner-delivery-db.ts';
import { cleanerDeliverySummary, recipientDisposition } from './cleaner-delivery.ts';

export type CleanerDeliveryStorage = ReturnType<typeof createCleanerDeliveryDb>;
export type CleanerRehearsalPlan = {
  messageId: string; recipientId: string; attemptId: string;
  bookingRevision: string; contentRevision: string;
  fireAt: number; expiresAt: number;
};
export type CleanerDispatchContext = {
  messageId: string; bookingRevision: string; contentRevision: string;
  status: 'confirmed' | 'cancelled'; held: boolean;
  owner: 'helm' | 'guesty'; previousSenderStopped: boolean;
  observedAt: number; validUntil: number;
};
export type CleanerSimulation = {
  mode: 'synthetic';
  dispatch(input: { messageId: string; recipientId: string; attemptId: string }): Promise<
    { state: 'accepted'; providerId: string } | { state: 'unknown' }
  >;
};
export function isCleanerFixtureId(value: unknown): value is string {
  return typeof value === 'string' && /^HELMTEST-[A-Za-z0-9_-]{1,160}$/.test(value);
}
export function assertCleanerFixture(messageId: string, recipientIds: readonly string[]) {
  if (messageId !== 'HELMTEST-cleaner-message'
      || JSON.stringify(recipientIds) !== JSON.stringify(['HELMTEST-cleaner-a', 'HELMTEST-cleaner-b'])) {
    throw Error('Only the fixed fictional cleaner fixture is supported');
  }
}
function blocked(plan: CleanerRehearsalPlan, context: CleanerDispatchContext | null, now: number): string | null {
  if (!Number.isSafeInteger(now) || now < plan.fireAt || now >= plan.expiresAt) return 'outside-send-window';
  if (!context || context.messageId !== plan.messageId
      || context.bookingRevision !== plan.bookingRevision || context.contentRevision !== plan.contentRevision) return 'changed-context';
  if (!Number.isSafeInteger(context.observedAt) || !Number.isSafeInteger(context.validUntil)
      || context.observedAt > now || context.validUntil <= now || context.validUntil <= context.observedAt) return 'stale-context';
  if (context.status !== 'confirmed' || context.held !== false) return 'cancelled-or-held';
  if (context.owner !== 'helm' || context.previousSenderStopped !== true) return 'sender-not-owned';
  return null;
}

/** A new committed claim is required before invoking even the simulator. */
export async function runCleanerDeliveryRehearsal(input: {
  store: CleanerDeliveryStorage; plan: CleanerRehearsalPlan; simulation: CleanerSimulation;
  readContext(): Promise<CleanerDispatchContext | null>; now(): number;
}) {
  const { store, plan, simulation } = input;
  if (simulation.mode !== 'synthetic' || !isCleanerFixtureId(plan.attemptId)
      || !plan.bookingRevision?.trim() || !plan.contentRevision?.trim()
      || !Number.isSafeInteger(plan.fireAt) || !Number.isSafeInteger(plan.expiresAt) || plan.fireAt >= plan.expiresAt) {
    throw Error('Valid synthetic plan and simulator required');
  }
  const current = await store.read();
  assertCleanerFixture(current.ledger.messageId, current.ledger.recipients.map(r => r.recipientId));
  if (plan.messageId !== current.ledger.messageId) throw Error('Message identity mismatch');
  const recipient = current.ledger.recipients.find(r => r.recipientId === plan.recipientId);
  if (!recipient) throw Error('Recipient is not in the fixed fixture');
  const finish = (status: string) => ({ status, canSend: false as const });
  const disposition = recipientDisposition(recipient);
  // Rejected, unknown and already accepted attempts all require explicit review.
  if (disposition !== 'not-attempted') return finish(disposition);
  const before = blocked(plan, await input.readContext(), input.now());
  if (before) return finish(before);
  const claim = await store.append(current.version, { id: `claim:${plan.attemptId}`,
    event: { type: 'start', recipientId: plan.recipientId, attemptId: plan.attemptId } });
  if (!claim.appended) return finish('existing-claim');
  // Fresh booking/hold/ownership evidence after claiming, immediately before dispatch.
  // If this read throws, the claim stays unresolved and cannot be automatically retried.
  const after = blocked(plan, await input.readContext(), input.now());
  if (after) {
    await store.append(claim.state.version, { id: `blocked:${plan.attemptId}`,
      event: { type: 'result', recipientId: plan.recipientId, attemptId: plan.attemptId, state: 'rejected' } });
    return finish(after);
  }
  let outcome: { state: 'accepted'; providerId: string } | { state: 'unknown' } = { state: 'unknown' };
  try {
    const result = await simulation.dispatch({ messageId: plan.messageId, recipientId: plan.recipientId, attemptId: plan.attemptId });
    if (result?.state === 'accepted' && isCleanerFixtureId(result.providerId)) {
      outcome = { state: 'accepted', providerId: result.providerId };
    }
  } catch {
    // Timeout, crash-like errors and malformed replies never establish non-delivery.
  }
  // A failure here may follow a committed write. Never call dispatch again to repair it.
  const saved = await store.append(claim.state.version, { id: `response:${plan.attemptId}`,
    event: { type: 'result', recipientId: plan.recipientId, attemptId: plan.attemptId, ...outcome } });
  return { ...finish(outcome.state), summary: cleanerDeliverySummary(saved.state.ledger) };
}

/** In-process fake provider, deliberately independent of the existing Quo sender. */
export function createCleanerDeliverySimulator(outcome: 'accepted' | 'timeout' = 'accepted'): CleanerSimulation {
  return { mode: 'synthetic', async dispatch(input) {
    if (!isCleanerFixtureId(input.attemptId)) throw Error('Fictional attempt required');
    if (outcome === 'timeout') throw Error('Simulated uncertain response');
    return { state: 'accepted', providerId: `HELMTEST-provider-${createHash('sha256').update(input.attemptId).digest('hex')}` };
  } };
}
