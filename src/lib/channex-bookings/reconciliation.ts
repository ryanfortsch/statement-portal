import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CALDERWOOD_PRODUCTION as m } from '../channex-production-preflight.ts';
import { BOOKING_CHANNELS, BOOKING_SOURCES, BOOKING_STATUSES } from '../channels-types.ts';
import { record, nights } from './primitives.ts';

export class BookingAuditError extends Error {
  readonly code: 'INVALID_BOOKING_COLLECTION' | 'PROVIDER_READ_FAILED' | 'AUDIT_LIMIT_REACHED'
    | 'CANONICAL_SNAPSHOT_INVALID' | 'SOURCES_CHANGED' | 'AUDIT_FAILED';
  constructor(code: BookingAuditError['code']) { super(code); this.code = code; }
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const ms = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
});
const code = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
const remoteSchema = z.object({ id: z.uuid(), revisionId: z.uuid(), code,
  checkIn: date, checkOut: date, status: z.enum(['new', 'modified', 'cancelled']) }).strict();
export type RemoteBooking = z.infer<typeof remoteSchema>;
const localSchema = z.object({ id: z.uuid(), channel: z.enum(BOOKING_CHANNELS), source: z.enum(BOOKING_SOURCES),
  status: z.enum(BOOKING_STATUSES), checkIn: date, checkOut: date, duplicateOf: z.uuid().nullable(),
  holdKind: z.string().max(80).nullable(), code: z.string().max(160).nullable() }).strict();
export type LocalBooking = z.infer<typeof localSchema>;
const snapshotSchema = z.object({ format: z.literal(1), propertyId: z.literal(m.helmPropertyId),
  authority: z.literal('guesty'), rows: z.array(localSchema).max(5000) }).strict();
export type CanonicalSnapshot = z.infer<typeof snapshotSchema>;
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Booking-list dates describe the latest revision. inserted_at on a BOOKING is
 * not treated as revision ordering evidence. Never feed this projection to ACK/import. */
export function projectRemoteBooking(input: unknown): RemoteBooking {
  try {
    const r = record(input), a = record(r.attributes);
    if (r.type !== 'booking' || a.id !== r.id || a.property_id !== m.propertyId || a.ota_name !== 'Airbnb'
      || !Array.isArray(a.rooms) || a.rooms.length !== 1) throw Error();
    const room = record(a.rooms[0]);
    if (room.room_type_id !== m.roomTypeId || room.rate_plan_id !== m.ratePlanId
      || room.checkin_date !== a.arrival_date || room.checkout_date !== a.departure_date) throw Error();
    const booking = remoteSchema.parse({ id: r.id, revisionId: a.revision_id, code: a.ota_reservation_code,
      checkIn: a.arrival_date, checkOut: a.departure_date, status: a.status });
    nights(booking.checkIn, booking.checkOut);
    if (/^HELMTEST-/i.test(booking.code)) throw Error();
    return booking;
  } catch { throw new BookingAuditError('INVALID_BOOKING_COLLECTION'); }
}

export function parseCanonicalSnapshot(input: unknown): CanonicalSnapshot {
  try {
    const s = snapshotSchema.parse(input);
    const ids = new Map(s.rows.map(row => [row.id, row]));
    if (ids.size !== s.rows.length) throw Error();
    for (const b of s.rows) {
      if (b.checkIn >= b.checkOut) throw Error();
      // All scoped rows are loaded, so missing/cross-property roots and chains
      // cannot silently make a stay disappear from the comparison.
      if (b.duplicateOf && (!ids.has(b.duplicateOf) || b.duplicateOf === b.id || ids.get(b.duplicateOf)!.duplicateOf)) throw Error();
    }
    s.rows.sort((a, b) => a.id.localeCompare(b.id));
    return s;
  } catch { throw new BookingAuditError('CANONICAL_SNAPSHOT_INVALID'); }
}
export type AuditIssueKind = 'missing_in_helm' | 'missing_in_channex' | 'ambiguous_code'
  | 'missing_confirmation_code' | 'dates_differ' | 'status_differs' | 'held_nights_overlap' | 'stays_overlap';
export type AuditIssue = { kind: AuditIssueKind; canonicalIds: string[]; remoteIds: string[] };
const active = (b: LocalBooking) => !b.duplicateOf && (b.status === 'confirmed' || b.status === 'completed');
const hold = (b: LocalBooking) => b.status === 'block' && (!b.duplicateOf || (b.holdKind === 'ota' && b.source === 'ical_import'));
const overlap = (a: { checkIn: string; checkOut: string }, b: { checkIn: string; checkOut: string }) => a.checkIn < b.checkOut && a.checkOut > b.checkIn;

