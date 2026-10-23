import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAirbnbBookingRevision, type AirbnbBookingMapping } from '../channex-bookings/revision.ts';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mapping: AirbnbBookingMapping = { environment: 'production', propertyId: id(1), roomTypeId: id(2), ratePlanId: id(3), generation: 1 };
function fixture() {
  return { id: id(4), attributes: { id: id(4), booking_id: id(5), property_id: id(1),
    ota_name: 'Airbnb', ota_reservation_code: 'SYNTHETIC123', status: 'new',
    arrival_date: '2027-02-01', departure_date: '2027-02-04', inserted_at: '2026-10-23T12:00:00.123456',
    rooms: [{ room_type_id: id(2), rate_plan_id: id(3), checkin_date: '2027-02-01', checkout_date: '2027-02-04' }],
    customer: { name: 'PRIVATE_SENTINEL' }, guarantee: { card: 'PRIVATE_SENTINEL' }, amount: '99' } };
}
test('Airbnb boundary retains provider identity and precision without guest/payment data or send authority', () => {
  for (const status of ['new', 'modified', 'cancelled']) {
    const raw = fixture(); raw.attributes.status = status;
    const result = normalizeAirbnbBookingRevision(raw, mapping);
    assert.equal(result.status, status); assert.equal(result.channel, 'airbnb');
    assert.equal(result.providerReceivedAt, '2026-10-23T12:00:00.123456Z');
    assert.equal(result.mappingGeneration, 1); assert.equal(result.bookingId, id(5));
    for (const field of ['customer', 'guarantee', 'amount', 'confirmedAt', 'receivedAt', 'threadId', 'canSend']) assert.equal(field in result, false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
  }
});
test('foreign, unmapped, synthetic, and multiple-room revisions are rejected', () => {
  const mutations: ((r: ReturnType<typeof fixture>) => void)[] = [
    r => { r.attributes.ota_name = 'Offline'; },
    r => { r.attributes.property_id = id(9); },
    r => { r.attributes.rooms[0].room_type_id = id(9); },
    r => { r.attributes.rooms[0].rate_plan_id = id(9); },
    r => { r.attributes.rooms.push({ ...r.attributes.rooms[0] }); },
    r => { r.attributes.rooms = []; },
    r => { r.attributes.id = id(9); },
    r => { r.attributes.ota_reservation_code = 'HELMTEST-test'; },
    r => { r.attributes.status = 'inquiry'; },
    r => { r.attributes.rooms[0].checkin_date = '2027-02-02'; },
    r => { r.attributes.inserted_at = '2026-10-23T25:00:00'; },
  ];
  for (const mutate of mutations) { const raw = fixture(); mutate(raw); assert.throws(() => normalizeAirbnbBookingRevision(raw, mapping), /revision rejected/); }
});
test('invalid calendar dates and invalid mapping never escape as usable bookings', () => {
  const raw = fixture(); raw.attributes.arrival_date = raw.attributes.rooms[0].checkin_date = '2027-02-30';
  assert.throws(() => normalizeAirbnbBookingRevision(raw, mapping));
  assert.throws(() => normalizeAirbnbBookingRevision(fixture(), { ...mapping, generation: 0 }));
  assert.throws(() => normalizeAirbnbBookingRevision(null, mapping), e => e instanceof Error && !e.message.includes('PRIVATE_SENTINEL'));
});
