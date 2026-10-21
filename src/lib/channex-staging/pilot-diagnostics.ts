/** Read-only operational report, never a publication or message-send permit. */
import { parseBookingInventoryState, bookingInventoryCoverage } from './booking-inventory-consumer.ts';
import { inventoryJournalCapacity, replayInventoryJournal } from './inventory-journal.ts';
import { parseCanonicalConflictReport } from './canonical-conflicts.ts';
import { CANONICAL_PILOT_PROPERTY } from './canonical-revisions.ts';
export function pilotDiagnostics(rawState: unknown, rawConflicts: unknown, now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid diagnostic clock');
  const state = parseBookingInventoryState(rawState, CANONICAL_PILOT_PROPERTY);
  const conflicts = parseCanonicalConflictReport(rawConflicts);
  const { journal, queue } = replayInventoryJournal(state.journal), jobs = queue.list();
  const c = state.configuration;
  const coverage = bookingInventoryCoverage(state, c.start, c.end, now);
  const history = inventoryJournalCapacity(journal.commands.length);
  const unresolved = jobs.filter(j => !['pending', 'verified', 'superseded'].includes(j.status));
  return { checkedAt: new Date(now).toISOString(), property: state.property,
    publishingEnabled: c.publishEnabled, captureEnabled: state.captureEnabled,
    window: { start: c.start, end: c.end },
    history, conflicts,
    source: { completeAndFresh: !!coverage, freshUntil: coverage ? Math.min(...coverage.map(v => v.freshUntil)) : null },
    inventory: { pending: jobs.filter(j => j.status === 'pending').length, unresolved: unresolved.length,
      needsReview: unresolved.filter(j => j.status === 'needs-review').length,
      awaitingTask: unresolved.filter(j => ['submitting', 'submitted', 'uncertain'].includes(j.status)).length },
    attentionRequired: conflicts.openCount > 0 || unresolved.length > 0 || history.status !== 'healthy' || !coverage,
    canPublish: false as const, canSendMessages: false as const };
}
