/** Single-host synthetic storage. Never use on ephemeral/serverless filesystems. */
import { open, readFile, rename, link, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withJournalLock } from '../channex-staging/journal.ts';
import { applyCleanerDelivery, createCleanerDelivery, type CleanerDelivery, type DeliveryEvent } from './cleaner-delivery.ts';

export type DeliveryRecord = { id: string; event: DeliveryEvent };
type Envelope = {
  format: 1; mode: 'cleaner-delivery-synthetic'; version: number;
  messageId: string; recipientIds: string[]; records: DeliveryRecord[];
};
export type StoredCleanerDelivery = { version: number; ledger: CleanerDelivery; records: readonly DeliveryRecord[] };
const MAX_RECORDS = 10000;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid delivery storage object');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => ![...required, ...optional].includes(k))) {
    throw Error('Unexpected delivery storage fields');
  }
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error('Invalid delivery identity');
  return value;
}
function record(value: unknown): DeliveryRecord {
  const row = object(value); exactKeys(row, ['id', 'event']);
  const raw = object(row.event);
  if (raw.type === 'start') {
    exactKeys(raw, ['type', 'recipientId', 'attemptId']);
    return { id: identity(row.id), event: { type: 'start', recipientId: identity(raw.recipientId), attemptId: identity(raw.attemptId) } };
  }
  if (raw.type !== 'result' || !['accepted', 'delivered', 'unknown', 'rejected'].includes(String(raw.state))) throw Error('Invalid delivery event');
  exactKeys(raw, ['type', 'recipientId', 'attemptId', 'state'], ['providerId']);
  return { id: identity(row.id), event: { type: 'result', recipientId: identity(raw.recipientId), attemptId: identity(raw.attemptId),
    state: raw.state as 'accepted' | 'delivered' | 'unknown' | 'rejected',
    ...(raw.providerId === undefined ? {} : { providerId: identity(raw.providerId) }) } };
}
function parse(value: unknown): { envelope: Envelope; state: StoredCleanerDelivery } {
  const raw = object(value); exactKeys(raw, ['format', 'mode', 'version', 'messageId', 'recipientIds', 'records']);
  if (raw.format !== 1 || raw.mode !== 'cleaner-delivery-synthetic' || !Array.isArray(raw.recipientIds)
      || !Array.isArray(raw.records) || raw.records.length > MAX_RECORDS || raw.version !== raw.records.length) {
    throw Error('Invalid delivery storage envelope');
  }
  const messageId = identity(raw.messageId);
  const recipientIds = raw.recipientIds.map(identity);
  let ledger = createCleanerDelivery(messageId, recipientIds);
  const records = raw.records.map(record);
  if (new Set(records.map(r => r.id)).size !== records.length) throw Error('Duplicate stored event identity');
  for (const item of records) ledger = applyCleanerDelivery(ledger, item.event);
  const envelope: Envelope = { format: 1, mode: 'cleaner-delivery-synthetic', version: records.length, messageId, recipientIds, records };
  return { envelope, state: { version: records.length, ledger, records } };
}
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
