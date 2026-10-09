/** Local synthetic storage only. Not a shared/serverless or production database. */
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withJournalLock } from '../channex-staging/journal.ts';
import { appendEvents, type Event } from './coordination.ts';
export type StoredHistory = { format: 1; mode: 'calderwood-synthetic'; version: number; events: Event[] };
function parse(value: unknown): StoredHistory {
  const row = value as StoredHistory;
  if (!row || row.format !== 1 || row.mode !== 'calderwood-synthetic'
    || !Number.isSafeInteger(row.version) || row.version < 0 || !Array.isArray(row.events)
    || row.events.length > 10000) throw Error('Invalid Calderwood rehearsal storage');
  const events = appendEvents([], row.events);
  if (events.length !== row.events.length || row.version > events.length
    || (row.version === 0) !== (events.length === 0)) throw Error('Inconsistent rehearsal history');
  return { format: 1, mode: 'calderwood-synthetic', version: row.version, events };
}
async function syncDirectory(path: string) {
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
/** Missing/corrupt data is an error, never an empty calendar. Freshness is not cached. */
export async function readRehearsal(path: string): Promise<StoredHistory> {
  return parse(JSON.parse(await readFile(path, 'utf8')));
}
export async function initializeRehearsal(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await withJournalLock(path, async () => {
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify({ format: 1, mode: 'calderwood-synthetic', version: 0, events: [] }) + '\n');
      await file.sync();
    } finally { await file.close(); }
    await syncDirectory(path);
  });
}
/** Compare-and-append while locked; cancellation never replaces prior history. */
export async function appendRehearsal(path: string, expectedVersion: number, incoming: readonly Event[]): Promise<StoredHistory> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw Error('Invalid expected version');
  return withJournalLock(path, async () => {
    const current = await readRehearsal(path);
    if (current.version !== expectedVersion) throw Error('Rehearsal version changed; reload before retry');
    const events = appendEvents(current.events, incoming);
    if (events.length === current.events.length) return current;
    const next = parse({ ...current, version: current.version + 1, events });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(next) + '\n'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, path);
      await syncDirectory(path);
    } finally {
      // Remove only this operation's temporary file, never a lock or existing journal.
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
    return next;
  });
}
