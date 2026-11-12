import { CALDERWOOD_PRODUCTION as mapping } from '../../channex-production-preflight.ts';
import { GUESTY_ACCOUNT, GUESTY_CALDERWOOD } from '../../channex-bookings/message-identity.ts';
import type { SourceTimingEvidence } from '../../channex-messaging/timing-evidence.ts';

/** Synthetic response factory, also used by the real loopback SQL integration. */
export function syntheticTimingProvider(row: SourceTimingEvidence['row'], route: {
  remoteBookingId: string; threadId: string; revisionId: string; channelId: string;
}) {
  const relation = (type: string, id: string) => ({ data: { type, id } });
  return {
    v2: { _id: row.guestyId, accountId: GUESTY_ACCOUNT, listingId: GUESTY_CALDERWOOD,
      confirmationCode: row.code, status: 'confirmed', integration: { platform: 'airbnb2' },
      checkInDateLocalized: row.start, checkOutDateLocalized: row.end,
      plannedArrival: row.clocks.plannedArrival, plannedDeparture: row.clocks.plannedDeparture,
      listing: { timezone: row.clocks.timezone, defaultCheckInTime: row.clocks.defaultArrival,
        defaultCheckOutTime: row.clocks.defaultDeparture } },
    v3: [{ _id: row.guestyId, status: 'confirmed', confirmedAt: row.clocks.confirmedAt,
      stay: [{ unitId: GUESTY_CALDERWOOD, unitTypeId: GUESTY_CALDERWOOD,
        checkInDateLocalized: row.start, checkOutDateLocalized: row.end }] }],
    booking: { data: { id: route.remoteBookingId, type: 'booking', attributes: {
      id: route.remoteBookingId, property_id: mapping.propertyId, ota_name: 'Airbnb', status: 'new',
      revision_id: route.revisionId, ota_reservation_code: row.code, arrival_date: row.start, departure_date: row.end,
      rooms: [{ room_type_id: String(mapping.roomTypeId), rate_plan_id: String(mapping.ratePlanId),
        checkin_date: row.start, checkout_date: row.end }] } } },
    thread: { data: { id: route.threadId, type: 'message_thread', attributes: { provider: 'Airbnb', is_closed: false },
      relationships: { booking: relation('booking', route.remoteBookingId), property: relation('property', mapping.propertyId),
        channel: relation('channel', route.channelId) } } },
  };
}
