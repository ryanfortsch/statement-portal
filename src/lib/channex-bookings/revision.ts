/** Provider booking boundary. Deliberately separate from the Offline rehearsal importer.
 * No persistence, ACK, scheduling, or send authority is granted by normalization.
 * Wire format: https://docs.channex.io/api-v.1-documentation/bookings-collection
 */
import { z } from 'zod';
import { nights, record, revisionTime } from '../channex-staging/core.ts';

const uuid = z.string().uuid();
const mappingSchema = z.object({
  environment: z.enum(['staging', 'production']),
  propertyId: uuid, roomTypeId: uuid, ratePlanId: uuid,
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type AirbnbBookingMapping = z.infer<typeof mappingSchema>;
const revisionSchema = z.object({
  revisionId: uuid, bookingId: uuid, propertyId: uuid, roomTypeId: uuid, ratePlanId: uuid,
  reservationCode: z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/),
  status: z.enum(['new', 'modified', 'cancelled']),
  checkIn: z.string(), checkOut: z.string(), providerReceivedAt: z.string(),
}).strict();

/** The caller supplies a server-reviewed mapping, never one taken from a webhook.
 * ota_name identifies origin only; it does NOT prove an authorized channel/thread.
 * Provider receipt time must never substitute for Helm's durable receipt timestamp.
 */
export function normalizeAirbnbBookingRevision(raw: unknown, mapping: AirbnbBookingMapping) {
  try {
    const scope = mappingSchema.parse(mapping);
    const row = record(raw), a = record(row.attributes);
    if (a.ota_name !== 'Airbnb' || !Array.isArray(a.rooms) || a.rooms.length !== 1) throw Error();
    if (a.id !== undefined && a.id !== row.id) throw Error();
    const room = record(a.rooms[0]);
    if (room.checkin_date !== a.arrival_date || room.checkout_date !== a.departure_date) throw Error();
    const revision = revisionSchema.parse({
      revisionId: row.id, bookingId: a.booking_id, propertyId: a.property_id,
      roomTypeId: room.room_type_id, ratePlanId: room.rate_plan_id,
      reservationCode: a.ota_reservation_code, status: a.status,
      checkIn: a.arrival_date, checkOut: a.departure_date, providerReceivedAt: a.inserted_at,
    });
    if (revision.propertyId !== scope.propertyId || revision.roomTypeId !== scope.roomTypeId ||
        revision.ratePlanId !== scope.ratePlanId || /^HELMTEST-/i.test(revision.reservationCode)) throw Error();
    nights(revision.checkIn, revision.checkOut);
    return { ...revision, providerReceivedAt: revisionTime(revision.providerReceivedAt),
      environment: scope.environment, mappingGeneration: scope.generation, channel: 'airbnb' as const };
  } catch {
    // Never echo the raw provider payload, which may include guest/payment details.
    throw Error('Airbnb booking revision rejected: invalid identity, mapping, or stay');
  }
}
