import { z } from 'zod';
import { availabilityRequestSchema, availabilityReceiptSchema } from './availability-request.ts';
import { MemoryInventoryOutbox } from './inventory-outbox.ts';

export const INVENTORY_JOURNAL_LIMIT = 10_000;
// Reserve settlement space before beginning more work on the single pilot lane.
export const INVENTORY_JOURNAL_START_LIMIT = 9_990;
export class InventoryHistoryCapacityError extends Error {
  constructor() { super('Inventory history requires archival before new work'); }
}
export function inventoryJournalCapacity(commands: number) {
  if (!Number.isSafeInteger(commands) || commands < 0 || commands > INVENTORY_JOURNAL_LIMIT) throw Error('Invalid history size');
  return { commands, remaining: INVENTORY_JOURNAL_LIMIT - commands,
    status: commands >= INVENTORY_JOURNAL_START_LIMIT ? 'needs-archive' as const
      : commands >= 8_000 ? 'warning' as const : 'healthy' as const };
}
export function assertInventoryCommandCapacity(commands: number, kind: InventoryCommand['kind']) {
  inventoryJournalCapacity(commands);
  if (commands >= INVENTORY_JOURNAL_LIMIT || (commands >= INVENTORY_JOURNAL_START_LIMIT &&
      ['enqueue', 'retire-pending', 'claim', 'dispatch'].includes(kind))) throw new InventoryHistoryCapacityError();
}

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
  z.object({ kind: z.literal('retire-not-received'), id, token: id,
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    supportMessage: z.string().regex(/^[a-f0-9]{16}$/),
    retryId: id, retryTask: z.string().uuid(), reviewedBy: z.string().email(),
    reason: z.literal('provider-asserted-non-receipt'), now: int }).strict(),
  z.object({ kind: z.literal('enqueue'), intent, now: int }).strict(),
  z.object({ kind: z.literal('retire-pending'), connection: id, property: id, generation: positive }).strict(),
  z.object({ kind: z.literal('claim'), id, now: int, leaseMs: positive }).strict(),
  z.object({ kind: z.literal('dispatch'), id, token: id, context, now: int, request: availabilityRequestSchema.optional() }).strict(),
  z.object({ kind: z.literal('accepted'), id, token: id, task: id, receipt: availabilityReceiptSchema.optional() }).strict(),
  z.object({ kind: z.literal('ambiguous'), id, token: id }).strict(),
  z.object({ kind: z.literal('rejected'), id, token: id, failure: z.enum(['retryable', 'permanent']),
    now: int, retryAfterMs: int, jitter: z.number().min(0).max(1) }).strict(),
  z.object({ kind: z.literal('expire'), now: int }).strict(),
  z.object({ kind: z.literal('reconcile'), id, token: id, evidence: z.object({ settled: z.boolean(),
    complete: z.boolean(), digest: id, generation: positive, task: id.optional(), requestDigest: id.optional(),
    completion: z.object({ receivedAt: int, executedAt: int, finishedAt: int, observedAt: int }).strict().optional(),
  }).strict() }).strict(),
]);
const commands = z.array(commandSchema).max(INVENTORY_JOURNAL_LIMIT);
const retired = z.object({ property: id, connection: id, generation: positive, version: int }).strict();
const journalSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal(1), commands }).strict(),
  z.object({ format: z.literal(2), baseVersion: positive, archiveId: z.string().regex(/^[a-f0-9]{64}$/),
    retired, resumeAfter: int, commands }).strict(),
]);
export type InventoryCommand = z.infer<typeof commandSchema>;
export type InventoryJournal = z.infer<typeof journalSchema>;
export function inventoryJournalVersion(journal: InventoryJournal): number {
  return int.parse((journal.format === 2 ? journal.baseVersion : 0) + journal.commands.length);
}
export function inventoryResumeAfter(journal: InventoryJournal): number {
  return int.parse(Math.max(journal.format === 2 ? journal.resumeAfter : 0, ...journal.commands.map(cmd =>
    cmd.kind === 'dispatch' ? cmd.now + 6000 : cmd.kind === 'rejected' && cmd.failure === 'retryable'
      ? cmd.now + Math.max(60_000, cmd.retryAfterMs) : 0)));
}
export function assertInventoryEnqueue(journal: InventoryJournal, input: z.infer<typeof intent>) {
  if (journal.format === 2 && (input.property !== journal.retired.property || input.connection !== journal.retired.connection ||
      input.generation !== journal.retired.generation || input.version <= journal.retired.version)) {
    throw Error('Archived inventory version cannot be reused');
  }
}
export const emptyInventoryJournal = (): InventoryJournal => ({ format: 1, commands: [] });
function apply(queue: MemoryInventoryOutbox, command: InventoryCommand) {
  switch (command.kind) {
    case 'retire-not-received': return queue.retireNotReceived(command.id, command.token, command.requestDigest);
    case 'enqueue': return queue.enqueue(command.intent, command.now);
    case 'retire-pending': return queue.retirePending(command.connection, command.property, command.generation);
    case 'claim': return queue.claim(command.id, command.now, command.leaseMs);
    case 'dispatch': return queue.beginDispatch(command.id, command.token, command.context, command.now, command.request);
    case 'accepted': return queue.accepted(command.id, command.token, command.task, command.receipt);
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
  inventoryJournalVersion(journal);
  for (const command of journal.commands) {
    if (command.kind === 'enqueue') assertInventoryEnqueue(journal, command.intent);
    if (command.kind === 'dispatch' && journal.format === 2 && command.now < journal.resumeAfter) {
      throw Error('Archived inventory pacing is still active');
    }
    apply(queue, command);
  }
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
  if (state.version !== inventoryJournalVersion(journal)) throw new Error('Inventory journal version mismatch');
  const before = JSON.stringify(queue.list());
  if (command.kind === 'enqueue') assertInventoryEnqueue(journal, command.intent);
  if (command.kind === 'dispatch' && journal.format === 2 && command.now < journal.resumeAfter) {
    throw Error('Archived inventory pacing is still active');
  }
  const result = apply(queue, command);
  // A failed claim cannot authorize dispatch and does not need a stored event.
  if (before === JSON.stringify(queue.list())) return { saved: false as const, result: undefined };
  assertInventoryCommandCapacity(journal.commands.length, command.kind);
  journal.commands.push(command);
  if (!await store.append(state.version, journal)) return { saved: false as const, result: undefined };
  return { saved: true as const, result };
}

/** Read-only attempt history. A receipt records acceptance, never completion.
 * Legacy history stays visibly unbound; missing requests are never reconstructed.
 */
export function inventoryAttemptAudit(value: unknown) {
  const { journal, queue } = replayInventoryJournal(value);
  const jobs = new Map(queue.list().map(job => [job.id, job]));
  return journal.commands.flatMap((command, index) => {
    if (command.kind !== 'dispatch') return [];
    const job = jobs.get(command.id)!;
    const following = journal.commands.slice(index + 1).filter(next => 'token' in next && next.id === command.id && next.token === command.token);
    const accepted = following.find(next => next.kind === 'accepted');
    const outcome = following.find(next => ['accepted', 'ambiguous', 'rejected'].includes(next.kind));
    return [{ id: command.id, token: command.token, property: job.property, connection: job.connection,
      generation: job.generation, version: job.version, desiredDigest: job.digest, dispatchedAt: command.now,
      request: command.request ?? null,
      disposition: following.find(next => next.kind === 'retire-not-received') ?? null,
      receipt: accepted?.kind === 'accepted' ? { task: accepted.task, binding: accepted.receipt ?? null } : null,
      outcome: outcome?.kind ?? 'unresolved', canVerify: false as const }];
  });
}
