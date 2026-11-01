/** Preparation only: no database writes, publishing enablement or provider IO.
 * Persist only through a paused-state atomic boundary that validates the retry ledger. */
import { replayInventoryJournal, inventoryJournalVersion, assertInventoryCommandCapacity, type InventoryCommand } from './inventory-journal.ts';
import type { RetrySnapshot } from './inventory-reviewed-retry.ts';
import { validateAvailabilityReceipt } from './availability-request.ts';

export function prepareSupportResolution(snapshot: RetrySnapshot, input: {
  originalId: string; requestDigest: string; supportMessage: string; reviewedBy: string;
}, now = Date.now()) {
  const { journal, queue } = replayInventoryJournal(snapshot.journal);
  const original = queue.list().find(j => j.id === input.originalId);
  if (!snapshot.current.workerPaused || snapshot.current.authority !== 'helm' ||
      !original || original.status !== 'uncertain' || !original.token || !original.request ||
      original.request.digest !== input.requestDigest || original.task || original.receipt ||
      original.property !== snapshot.current.property || original.connection !== snapshot.current.connection ||
      original.generation !== snapshot.current.generation) throw Error('Paused original attempt required');
  const retries = snapshot.records.filter(r => r.originalId === original.id && r.originalToken === original.token);
  const retry = retries[0];
  if (retries.length !== 1 || !retry || retry.outcome !== 'verified' || retry.job.status !== 'verified' ||
      retry.originalSettled !== false || retry.originalJournalVersion !== inventoryJournalVersion(journal) ||
      retry.job.request?.body !== original.request.body || retry.job.request?.digest !== input.requestDigest ||
      retry.job.property !== original.property || retry.job.connection !== original.connection ||
      retry.job.generation !== original.generation || !retry.job.task || !retry.job.receipt ||
      retry.job.receipt.receivedAt > now) throw Error('Distinct verified retry required');
  validateAvailabilityReceipt(retry.job.receipt, retry.job.task, retry.job);
  const command: InventoryCommand = { kind: 'retire-not-received', id: original.id, token: original.token,
    requestDigest: input.requestDigest, supportMessage: input.supportMessage,
    retryId: retry.id, retryTask: retry.job.task, reviewedBy: input.reviewedBy,
    reason: 'provider-asserted-non-receipt', now };
  assertInventoryCommandCapacity(journal.commands.length, command.kind);
  journal.commands.push(command);
  // Validate full history and the new command before offering it for persistence.
  const next = replayInventoryJournal(journal).journal;
  return { expectedVersion: inventoryJournalVersion(snapshot.journal as typeof journal), journal: next, command };
}
