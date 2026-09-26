/**
 * What a home carries across the cutover (lib/cutover-carryover.ts), and the
 * two preflight checks built on it.
 *
 * Every case here is a way a Guesty-era row, or a Booking.com booking, would
 * otherwise hold its nights and a turnover forever once Guesty stops
 * writing, or a Booking.com guest would go unrecorded.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { carryoverClear, evaluateCarryover, NOT_SHOWN_GRACE_MS, type CarryListing, type CarryRow } from '../cutover-carryover.ts';
import { evaluateCutoverPreflight, type CutoverFacts } from '../cutover.ts';

const NOW = new Date('2026-10-01T15:00:00Z');
const TODAY = '2026-10-01';
const OLD = '2026-09-01T00:00:00Z';

const listing = (channel: string, patch: Partial<CarryListing> = {}): CarryListing => ({
  id: `L-${channel}`,
  channel,
  is_active: true,
  ical_import_url: `https://${channel}.example/ical.ics`,
  ical_import_enabled: true,
  last_import_status: 'success',
  last_imported_at: '2026-10-01T14:30:00Z',
  export_subscribed: true,
  ...patch,
});
const LISTINGS = [listing('airbnb'), listing('vrbo'), listing('booking_com')];

let n = 0;
const row = (patch: Partial<CarryRow>): CarryRow => ({
  id: `r${++n}`,
  property_id: '65_calderwood',
  source: 'ical_import',
  channel: 'airbnb',
  status: 'confirmed',
  check_in: '2026-10-10',
  check_out: '2026-10-14',
  duplicate_of: null,
  hold_kind: null,
  channel_listing_id: 'L-airbnb',
  created_at: OLD,
  guest_name: null,
  ...patch,
});
const bcomHold = (patch: Partial<CarryRow> = {}) =>
  row({ channel: 'booking_com', status: 'block', hold_kind: 'ota', channel_listing_id: 'L-booking_com', ...patch });
const legacy = (patch: Partial<CarryRow> = {}) => row({ source: 'guesty_legacy', channel_listing_id: null, guest_name: 'Pat Guest', ...patch });

const run = (rows: CarryRow[], listings: CarryListing[] = LISTINGS) => evaluateCarryover({ rows, listings, todayIso: TODAY, now: NOW });
const ids = (rs: CarryRow[]) => rs.map((r) => r.id);

describe('Guesty-era Airbnb and VRBO stays need a live feed twin', () => {
  test('a Guesty record clustered with its direct-feed row is handed over', () => {
    const feedRow = row({});
    const gl = legacy({ duplicate_of: feedRow.id });
    assert.deepEqual(run([feedRow, gl]).untwinnedGuestyStays, []);
  });

  test('a Guesty record standing alone cannot learn it was cancelled', () => {
    const gl = legacy({ channel: 'vrbo' });
    assert.deepEqual(ids(run([gl]).untwinnedGuestyStays), [gl.id]);
  });

  test("a twin on a feed Helm no longer reads is no twin", () => {
    const gl = legacy({});
    const retiredTwin = row({ duplicate_of: null });
    gl.duplicate_of = retiredTwin.id;
    assert.deepEqual(ids(run([retiredTwin, gl], [listing('airbnb', { is_active: false }), listing('vrbo'), listing('booking_com')]).untwinnedGuestyStays), [retiredTwin.id]);
  });

  test('a stay already over, a cancelled cluster, and Booking.com or direct stays are not this check', () => {
    const past = legacy({ check_in: '2026-09-20', check_out: '2026-09-25' });
    const cancelled = legacy({ status: 'cancelled' });
    const direct = legacy({ channel: 'direct' });
    assert.deepEqual(run([past, cancelled, direct]).untwinnedGuestyStays, []);
  });
});

describe('Booking.com reservations on file against Booking.com closures', () => {
  test("a reservation on file whose nights Booking.com still closes is fine", () => {
    const gl = legacy({ channel: 'booking_com' });
    const hold = bcomHold({});
    const c = run([gl, hold]);
    assert.deepEqual(c.bookingComNotShown, []);
    assert.deepEqual(c.bookingComUnexplained, []);
  });

  test('a reservation on file whose nights Booking.com reopened is flagged (cancelled there?)', () => {
    const gl = legacy({ channel: 'booking_com' });
    const cancelledHold = bcomHold({ status: 'cancelled' });
    assert.deepEqual(ids(run([gl, cancelledHold]).bookingComNotShown), [gl.id]);
  });

  test('a stay in the house counts only the nights still ahead', () => {
    const gl = legacy({ channel: 'booking_com', check_in: '2026-09-28', check_out: '2026-10-03' });
    const hold = bcomHold({ check_in: '2026-10-01', check_out: '2026-10-03' });
    assert.deepEqual(run([gl, hold]).bookingComNotShown, []);
  });

  test('a booking entered by hand minutes ago gets a grace period; the same booking two hours later does not', () => {
    const fresh = row({ source: 'manual', channel: 'booking_com', channel_listing_id: null, created_at: new Date(NOW.getTime() - 10 * 60_000).toISOString() });
    assert.deepEqual(run([fresh]).bookingComNotShown, []);
    const stale = { ...fresh, created_at: new Date(NOW.getTime() - NOT_SHOWN_GRACE_MS - 60_000).toISOString() };
    assert.deepEqual(ids(run([stale]).bookingComNotShown), [stale.id]);
  });

  test('nothing is said while the Booking.com feed is failing, absent, or its closures are not imported yet', () => {
    const gl = legacy({ channel: 'booking_com' });
    assert.deepEqual(run([gl], [listing('airbnb'), listing('booking_com', { last_import_status: 'error' })]).bookingComNotShown, []);
    assert.deepEqual(run([gl], [listing('airbnb')]).bookingComNotShown, []);
    // A fleet home still riding Guesty's aggregate feed, no OTA importing
    // Helm yet: ical-sync drops every direct-feed closure there.
    const fleet = [listing('guesty', { export_subscribed: false }), listing('booking_com', { export_subscribed: false })];
    assert.deepEqual(run([gl], fleet).bookingComNotShown, []);
    assert.deepEqual(run([bcomHold({})], fleet).bookingComUnexplained, []);
  });
});

describe('Booking.com closures nothing explains', () => {
  test('a closure with no reservation on file and nothing Helm sends Booking.com is flagged', () => {
    const h = bcomHold({});
    assert.deepEqual(ids(run([h]).bookingComUnexplained), [h.id]);
  });

  test('a closure over a stay on another channel, or a Helm block, is explained', () => {
    const vrboStay = row({ channel: 'vrbo', channel_listing_id: 'L-vrbo' });
    const helmBlock = row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, check_in: '2026-10-20', check_out: '2026-10-22' });
    const c = run([vrboStay, helmBlock, bcomHold({}), bcomHold({ check_in: '2026-10-20', check_out: '2026-10-22' })]);
    assert.deepEqual(c.bookingComUnexplained, []);
  });

  test("another OTA's closure never explains one: those are not sent to Booking.com", () => {
    const airbnbClosure = row({ status: 'block', hold_kind: 'ota' });
    const h = bcomHold({});
    assert.deepEqual(ids(run([airbnbClosure, h]).bookingComUnexplained), [h.id]);
  });

  test('a closure on a feed Helm no longer reads is orphaned, not unexplained', () => {
    const h = bcomHold({});
    const c = run([h], [listing('airbnb'), listing('booking_com', { is_active: false })]);
    assert.deepEqual(ids(c.bookingComOrphaned), [h.id]);
    assert.deepEqual(c.bookingComUnexplained, []);
    const noListing = bcomHold({ channel_listing_id: null });
    assert.deepEqual(ids(run([noListing]).bookingComOrphaned), [noListing.id]);
  });
});

describe('Guesty aggregate holds are adopted at the flip', () => {
  test('upcoming live blocks on the aggregate feed, and nothing else', () => {
    const agg = [listing('guesty'), ...LISTINGS];
    const hold = row({ channel: 'block', status: 'block', channel_listing_id: 'L-guesty' });
    const stay = row({ channel: 'airbnb', channel_listing_id: 'L-guesty' });
    const past = row({ channel: 'block', status: 'block', channel_listing_id: 'L-guesty', check_in: '2026-09-01', check_out: '2026-09-03' });
    const directHold = row({ status: 'block', hold_kind: 'ota' });
    assert.deepEqual(ids(run([hold, stay, past, directHold], agg).guestyBlocks), [hold.id]);
  });

  test('carryoverClear ignores guestyBlocks: the flip handles them', () => {
    const agg = [listing('guesty'), ...LISTINGS];
    const c = run([row({ channel: 'block', status: 'block', channel_listing_id: 'L-guesty' })], agg);
    assert.equal(c.guestyBlocks.length, 1);
    assert.equal(carryoverClear(c), true);
  });
});

describe('the preflight carries both checks', () => {
  const facts = (carryRows: CarryRow[]): CutoverFacts => ({
    propertyId: '65_calderwood',
    propertyName: '65 Calderwood',
    region: 'bridgeport_ct',
    calendarAuthority: 'guesty',
    guestyListingId: null,
    formerGuestyListingId: null,
    automationsEnabled: false,
    ratePlan: { base_nightly_cents: 35000, min_nights_default: 3 },
    taxConfig: { jurisdiction: 'CT', rate: 0.15 },
    feeds: LISTINGS.map((l) => ({
      id: l.id,
      channel: l.channel,
      is_active: true,
      ical_import_url: l.ical_import_url,
      last_import_status: 'success',
      last_imported_at: '2026-10-01T14:30:00Z',
      last_import_error: null,
      export_subscribed: true,
      export_subscribed_at: '2026-09-30T20:00:00Z',
    })),
    pulls: [
      { channel_guess: 'airbnb', pulled_at: '2026-10-01T13:00:00Z' },
      { channel_guess: 'vrbo', pulled_at: '2026-10-01T13:00:00Z' },
      { channel_guess: 'booking_com', pulled_at: '2026-10-01T13:00:00Z' },
    ],
    bookings: [],
    carryRows,
    recipients: [{ display_name: 'Luana', enabled: true, property_ids: ['65_calderwood'], region: 'bridgeport_ct' }],
    automations: { fleet_rules: 4, property_rules: 0, enabled_rules: 0, configured_in_ota: 0 },
    acknowledgements: { automations_reviewed: true, guesty_disconnect: true },
    now: NOW,
  });

  test('green with nothing to hand over', () => {
    assert.deepEqual(evaluateCutoverPreflight(facts([])).failing, []);
  });

  test('an untwinned Guesty stay and a reopened Booking.com reservation turn the handover check red', () => {
    const r = evaluateCutoverPreflight(facts([legacy({ channel: 'vrbo' }), legacy({ channel: 'booking_com', check_in: '2026-11-01', check_out: '2026-11-04' })]));
    assert.deepEqual(r.failing, ['guesty_stays_carried']);
    const c = r.checks.find((x) => x.key === 'guesty_stays_carried')!;
    assert.match(c.detail, /1 Guesty-era Airbnb or VRBO stay has no live twin/);
    assert.match(c.detail, /Booking.com no longer shows 1 reservation/);
  });

  test('an unexplained or orphaned Booking.com closure turns the reconciliation check red', () => {
    const r = evaluateCutoverPreflight(facts([bcomHold({})]));
    assert.deepEqual(r.failing, ['booking_com_reconciled']);
    assert.match(r.checks.find((x) => x.key === 'booking_com_reconciled')!.detail, /Enter each Booking.com booking/);
  });
});
