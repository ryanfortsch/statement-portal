/** Calderwood synthetic staging -> canonical stays. No guest or financial payloads. */
import { z } from 'zod';
import { nights, record, revisionTime } from './core.ts';
import { CALDERWOOD_STAGING } from '../calderwood-readonly/channex.ts';

export const CANONICAL_PILOT_PROPERTY = 'HELMTEST-calderwood';
const uuid = z.string().uuid();
const revisionSchema = z.object({
  id: uuid, bookingId: uuid,
  propertyId: z.literal(CALDERWOOD_STAGING.propertyId),
  roomTypeId: z.literal(CALDERWOOD_STAGING.roomTypeId),
  ratePlanId: z.literal(CALDERWOOD_STAGING.ratePlanId),
  code: z.string().regex(/^HELMTEST-[A-Za-z0-9_-]{1,100}$/),
  status: z.enum(['new', 'modified', 'cancelled']),
  checkIn: z.string(), checkOut: z.string(), receivedAt: z.string(),
}).strict();
export type CanonicalRevision = z.infer<typeof revisionSchema>;
export function parseCanonicalRevision(raw: unknown): CanonicalRevision {
  const r = revisionSchema.parse(raw);
  nights(r.checkIn, r.checkOut);
  return { ...r, receivedAt: revisionTime(r.receivedAt) };
}
/** Read only allowlisted fields. Never retain customer, guarantee, notes or money. */
export function normalizeCanonicalRevision(raw: unknown): CanonicalRevision {
  const row = record(raw), a = record(row.attributes);
  if (a.ota_name !== 'Offline' || !Array.isArray(a.rooms) || a.rooms.length !== 1) {
    throw Error('Only a single synthetic offline staging room may be imported');
  }
  const room = record(a.rooms[0]);
  if ((room.checkin_date && room.checkin_date !== a.arrival_date) ||
      (room.checkout_date && room.checkout_date !== a.departure_date)) throw Error('Room dates disagree');
  return parseCanonicalRevision({
    id: row.id, bookingId: a.booking_id, propertyId: a.property_id,
    roomTypeId: room.room_type_id, ratePlanId: room.rate_plan_id,
    code: a.ota_reservation_code, status: a.status,
    checkIn: a.arrival_date, checkOut: a.departure_date, receivedAt: a.inserted_at,
  });
}
export const canonicalReceiptSchema = z.object({
  revision: revisionSchema, canonicalBookingId: uuid,
  outcome: z.enum(['applied', 'stale']), committed: z.literal(true),
}).strict();
export type CanonicalReceipt = z.infer<typeof canonicalReceiptSchema>;
export interface CanonicalRevisionStore {
  commit(revision: CanonicalRevision): Promise<unknown>;
  receipt(id: string): Promise<unknown>;
}
export interface CanonicalRevisionClient {
  inspect(): Promise<void>;
  feed(): Promise<CanonicalRevision[]>;
  revision(id: string): Promise<CanonicalRevision>;
  acknowledge(revision: CanonicalRevision): Promise<void>;
}
export function exactCanonicalReceipt(raw: unknown, revision: CanonicalRevision): CanonicalReceipt {
  const receipt = canonicalReceiptSchema.parse(raw);
  const saved = parseCanonicalRevision(receipt.revision);
  if (JSON.stringify(saved) !== JSON.stringify(revision)) throw Error('Exact durable revision receipt required before ACK');
  return { ...receipt, revision: saved };
}
/** Both webhook pulls and backup feed use the same durable path.
 * No response lost after commit can cause a second booking on retry.
 * Return aggregate counts only; this does not attest to full initial coverage.
 */
export async function ingestCanonicalRevisions(client: CanonicalRevisionClient, store: CanonicalRevisionStore,
  revisionId?: string, expectedBookingId?: string) {
  if (revisionId !== undefined) uuid.parse(revisionId);
  if (expectedBookingId !== undefined) { uuid.parse(expectedBookingId); if (!revisionId) throw Error('Revision ID required'); }
  await client.inspect();
  const rows = (revisionId ? [await client.revision(revisionId)] : await client.feed()).map(parseCanonicalRevision);
  if (rows.length > 100 || new Set(rows.map(r => r.id)).size !== rows.length) throw Error('Invalid revision batch');
  if (expectedBookingId && rows.some(r => r.bookingId !== expectedBookingId)) throw Error('Webhook booking identity mismatch');
  rows.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
  const result = { received: rows.length, applied: 0, stale: 0, acknowledged: 0, completeCoverage: false as const, canSend: false as const };
  for (const revision of rows) {
    const committed = exactCanonicalReceipt(await store.commit(revision), revision);
    // Independent read proves retention, even if an adapter returned an optimistic result.
    const durable = exactCanonicalReceipt(await store.receipt(revision.id), revision);
    if (durable.canonicalBookingId !== committed.canonicalBookingId || durable.outcome !== committed.outcome) {
      throw Error('Durable booking receipt changed');
    }
    await client.acknowledge(revision);
    result[durable.outcome]++; result.acknowledged++;
  }
  return result;
}
