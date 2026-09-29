import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, canonicalBookings, compareReservations, freshness, intersects, localDay, occupancyEvents, baseline, validDay } from '../calderwood-workspace.ts';
const property_id = '65_calderwood';
const booking = (changes: Partial<import('../calderwood-workspace.ts').WorkspaceBooking> = {}): import('../calderwood-workspace.ts').WorkspaceBooking => ({ id: 'h1', property_id, channel: 'airbnb', source: 'guesty_legacy', external_booking_id: 'g1', external_confirmation_code: 'CONF1', check_in: '2026-09-29', check_out: '2026-10-02', status: 'confirmed', guest_name: 'Test Guest', num_guests: null, gross_amount: null, cleaning_fee: null, taxes: null, payout: null, currency: null, duplicate_of: null, updated_at: '2026-09-29T12:00:00Z', last_seen_at: '2026-09-29T12:00:00Z', ...changes });
const guesty = (changes: Partial<import('../calderwood-workspace.ts').GuestySnapshot> = {}) => ({ guesty_reservation_id: 'g1', property_id, guest_name: 'Test Guest', confirmation_code: 'CONF1', check_in: '2026-09-29', check_out: '2026-10-02', channel: 'Airbnb', status: 'confirmed', synced_at: '2026-09-29T12:00:00Z', ...changes });
const data = (changes: Partial<import('../calderwood-workspace.ts').WorkspaceData> = {}) => ({ asOf: '2026-09-29T14:00:00Z', configured: true, property: { id: property_id, name: '65 Calderwood', address: null }, bookings: [booking()], guesty: [guesty()], blocks: [], feeds: [], sources: { property: null, bookings: null, guesty: null, blocks: null, feeds: null }, ...changes });
test('an unavailable reservation source cannot manufacture discrepancies', () => {
  const unavailable = data({ bookings: [], sources: { ...data().sources, bookings: 'Unavailable' } });
  assert.equal(baseline(unavailable).comparisons, null);
  assert.equal(occupancyEvents(unavailable).length, 0);
});
test('checkout is exclusive and long stays intersect later windows', () => {
  assert.equal(intersects('2026-01-01', '2026-10-02', '2026-09-29', '2026-10-20'), true);
  assert.equal(intersects('2026-09-01', '2026-09-29', '2026-09-29', '2026-10-20'), false);
});
test('calendar days do not drift across DST and today uses property timezone', () => {
  assert.equal(addDays('2026-03-07', 2), '2026-03-09');
  assert.equal(addDays('2026-10-31', 2), '2026-11-02');
  assert.equal(localDay('2026-09-29T02:00:00Z'), '2026-09-28');
  assert.equal(validDay('2026-02-30'), false);
});
test('duplicate aliases compare to canonical rows without counting twice', () => {
  const rows = [booking({ id: 'alias', duplicate_of: 'canonical' }), booking({ id: 'canonical', source: 'ical_import', external_booking_id: null })];
  assert.equal(canonicalBookings(rows).length, 1);
  assert.deepEqual(compareReservations(rows, [guesty()])[0].issues, []);
});
test('cancelled Guesty copy flags an active Helm record', () => {
  assert.deepEqual(compareReservations([booking()], [guesty({ status: 'canceled' })])[0].issues, ['Status differs']);
});
test('same name and dates never silently match', () => {
  const result = compareReservations([booking({ external_booking_id: null, external_confirmation_code: null })], [guesty()])[0];
  assert.equal(result.booking, null);
  assert.ok(result.issues.includes('No matching Helm record'));
});
test('ambiguous confirmations and broken duplicate chains fail closed', () => {
  assert.ok(compareReservations([booking({ external_booking_id: null }), booking({ id: 'h2', external_booking_id: null })], [guesty()])[0].issues.includes('Ambiguous reservation match'));
  assert.ok(compareReservations([booking({ duplicate_of: 'h1' })], [guesty()])[0].issues.includes('Broken duplicate reference'));
});
test('foreign properties cannot resolve aliases or enter calendar', () => {
  const rows = [booking({ duplicate_of: 'foreign' }), booking({ id: 'foreign', property_id: 'other' })];
  assert.equal(compareReservations(rows, [guesty()])[0].booking, null);
  assert.equal(canonicalBookings(rows).length, 0);
});
test('missing and changed Guesty occupancy stays visible as discrepancy evidence', () => {
  const missing = occupancyEvents(data({ bookings: [] }));
  assert.equal(missing[0].kind, 'guesty');
  const changed = occupancyEvents(data({ guesty: [guesty({ check_out: '2026-10-05' })] }));
  assert.equal(changed.length, 2);
  assert.equal(changed.find(e => e.kind === 'guesty')?.end, '2026-10-05');
});
test('contiguous block dates collapse and cancelled/pending stays do not occupy', () => {
  const events = occupancyEvents(data({ bookings: [booking({ status: 'cancelled' }), booking({ id: 'pending', status: 'pending' })], guesty: [], blocks: ['2026-10-01', '2026-10-02', '2026-10-05'].map(date => ({ property_id, date, synced_at: null })) }));
  assert.equal(events.length, 2);
  assert.equal(events[0].end, '2026-10-03');
});
test('unrecognized statuses and invalid intervals are flagged, never presumed confirmed', () => {
  assert.ok(compareReservations([], [guesty({ status: null })])[0].issues.includes('Unrecognized Guesty status'));
  assert.equal(occupancyEvents(data({ bookings: [], guesty: [guesty({ check_out: '2026-09-01' })] })).length, 0);
});
test('freshness rejects future timestamps and export keeps missing evidence explicit', () => {
  assert.equal(freshness('2026-10-01T00:00:00Z', '2026-09-29T00:00:00Z', 30), 'Invalid timestamp');
  assert.equal(freshness('2026-09-01T00:00:00Z', '2026-09-29T00:00:00Z', 30), 'Stale');
  const snapshot = baseline(data({ sources: { ...data().sources, bookings: 'Unavailable' } }));
  assert.equal(snapshot.sourceErrors.bookings, 'Unavailable');
  assert.ok(snapshot.outstanding.includes('Outstanding balances and refunds'));
  assert.equal(snapshot.bookings[0].gross_amount, null);
});
