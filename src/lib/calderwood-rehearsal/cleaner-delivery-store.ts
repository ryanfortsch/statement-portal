/** Single-host synthetic storage. Never use on ephemeral/serverless filesystems. */
import { open, readFile, rename, link, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withJournalLock } from '../channex-staging/journal.ts';
import { parse, record, type Envelope, type DeliveryRecord, type StoredCleanerDelivery } from './cleaner-delivery-history.ts';
export type { DeliveryRecord, StoredCleanerDelivery } from './cleaner-delivery-history.ts';
async function load(path: string) {
  // Corrupt or missing data is an error, never an empty, retryable ledger.
  return parse(JSON.parse(await readFile(path, 'utf8')));
}
async function save(path: string, envelope: Envelope, initialize: boolean) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(envelope) + '\n'); await file.sync(); }
    finally { await file.close(); }
    // link is an atomic create-without-overwrite for the initial snapshot.
    if (initialize) await link(temporary, path);
    else await rename(temporary, path);
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function initializeCleanerDelivery(path: string, messageId: string, recipientIds: readonly string[]): Promise<StoredCleanerDelivery> {
  const { envelope, state } = parse({ format: 1, mode: 'cleaner-delivery-synthetic', version: 0, messageId, recipientIds, records: [] });
  await withJournalLock(path, () => save(path, envelope, true));
  return state;
}
export async function readCleanerDelivery(path: string): Promise<StoredCleanerDelivery> {
  return (await load(path)).state;
}
/** Serialize and compare versions before appending. A stored start is not permission to send. */
export async function appendCleanerDelivery(path: string, expectedVersion: number, incoming: DeliveryRecord): Promise<StoredCleanerDelivery> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw Error('Invalid delivery version');
  const item = record(incoming);
  return withJournalLock(path, async () => {
    const current = await load(path);
    if (current.state.version !== expectedVersion) throw Error('Delivery version changed; reload and reconcile');
    const duplicate = current.envelope.records.find(r => r.id === item.id);
    if (duplicate) {
      if (JSON.stringify(duplicate) !== JSON.stringify(item)) throw Error('Conflicting delivery event identity');
      return current.state;
    }
    const next = parse({ ...current.envelope, records: [...current.envelope.records, item], version: expectedVersion + 1 });
    await save(path, next.envelope, false);
    return next.state;
  });
}
