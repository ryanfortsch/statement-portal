/** Complete synthetic source reconciliation. No import, ACK, inventory or message writes. */
import { z } from 'zod';
import { CALDERWOOD_STAGING as mapping } from '../calderwood-readonly/channex.ts';
import { nights, record } from './core.ts';
import { CANONICAL_PILOT_PROPERTY } from './canonical-revisions.ts';
export const CANONICAL_BOOKING_SOURCE = 'channex-staging-bookings';
export const SOURCE_PROOF_MAX_MS = 60000;
export const SOURCE_COVERAGE_TTL_MS = 900000;
const int = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bookingSchema = z.object({
  bookingId: z.string().uuid(), revisionId: z.string().uuid(),
  propertyId: z.literal(mapping.propertyId), roomTypeId: z.literal(mapping.roomTypeId), ratePlanId: z.literal(mapping.ratePlanId),
  code: z.string().regex(/^HELMTEST-[A-Za-z0-9_-]{1,100}$/), status: z.enum(['new', 'modified', 'cancelled']),
  checkIn: z.string(), checkOut: z.string(),
}).strict();
export type SourceBooking = z.infer<typeof bookingSchema>;
export function parseSourceBooking(raw: unknown) {
  const b = bookingSchema.parse(raw); nights(b.checkIn, b.checkOut); return b;
}
export function normalizeSourceBooking(raw: unknown): SourceBooking {
  const row = record(raw), a = record(row.attributes);
  if (row.type !== 'booking' || row.id !== a.id || a.ota_name !== 'Offline' || !Array.isArray(a.rooms) || a.rooms.length !== 1) {
    throw Error('Exact synthetic booking identity required');
  }
  const room = record(a.rooms[0]);
  if (room.checkin_date !== a.arrival_date || room.checkout_date !== a.departure_date) throw Error('Booking room dates disagree');
  return parseSourceBooking({ bookingId: row.id, revisionId: a.revision_id, propertyId: a.property_id,
    roomTypeId: room.room_type_id, ratePlanId: room.rate_plan_id, code: a.ota_reservation_code,
    status: a.status, checkIn: a.arrival_date, checkOut: a.departure_date });
}
export function parseSourceBookings(raw: unknown): SourceBooking[] {
  const rows = z.array(z.unknown()).max(100).parse(raw).map(parseSourceBooking);
  for (const key of ['bookingId', 'revisionId', 'code'] as const) {
    if (new Set(rows.map(r => r[key])).size !== rows.length) throw Error('Duplicate source identity');
  }
  return rows.sort((a, b) => a.bookingId.localeCompare(b.bookingId));
}
const snapshotSchema = z.object({
  property: z.literal(CANONICAL_PILOT_PROPERTY), captureEnabled: z.boolean(), importEnabled: z.boolean(), authority: z.string(),
  captureVersion: int, configurationVersion: int.min(1), connection: z.literal('calderwood-hosted-inventory'),
  listing: z.literal(mapping.roomTypeId), generation: z.literal(1), requiredSources: z.array(z.string()).min(1).max(20),
  bindings: z.array(z.object({ booking: bookingSchema, valid: z.boolean() }).strict()).max(100), unmappedRemoteRows: int,
}).strict();
export type CanonicalSourceSnapshot = z.infer<typeof snapshotSchema>;
export function parseCanonicalSourceSnapshot(raw: unknown): CanonicalSourceSnapshot {
  const s = snapshotSchema.parse(raw);
  const bookings = parseSourceBookings(s.bindings.map(b => b.booking));
  return { ...s, bindings: bookings.map(booking => ({ booking, valid: s.bindings.find(b => b.booking.bookingId === booking.bookingId)!.valid })) };
}
export interface CanonicalSourceClient {
  inspect(): Promise<void>;
  bookings(): Promise<SourceBooking[]>;
  pending(): Promise<boolean>;
}
export interface CanonicalSourceStore {
  read(): Promise<unknown>;
  certify(expected: CanonicalSourceSnapshot, bookings: SourceBooking[], observedAt: number, start: string, end: string): Promise<boolean>;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** All-time list (including cancellations), twice, around a durable canonical read.
 * This is a bounded observation, not a distributed transaction with Channex.
 */
export async function verifyCanonicalSource(client: CanonicalSourceClient, store: CanonicalSourceStore, now = Date.now) {
  const observedAt = int.parse(now());
  await client.inspect();
  const first = parseSourceBookings(await client.bookings());
  if (await client.pending()) return { status: 'pending-revisions' as const, complete: false as const };
  const snapshot = parseCanonicalSourceSnapshot(await store.read());
  const second = parseSourceBookings(await client.bookings());
  if (await client.pending()) return { status: 'pending-revisions' as const, complete: false as const };
  const current = parseCanonicalSourceSnapshot(await store.read());
  const finished = int.parse(now());
  if (finished < observedAt || finished - observedAt > SOURCE_PROOF_MAX_MS) return { status: 'expired' as const, complete: false as const };
  if (!equal(first, second) || !equal(snapshot, current)) return { status: 'changed' as const, complete: false as const };
  const remote = new Map(second.map(b => [b.bookingId, b]));
  const local = new Map(current.bindings.map(b => [b.booking.bookingId, b]));
  const missing = second.filter(b => !local.has(b.bookingId)).length;
  const extra = current.bindings.filter(b => !remote.has(b.booking.bookingId));
  // Keep valid cancelled local rehearsal history. It cannot occupy inventory.
  // Every active local provider stay must still appear in the complete source.
  const retainedCancelled = extra.filter(b => b.valid && b.booking.status === 'cancelled').length;
  const mismatched = current.bindings.filter(b => !b.valid || (remote.has(b.booking.bookingId) && !equal(b.booking, remote.get(b.booking.bookingId)))).length;
  const counts = { remote: second.length, canonical: current.bindings.length, missing, extra: extra.length, retainedCancelled, mismatched, unmapped: current.unmappedRemoteRows };
  if (!current.captureEnabled || !current.importEnabled || current.authority !== 'helm' || current.captureVersion === 0) {
    return { status: 'disabled' as const, complete: false as const, counts };
  }
  if (missing || extra.length !== retainedCancelled || mismatched || current.unmappedRemoteRows) return { status: 'mismatch' as const, complete: false as const, counts };
  return { status: 'verified' as const, complete: true as const, counts, observedAt, snapshot: current, bookings: second };
}
export async function renewCanonicalSourceCoverage(client: CanonicalSourceClient, store: CanonicalSourceStore,
  window: { start: string; end: string }, now = Date.now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(window.start) || !/^\d{4}-\d{2}-\d{2}$/.test(window.end) ||
      !Number.isFinite(Date.parse(window.start)) || !Number.isFinite(Date.parse(window.end)) ||
      new Date(window.start).toISOString().slice(0, 10) !== window.start || new Date(window.end).toISOString().slice(0, 10) !== window.end ||
      window.end <= window.start || Date.parse(window.end) - Date.parse(window.start) > 426 * 86400000) throw Error('Invalid source coverage window');
  const proof = await verifyCanonicalSource(client, store, now);
  if (!proof.complete) return { status: proof.status, complete: false, ...('counts' in proof ? { counts: proof.counts } : {}) };
  if (!equal(proof.snapshot.requiredSources, [CANONICAL_BOOKING_SOURCE])) return { status: 'source-not-configured', complete: false, counts: proof.counts };
  // SQL rechecks exact source state, deadline and route under locks. A lost reply is not success.
  const saved = await store.certify(proof.snapshot, proof.bookings, proof.observedAt, window.start, window.end);
  return { status: saved ? 'renewed' : 'superseded', complete: saved, counts: proof.counts };
}
