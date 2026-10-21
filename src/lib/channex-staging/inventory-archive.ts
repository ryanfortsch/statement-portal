/** Explicit, paused maintenance only. No provider IO, environment keys or scheduler. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseBookingInventoryState, type BookingInventoryExpectation } from './booking-inventory-consumer.ts';
import { inventoryJournalVersion, inventoryResumeAfter, replayInventoryJournal, type InventoryJournal } from './inventory-journal.ts';

export type InventoryArchive = { id: string; text: string; next: InventoryJournal };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const property = 'HELMTEST-calderwood';
/** Capture the exact original journal. Superseded work and never-dispatched
 * pending work can retire; retries and every unresolved attempt must settle.
 * The service adapter is the trusted queue interpreter, as for window rollover.
 */
export function prepareInventoryArchive(raw: unknown): InventoryArchive {
  const s = parseBookingInventoryState(raw, property), c = s.configuration;
  if (c.publishEnabled || c.connection !== 'calderwood-hosted-inventory' || c.generation !== 1 ||
      c.listing !== 'f795ae2c-f47d-4751-86ff-e883b6d30800') throw Error('Archive requires the paused pilot route');
  return makeArchive(s.journal, { property, connection: c.connection, generation: c.generation, version: s.planVersion });
}
function makeArchive(value: unknown, retired: { property: string; connection: string; generation: number; version: number }): InventoryArchive {
  if (!retired || retired.property !== property || retired.connection !== 'calderwood-hosted-inventory' || retired.generation !== 1 ||
      !Number.isSafeInteger(retired.version) || retired.version < 0) throw Error('Invalid archive retirement');
  const { journal, queue } = replayInventoryJournal(value), jobs = queue.list();
  if (!journal.commands.length || !jobs.length) throw Error('No inventory history to archive');
  if (jobs.some(j => j.property !== property || j.connection !== retired.connection || j.generation !== retired.generation ||
      j.version > retired.version || !(['verified', 'superseded'].includes(j.status) || (j.status === 'pending' && j.attempts === 0)))) {
    throw Error('Outstanding inventory must settle before archival');
  }
  // Missing legacy binding evidence cannot be promoted into a verified archive.
  for (const cmd of journal.commands) {
    if (cmd.kind === 'dispatch' && !cmd.request) throw Error('Unbound inventory attempt requires review');
    if (cmd.kind === 'accepted' && !cmd.receipt) throw Error('Unbound inventory receipt requires review');
  }
  const resumeAfter = inventoryResumeAfter(journal), toVersion = inventoryJournalVersion(journal);
  if (toVersion === Number.MAX_SAFE_INTEGER) throw Error('Inventory history version exhausted');
  const text = JSON.stringify({ format: 1, property, fromVersion: journal.format === 2 ? journal.baseVersion : 0,
    toVersion, journal, retired, resumeAfter });
  const id = hash(text);
  const next: InventoryJournal = { format: 2, baseVersion: toVersion + 1, archiveId: id, retired, resumeAfter, commands: [] };
  return { id, text, next };
}

/** A hash alone proves byte integrity, not that a saved journal was safe to retire.
 * Re-run the same interpreter and require an exact checkpoint. Each predecessor
 * is fetched independently by its hash when auditing the complete archive chain.
 */
export function verifyInventoryArchive(value: InventoryArchive) {
  if (hash(value.text) !== value.id) throw Error('Inventory archive fingerprint mismatch');
  const parsed: unknown = JSON.parse(value.text);
  if (!parsed || typeof parsed !== 'object') throw Error('Invalid archive');
  const a = parsed as { journal: unknown; retired: { property: string; connection: string; generation: number; version: number } };
  const expected = makeArchive(a.journal, a.retired);
  // Exact canonical bytes cover every metadata field and reject injected extras.
  if (!isDeepStrictEqual(expected, value)) throw Error('Inventory archive checkpoint mismatch');
  const { journal, queue } = replayInventoryJournal(a.journal);
  return { journal, jobs: queue.list(), previous: journal.format === 2 ? journal.archiveId : null };
}

export interface InventoryArchiveStore {
  read(): Promise<unknown>;
  commitArchive(expected: BookingInventoryExpectation, archive: InventoryArchive): Promise<boolean>;
  readArchive(id: string): Promise<InventoryArchive | null>;
}
export async function archiveBookingInventory(store: InventoryArchiveStore) {
  const s = parseBookingInventoryState(await store.read(), property), archive = prepareInventoryArchive(s);
  verifyInventoryArchive(archive);
  const saved = await store.commitArchive({ captureVersion: s.captureVersion, configurationVersion: s.configurationVersion,
    planVersion: s.planVersion, journalVersion: s.journalVersion, inputs: s.inputs }, archive);
  if (!saved) return { status: 'changed' as const };
  // A successful mutation is not an independently verified archive until read-back.
  const stored = await store.readArchive(archive.id);
  if (!stored || !isDeepStrictEqual(stored, archive)) throw Error('Archive read-back uncertain; reread without retrying');
  verifyInventoryArchive(stored);
  return { status: 'archived' as const, id: archive.id, retiredCommands: replayInventoryJournal(s.journal).journal.commands.length,
    journalVersion: inventoryJournalVersion(archive.next) };
}