/** Diagnostic only. Matching codes never create links, cancel rows or certify
 * upstream coverage. Independent holds survive even a matching cancellation. */
export function compareBookingCollections(snapshot: CanonicalSnapshot, input: RemoteBooking[], window: { start: string; end: string }) {
  const local = parseCanonicalSnapshot(snapshot).rows;
  const remote = z.array(remoteSchema).max(5000).parse(input).sort((a, b) => a.id.localeCompare(b.id));
  date.parse(window.start); date.parse(window.end);
  const windowDays = (Date.parse(window.end) - Date.parse(window.start)) / 86400000;
  if (windowDays < 1 || windowDays > 560) throw new BookingAuditError('AUDIT_LIMIT_REACHED');
  if (new Set(remote.map(b => b.id)).size !== remote.length || new Set(remote.map(b => b.revisionId)).size !== remote.length) {
    throw new BookingAuditError('INVALID_BOOKING_COLLECTION');
  }
  const inWindow = (b: { checkIn: string; checkOut: string }) => b.checkIn < window.end && b.checkOut > window.start;
  // Match identities across all dates before filtering issues to the review window:
  // a date change outside that window must remain a difference, not a disappearance.
  const localStays = local.filter(b => !b.duplicateOf && b.channel === 'airbnb' && b.status !== 'block');
  const codes = new Set([...localStays.map(b => b.code).filter((v): v is string => !!v), ...remote.map(b => b.code)]);
  const issues: AuditIssue[] = [];
  let references = 0;
  const add = (kind: AuditIssueKind, a: LocalBooking[], b: RemoteBooking[]) => {
    references += a.length + b.length;
    if (issues.length >= 5000 || references > 20_000) throw new BookingAuditError('AUDIT_LIMIT_REACHED');
    issues.push({ kind, canonicalIds: a.map(r => r.id).sort(), remoteIds: b.map(r => r.id).sort() });
  };
  let matched = 0;
  for (const c of [...codes].sort()) {
    const a = localStays.filter(b => b.code === c), b = remote.filter(b => b.code === c);
    if (![...a, ...b].some(inWindow)) continue;
    if (a.length > 1 || b.length > 1) { add('ambiguous_code', a, b); continue; }
    if (!a.length) { if (b[0].status !== 'cancelled') add('missing_in_helm', a, b); continue; }
    if (!b.length) { if (active(a[0])) add('missing_in_channex', a, b); continue; }
    const expectedStatus = b[0].status === 'cancelled' ? a[0].status === 'cancelled' : active(a[0]);
    const sameDates = a[0].checkIn === b[0].checkIn && a[0].checkOut === b[0].checkOut;
    if (!expectedStatus) add('status_differs', a, b);
    if (!sameDates) add('dates_differ', a, b);
    if (expectedStatus && sameDates) matched++;
  }
  for (const a of localStays.filter(b => active(b) && inWindow(b) && !b.code)) add('missing_confirmation_code', [a], []);
  const held = local.filter(b => hold(b) && inWindow(b));
  const occupied = local.filter(b => active(b) && inWindow(b));
  for (const b of remote.filter(b => b.status !== 'cancelled' && inWindow(b))) {
    const conflicts = held.filter(a => overlap(a, b));
    if (conflicts.length) add('held_nights_overlap', conflicts, [b]);
    const stays = occupied.filter(a => overlap(a, b) && !(a.channel === 'airbnb' && a.code === b.code));
    if (stays.length) add('stays_overlap', stays, [b]);
  }
  const counts = Object.fromEntries((['missing_in_helm','missing_in_channex','ambiguous_code','missing_confirmation_code',
    'dates_differ','status_differs','held_nights_overlap','stays_overlap'] as const).map(kind => [kind, issues.filter(i => i.kind === kind).length]));
  return { window, canonicalRows: local.length, providerBookings: remote.length, matched,
    activeCanonicalStays: occupied.length, otherChannelStays: occupied.filter(b => b.channel !== 'airbnb').length,
    preservedHolds: held.length, duplicateRows: local.filter(b => b.duplicateOf).length,
    differences: issues.length, counts, issues,
    // Two equal paginated scans are observations, not a transaction or coverage grant.
    completeCoverage: false as const, readyForCutover: false as const,
    bookingsChanged: 0 as const, providerWrites: 0 as const, messagesSent: 0 as const };
}
