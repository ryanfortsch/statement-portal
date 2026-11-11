/** One bounded, GET-only check of the existing fictional certification booking.
 * No env-file loading, writes, receipt imports, ACKs, feed polling or live bookings.
 */
import assert from 'node:assert/strict';
import { createAirbnbAcknowledgmentReader } from '../src/lib/channex-bookings/acknowledgment.ts';
import { guestDetailsSchema, normalizeAirbnbBookingRevision, projectChannexGuestDetails } from '../src/lib/channex-bookings/revision.ts';
import { record } from '../src/lib/channex-bookings/primitives.ts';
const mapping = { environment: 'staging' as const, generation: 1,
  propertyId: '30584a9a-8784-4eb1-a387-e26bd43aec1c',
  roomTypeId: 'f795ae2c-f47d-4751-86ff-e883b6d30800', ratePlanId: '7f95b731-ff05-4c41-99c9-f39b3e772fec' };
const fixtures = [
  ['af36595d-0bae-4f08-bdd4-a145242f375e', 'new'],
  ['5b53c554-a07d-4662-b99d-2f226d1fa767', 'modified'],
  ['d3e1d0ce-d365-4e60-9129-157ba74d7903', 'cancelled'],
] as const;
let stage: 'configuration' | 'mapping' | 'revision_read' | 'fixture_identity' | 'guest_projection' = 'configuration';
try {
  if (process.argv.length !== 3 || process.argv[2] !== '--read-only'
    || process.env.VERCEL_ENV === 'production' || process.env.CHANNEX_PRODUCTION_API_KEY) throw Error();
  const key = process.env.CHANNEX_STAGING_API_KEY ?? '';
  const reader = createAirbnbAcknowledgmentReader({ mapping, apiKey: key });
  stage = 'mapping';
  await reader.inspect(mapping);
  const checks = [];
  for (const [revisionId, status] of fixtures) {
    stage = 'revision_read';
    const row = record(await reader.revision(revisionId)), a = record(row.attributes);
    stage = 'fixture_identity';
    assert.equal(a.property_id, mapping.propertyId);
    assert.equal(a.booking_id, 'ce82c66d-0a0f-4eb5-9c98-39116d6cf877');
    assert.equal(a.ota_name, 'Offline'); assert.match(String(a.ota_reservation_code), /^HELMTEST-/);
    assert.equal(a.status, status); assert.equal(a.acknowledge_status, 'acknowledged');
    assert.ok(Array.isArray(a.rooms) && a.rooms.length === 1);
    const room = record(a.rooms[0]);
    assert.equal(room.room_type_id, mapping.roomTypeId); assert.equal(room.rate_plan_id, mapping.ratePlanId);
    stage = 'guest_projection';
    const customer = record(a.customer);
    const maskable = new Set(['mail', 'phone', 'address', 'city', 'state', 'zip', 'country', 'notes']);
    const fields: Record<string, string> = {};
    const maskedFields: string[] = [];
    for (const [field, schema] of Object.entries(guestDetailsSchema.shape)) {
      const value = field === 'notes' ? a.notes : customer[field];
      if (value === '***') {
        assert.ok(maskable.has(field));
        maskedFields.push(field); fields[field] = 'masked';
      } else {
        // Validate every nonmasked field normally; never invent replacement data.
        assert.ok(schema.safeParse(value).success);
        fields[field] = value === null ? 'null' : typeof value;
      }
    }
    if (maskedFields.length) assert.throws(() => projectChannexGuestDetails(a));
    else projectChannexGuestDetails(a);
    // Never relabel an Offline fixture as an Airbnb booking to pass the guard.
    assert.throws(() => normalizeAirbnbBookingRevision(row, mapping));
    checks.push({ status, explicitAcknowledgment: true, guestProjectionAccepted: maskedFields.length === 0,
      maskedProjectionRefused: maskedFields.length > 0, maskedFields, airbnbOriginGuardPreserved: true, fields });
  }
  console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), environment: 'staging',
    evidence: 'existing synthetic Offline CRS revisions only; no retained pre-ACK receipt or live Airbnb verification', checks,
    providerWrites: 0, bookingsChanged: 0, acknowledgmentsSent: 0, messagesSent: 0, readyForCutover: false }));
} catch {
  console.error(JSON.stringify({ ok: false, code: 'STAGING_CONTRACT_UNCONFIRMED', stage, valuesWithheld: true, readyForCutover: false }));
  process.exitCode = 1;
}
