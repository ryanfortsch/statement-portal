/** Shared validated event history for synthetic local and database stores. */
import { applyCleanerDelivery, createCleanerDelivery, type CleanerDelivery, type DeliveryEvent } from './cleaner-delivery.ts';

export type DeliveryRecord = { id: string; event: DeliveryEvent };
export type Envelope = {
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
export function record(value: unknown): DeliveryRecord {
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
export function parse(value: unknown): { envelope: Envelope; state: StoredCleanerDelivery } {
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
