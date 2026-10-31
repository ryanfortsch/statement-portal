/** Candidate hosted adapter. No initialization, environment fallback, scheduler,
 * automatic retry or provider IO. Requires owner-installed candidate SQL.
 */
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { parseBookingInventoryState, bookingInventorySnapshot } from './booking-inventory-consumer.ts';
import { projectInventory } from './inventory-projection.ts';
import { bindInventoryRoute } from './inventory-route.ts';
import { replayInventoryJournal } from './inventory-journal.ts';
import { inventoryDigest } from './inventory-outbox.ts';
import { availabilityRequestSchema, availabilityReceiptSchema, validateAvailabilityRequest, validateAvailabilityReceipt } from './availability-request.ts';
import type { RetrySnapshot, RetryRecord, ReviewedRetryStore } from './inventory-reviewed-retry.ts';
const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1);
const recordSchema = z.object({ id, originalId: id, originalToken: id, originalJournalVersion: stamp,
  review: z.object({ originalId: id, originalToken: id, requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    reviewedBy: z.string().email(), reason: z.string().trim().min(1).max(500), reviewedAt: stamp, expiresAt: stamp }).strict(),
  originalSettled: z.literal(false), outcome: z.enum(['submitting','uncertain','submitted','rejected','verified']),
  job: z.object({ id, environment: z.literal('staging'), connection: id, property: id, generation: stamp.min(1), version: stamp.min(1),
    days: z.array(z.object({ date: id, available: z.union([z.literal(0),z.literal(1)]), stopSell: z.boolean() }).strict()).length(1),
    digest: id, status: z.enum(['submitting','uncertain','submitted','needs-review','verified']), attempts: z.literal(1),
    nextAttemptAt: stamp, token: id, leaseUntil: stamp, request: availabilityRequestSchema, dispatchedAt: stamp,
    task: z.string().uuid().optional(), receipt: availabilityReceiptSchema.optional() }).strict(),
}).strict();
function parseRecord(raw: unknown): RetryRecord {
  const r = recordSchema.parse(raw), j = r.job;
  if (r.id !== j.id || j.token !== r.id + ':1' || r.originalId !== r.review.originalId ||
      r.originalToken !== r.review.originalToken || j.digest !== inventoryDigest(j.days) ||
      j.status !== (r.outcome === 'rejected' ? 'needs-review' : r.outcome) || r.review.requestDigest !== j.request.digest) {
    throw Error('Invalid saved recovery identity');
  }
  validateAvailabilityRequest(j.request, j, j.dispatchedAt);
  if (r.outcome === 'submitted' || r.outcome === 'verified') validateAvailabilityReceipt(j.receipt, j.task!, j);
  else if (j.task || j.receipt) throw Error('Unexpected saved recovery receipt');
  return r;
}
export function createReviewedRetryStore(url: string, key: string, property: string, originalId: string,
  fetcher: typeof fetch = fetch, clock = Date.now): ReviewedRetryStore {
  if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key.trim() ||
      !/^HELMTEST-[a-z0-9-]{1,100}$/.test(property) || !originalId.trim()) throw Error('Explicit isolated recovery storage required');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  // Only a snapshot from THIS adapter can be used in a reservation. Never trust
  // caller-supplied projection flags or silently fetch a newer expectation.
  const snapshots = new WeakMap<RetrySnapshot, { raw: unknown; frozen: string }>();
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(name, { p_property: property, ...args });
    if (error || data === null) throw Error('Recovery storage outcome unknown; reread, never resend');
    return data;
  };
  const expected = (s: RetrySnapshot) => {
    const e = snapshots.get(s);
    if (!e || e.frozen !== JSON.stringify(s)) throw Error('Recovery snapshot was not read here or changed');
    return e.raw;
  };
  return {
    async read() {
      const raw = await rpc('helm_inventory_retry_read', {});
      const envelope = z.object({ state: z.unknown(), route: z.unknown(), revision: stamp,
        records: z.array(z.unknown()).max(1000) }).strict().parse(raw);
      const s = parseBookingInventoryState(envelope.state, property), route = bindInventoryRoute(envelope.route, s);
      const original = replayInventoryJournal(s.journal).queue.list().find(j => j.id === originalId);
      if (!original?.request || original.dispatchedAt === undefined) throw Error('Exact original request required');
      validateAvailabilityRequest(original.request, original, original.dispatchedAt);
      const values = JSON.parse(original.request.body).values;
      if (values.length !== 1) throw Error('Single-date recovery only');
      const date: string = values[0].date, end = new Date(Date.parse(date) + 86400000).toISOString().slice(0,10);
      // Inputs are fetched for the persisted consumer window, including buffer
      // neighbours. A requested date outside it cannot be projected from that read.
      if (date < s.configuration.start || date >= s.configuration.end) throw Error('Recovery date outside captured window');
      const now = clock(), snapshot = bookingInventorySnapshot({ ...s,
        inputs: { ...s.inputs, rateDays: s.inputs.rateDays.filter(d => d.date === date) },
        configuration: { ...s.configuration, start: date, end } }, now);
      const projection = snapshot && projectInventory(snapshot, route.roomTypeId, date, end, now);
      const records = envelope.records.map(parseRecord);
      if (new Set(records.map(r => r.id)).size !== records.length || records.some(r => r.job.property !== property)) {
        throw Error('Recovery ledger identity mismatch');
      }
      const result: RetrySnapshot = { revision: envelope.revision, journal: s.journal, records,
        current: { authority: s.inputs.authority, complete: !!projection?.complete, freshUntil: projection?.freshUntil ?? 0,
          workerPaused: !s.configuration.publishEnabled, generation: route.generation, connection: route.connection,
          property, propertyId: route.propertyId, roomTypeId: route.roomTypeId, date,
          available: projection?.days[0]?.available ?? 0 } };
      snapshots.set(result, { raw: structuredClone(raw), frozen: JSON.stringify(result) });
      return result;
    },
    async reserve(s, record, now) {
      stamp.parse(now); const raw = expected(s), r = parseRecord(record);
      if (r.originalId !== originalId || r.outcome !== 'submitting' || r.job.property !== property ||
          !s.current.workerPaused || !s.current.complete || now >= s.current.freshUntil ||
          r.job.leaseUntil! > s.current.freshUntil || r.job.days[0].available !== s.current.available ||
          r.job.days[0].date !== s.current.date) throw Error('Recovery reservation changed reviewed projection');
      const value = await rpc('helm_inventory_retry_reserve', { expected: raw, next_record: r });
      if (typeof value !== 'boolean') throw Error('Unknown recovery reservation; do not send');
      return value;
    },
    async update(s, record) {
      expected(s); const r = parseRecord(record), prior = s.records.find(a => a.id === r.id);
      if (!prior || r.job.property !== property || r.originalId !== originalId) throw Error('Saved recovery attempt required');
      const value = await rpc('helm_inventory_retry_update', { expected_revision: s.revision, prior_record: prior, next_record: r });
      if (typeof value !== 'boolean') throw Error('Unknown recovery update; do not resend');
      return value;
    },
  };
}
