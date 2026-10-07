import { z } from 'zod';
import { MemoryInventoryOutbox } from './inventory-outbox.ts';

const int = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = int.min(1);
const id = z.string().trim().min(1);
const day = z.object({ date: z.string(), available: z.union([z.literal(0), z.literal(1)]), stopSell: z.boolean() }).strict();
const intent = z.object({ id, environment: z.literal('staging'), connection: id, property: id,
  generation: positive, version: positive, days: z.array(day).min(1) }).strict();
const context = z.object({ environment: z.literal('staging'), connection: id, property: id,
  generation: positive, version: positive, digest: id, authority: z.enum(['helm', 'guesty']),
  enabled: z.boolean(), complete: z.boolean(), freshUntil: int }).strict();
const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('enqueue'), intent, now: int }).strict(),
  z.object({ kind: z.literal('claim'), id, now: int, leaseMs: positive }).strict(),
  z.object({ kind: z.literal('dispatch'), id, token: id, context, now: int }).strict(),
  z.object({ kind: z.literal('accepted'), id, token: id, task: id }).strict(),
  z.object({ kind: z.literal('ambiguous'), id, token: id }).strict(),
  z.object({ kind: z.literal('rejected'), id, token: id, failure: z.enum(['retryable', 'permanent']),
    now: int, retryAfterMs: int, jitter: z.number().min(0).max(1) }).strict(),
  z.object({ kind: z.literal('expire'), now: int }).strict(),
  z.object({ kind: z.literal('reconcile'), id, token: id, evidence: z.object({ settled: z.boolean(),
    complete: z.boolean(), digest: id, generation: positive }).strict() }).strict(),
]);
const journalSchema = z.object({ format: z.literal(1), commands: z.array(commandSchema).max(10_000) }).strict();
export type InventoryCommand = z.infer<typeof commandSchema>;
export type InventoryJournal = z.infer<typeof journalSchema>;
export const emptyInventoryJournal = (): InventoryJournal => ({ format: 1, commands: [] });
function apply(queue: MemoryInventoryOutbox, command: InventoryCommand) {
  switch (command.kind) {
    case 'enqueue': return queue.enqueue(command.intent, command.now);
    case 'claim': return queue.claim(command.id, command.now, command.leaseMs);
    case 'dispatch': return queue.beginDispatch(command.id, command.token, command.context, command.now);
    case 'accepted': return queue.accepted(command.id, command.token, command.task);
    case 'ambiguous': return queue.ambiguous(command.id, command.token);
    case 'rejected': return queue.rejected(command.id, command.token, command.failure, command.now, command.retryAfterMs, command.jitter);
    case 'expire': return queue.expire(command.now);
    case 'reconcile': return queue.reconcile(command.id, command.token, command.evidence);
  }
}
/** Replaying preserves claim sequence numbers and every pre-dispatch barrier.
 * Corrupt/oversized history fails closed; never replace it with an empty queue.
 */
export function replayInventoryJournal(value: unknown) {
  const journal = journalSchema.parse(value);
  const queue = new MemoryInventoryOutbox();
  for (const command of journal.commands) apply(queue, command);
  return { journal, queue };
}
export interface InventoryJournalStore {
  read(): Promise<{ version: number; journal: unknown }>;
  append(expectedVersion: number, journal: InventoryJournal): Promise<boolean>;
}
/** No callback or network IO inside replay/CAS. No automatic retry on uncertain save. */
export async function recordInventoryCommand(store: InventoryJournalStore, input: InventoryCommand) {
  const command = commandSchema.parse(input);
  const state = await store.read();
  int.parse(state.version);
  const { journal, queue } = replayInventoryJournal(state.journal);
  if (state.version !== journal.commands.length) throw new Error('Inventory journal version mismatch');
  if (journal.commands.length >= 10_000) throw new Error('Inventory journal needs reviewed compaction');
  const before = JSON.stringify(queue.list());
  const result = apply(queue, command);
  // A failed claim cannot authorize dispatch and does not need a stored event.
  if (before === JSON.stringify(queue.list())) return { saved: false as const, result: undefined };
  journal.commands.push(command);
  if (!await store.append(state.version, journal)) return { saved: false as const, result: undefined };
  return { saved: true as const, result };
}
