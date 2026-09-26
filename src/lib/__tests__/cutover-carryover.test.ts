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
import { carryoverClear, evaluateCarryover, isGuestyRule, ECHO_LAG_GRACE_MS, NOT_SHOWN_GRACE_MS, type CarryListing, type CarryRow } from '../cutover-carryover.ts';
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

describe('Guesty aggregate blocks: cancelled at the flip, real holds re-entered first', () => {
  const agg = [listing('guesty'), ...LISTINGS];
  const gBlock = (patch: Partial<CarryRow> = {}) => row({ channel: 'block', status: 'block', channel_listing_id: 'L-guesty', ...patch });

  test("every upcoming aggregate block is the flip's to cancel", () => {
    const hold = gBlock({});
    const stay = row({ channel: 'airbnb', channel_listing_id: 'L-guesty' });
    const past = gBlock({ check_in: '2026-09-01', check_out: '2026-09-03' });
    const directHold = row({ status: 'block', hold_kind: 'ota' });
    assert.deepEqual(ids(run([hold, stay, past, directHold], agg).guestyBlocks), [hold.id]);
  });

  test("Guesty's rolling rules are left behind; a hold that may be an owner's must be in Helm first", () => {
    // What production shows (2026-09-26): every aggregate block reads
    // "Blocked by Guesty", the booking-window block running to the calendar
    // horizon and the one-night advance-notice block included.
    const horizon = gBlock({ check_in: '2027-06-23', check_out: '2028-09-27' });
    const notice = gBlock({ check_in: TODAY, check_out: '2026-10-02' });
    const owner = gBlock({ check_in: '2026-12-20', check_out: '2026-12-27' });
    const c = run([horizon, notice, owner], agg);
    assert.equal(c.guestyBlocks.length, 3);
    assert.deepEqual(ids(c.guestyHoldsUncarried), [owner.id]);
    assert.equal(carryoverClear(c), false);
    // Re-entered as a Helm block: carried.
    const helm = row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, check_in: '2026-12-20', check_out: '2026-12-27' });
    const after = run([horizon, notice, owner, helm], agg);
    assert.deepEqual(after.guestyHoldsUncarried, []);
    assert.equal(carryoverClear(after), true);
  });

  test('isGuestyRule: the horizon and the next night only', () => {
    assert.equal(isGuestyRule({ check_in: '2027-01-01', check_out: '2028-06-01' }, TODAY), true);
    assert.equal(isGuestyRule({ check_in: '2026-10-02', check_out: '2026-10-03' }, TODAY), true);
    assert.equal(isGuestyRule({ check_in: '2026-10-05', check_out: '2026-10-06' }, TODAY), false, 'a single night later on may be an owner');
    assert.equal(isGuestyRule({ check_in: '2026-10-01', check_out: '2026-10-03' }, TODAY), false, 'two nights');
  });
});

describe('a Booking.com reservation with no Booking.com feed read', () => {
  test('is flagged: its cancellation could never reach Helm', () => {
    const gl = legacy({ channel: 'booking_com' });
    const c = run([gl], [listing('airbnb'), listing('vrbo'), listing('booking_com', { is_active: false })]);
    assert.deepEqual(ids(c.bookingComUnwatched), [gl.id]);
    assert.deepEqual(c.bookingComNotShown, []);
  });

  test("is not flagged while a Booking.com feed is read (that is bookingComNotShown's job)", () => {
    assert.deepEqual(run([legacy({ channel: 'booking_com' }), bcomHold({})]).bookingComUnwatched, []);
  });
});

describe('echo lag is not an unexplained closure', () => {
  test("a closure of an Airbnb stay cancelled an hour ago is Booking.com's lag, not a booking nobody entered", () => {
    const stay = row({ status: 'cancelled', cancelled_at: new Date(NOW.getTime() - 3_600_000).toISOString() });
    const h = bcomHold({});
    assert.deepEqual(run([stay, h]).bookingComUnexplained, []);
    const longAgo = { ...stay, cancelled_at: new Date(NOW.getTime() - ECHO_LAG_GRACE_MS - 60_000).toISOString() };
    assert.deepEqual(ids(run([longAgo, h]).bookingComUnexplained), [h.id]);
  });

  test('a lifted Helm block counts the same way; a cancelled Airbnb closure never does (it was never sent)', () => {
    const lifted = row({ source: 'manual', channel: 'block', status: 'cancelled', hold_kind: 'owner', channel_listing_id: null, cancelled_at: new Date(NOW.getTime() - 3_600_000).toISOString() });
    assert.deepEqual(run([lifted, bcomHold({})]).bookingComUnexplained, []);
    const airbnbClosure = row({ status: 'cancelled', hold_kind: 'ota', cancelled_at: new Date(NOW.getTime() - 3_600_000).toISOString() });
    const h = bcomHold({});
    assert.deepEqual(ids(run([airbnbClosure, h]).bookingComUnexplained), [h.id]);
  });

  test('a closure already observed missing from the feed is on its way out, not "shown"', () => {
    assert.deepEqual(run([bcomHold({ missing_since: '2026-10-01T14:00:00Z' })]).bookingComUnexplained, []);
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

  test('a Guesty hold with no Helm block over it, or a Booking.com stay nobody reads, turns the handover check red', () => {
    const withAgg = facts([]);
    withAgg.feeds = [...withAgg.feeds, { id: 'L-guesty', channel: 'guesty', is_active: true, ical_import_url: 'https://guesty.example/ical.ics', last_import_status: 'success', last_imported_at: '2026-10-01T14:30:00Z', last_import_error: null, export_subscribed: false, export_subscribed_at: null }];
    withAgg.carryRows = [row({ channel: 'block', status: 'block', channel_listing_id: 'L-guesty', check_in: '2026-12-20', check_out: '2026-12-27' })];
    const r = evaluateCutoverPreflight(withAgg);
    assert.deepEqual(r.failing, ['guesty_stays_carried']);
    assert.match(r.checks.find((x) => x.key === 'guesty_stays_carried')!.detail, /1 hold set in Guesty has no Helm block over it/);

    const unread = facts([legacy({ channel: 'booking_com' })]);
    unread.feeds = unread.feeds.map((f) => (f.channel === 'booking_com' ? { ...f, is_active: false } : f));
    const u = evaluateCutoverPreflight(unread);
    assert.ok(u.failing.includes('guesty_stays_carried'));
    assert.match(u.checks.find((x) => x.key === 'guesty_stays_carried')!.detail, /Helm reads no Booking.com feed/);
  });

  test('an unexplained or orphaned Booking.com closure turns the reconciliation check red', () => {
    const r = evaluateCutoverPreflight(facts([bcomHold({})]));
    assert.deepEqual(r.failing, ['booking_com_reconciled']);
    assert.match(r.checks.find((x) => x.key === 'booking_com_reconciled')!.detail, /Enter each Booking.com booking/);
  });
});
