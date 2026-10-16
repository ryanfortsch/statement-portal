/** Durable, fixed-fixture receipt inbox. No public endpoint or real SMS sender. */
import { createClient } from '@supabase/supabase-js';
import { parse, type Envelope } from './cleaner-delivery-history.ts';
import { validateCleanerReceipt, verifyCleanerDeliveryReceipt, planCleanerReceipt,
  type VerifiedCleanerReceipt, type CleanerReceiptInput } from './cleaner-delivery-receipts.ts';
import type { CleanerDeliveryStorage } from './cleaner-delivery-worker.ts';
export type PendingCleanerReceipt = { sequence: number; receipt: VerifiedCleanerReceipt };

export function createCleanerReceiptInboxDb(url: string, key: string, fetcher: typeof fetch = fetch) {
  if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key.trim()) {
    throw Error('Explicit isolated staging storage required');
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  return {
    async enqueue(value: VerifiedCleanerReceipt) {
      const receipt = validateCleanerReceipt(value);
      const { data, error } = await db.rpc('helm_pilot_cleaner_receipt_enqueue', { incoming_receipt: receipt });
      if (error || !['stored', 'duplicate'].includes(data)) throw Error('Receipt save uncertain; do not acknowledge');
      return data as 'stored' | 'duplicate';
    },
    async pending(afterSequence = 0, limit = 100): Promise<PendingCleanerReceipt[]> {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('Invalid receipt page');
      const { data, error } = await db.rpc('helm_pilot_cleaner_receipt_pending', { after_sequence: afterSequence, batch_limit: limit });
      if (error || !Array.isArray(data) || data.length > limit) throw Error('Receipt inbox unavailable');
      let previous = afterSequence;
      return data.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)
            || Object.keys(value).sort().join(',') !== 'receipt,sequence'
            || !Number.isSafeInteger(value.sequence) || value.sequence <= previous) throw Error('Invalid receipt inbox page');
        previous = value.sequence;
        return { sequence: value.sequence, receipt: validateCleanerReceipt(value.receipt) };
      });
    },
    async apply(receiptId: string, expectedVersion: number, nextHistory: Envelope) {
      const verified = parse(nextHistory).envelope;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw Error('Invalid receipt version');
      const { data, error } = await db.rpc('helm_pilot_cleaner_receipt_apply', {
        receipt_id: receiptId, expected_version: expectedVersion, next_history: verified,
      });
      if (error || !['applied', 'duplicate', 'stale'].includes(data)) throw Error('Receipt application uncertain; reload inbox and ledger');
      return data as 'applied' | 'duplicate' | 'stale';
    },
  };
}
export type CleanerReceiptInbox = ReturnType<typeof createCleanerReceiptInboxDb>;

/** Acknowledgement is possible only after the authenticated normalized receipt is durably stored. */
export async function ingestCleanerDeliveryReceipt(input: CleanerReceiptInput & { inbox: CleanerReceiptInbox }) {
  const receipt = verifyCleanerDeliveryReceipt(input);
  const status = await input.inbox.enqueue(receipt);
  return { status, canAcknowledge: true as const, canSend: false as const };
}

/** Scan one bounded keyset page. Resume its cursor until zero, then start a new sweep. */
export async function drainCleanerReceiptInbox(input: {
  inbox: CleanerReceiptInbox; delivery: CleanerDeliveryStorage; afterSequence?: number; limit?: number;
}) {
  const limit = input.limit ?? 100;
  const rows = await input.inbox.pending(input.afterSequence ?? 0, limit);
  const counts = { applied: 0, duplicate: 0, unmatched: 0, stale: 0 };
  for (const row of rows) {
    const current = await input.delivery.read();
    const item = planCleanerReceipt(current, row.receipt);
    if (!item) { counts.unmatched++; continue; }
    const existing = current.records.find(r => r.id === item.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) throw Error('Conflicting receipt history');
    const records = existing ? [...current.records] : [...current.records, item];
    const next = parse({ format: 1, mode: 'cleaner-delivery-synthetic', messageId: current.ledger.messageId,
      recipientIds: current.ledger.recipients.map(r => r.recipientId), records, version: records.length });
    const status = await input.inbox.apply(row.receipt.id, current.version, next.envelope);
    counts[status]++;
  }
  return { ...counts, scanned: rows.length, nextCursor: rows.length === limit ? rows[rows.length - 1].sequence : 0,
    canSend: false as const };
}
