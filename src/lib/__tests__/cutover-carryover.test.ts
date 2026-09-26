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
import { carryoverClear, evaluateCarryover, guestyBlockTag, isGuestyRule, ECHO_LAG_GRACE_MS, NOT_SHOWN_GRACE_MS, type CarryListing, type CarryRow } from '../cutover-carryover.ts';
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

  // Guesty's UIDs carry the block type: '<listing>_<type>_<from>_<to>@guesty.com_<hash>'.
  const uid = (tag: string | null, from: string, to: string) =>
    tag ? `668c635d25b8180012fd30b7_${tag}_${from}_${to}@guesty.com_x=` : `c0ffee-${from}-${to}@guesty.com`;
  const tagged = (tag: string | null, check_in: string, check_out: string) => gBlock({ check_in, check_out, ical_uid: uid(tag, check_in, check_out) });

  test("Guesty's rolling rules are left behind; everything else must be carried into Helm first", () => {
    // Production, 2026-09-26: every aggregate block reads "Blocked by Guesty";
    // the UID's type tag is what tells them apart.
    const rolling = tagged('bw', '2027-06-23', '2028-09-27'); // 21 Horton's rolling window
    const notice = tagged('an', TODAY, '2026-10-02'); // advance notice
    const fixedClose = tagged('bd', '2027-01-01', '2028-09-27'); // 20 Hammond: closed from a fixed date
    const owner = tagged(null, '2026-12-20', '2026-12-27'); // an owner's hold
    const c = run([rolling, notice, fixedClose, owner], agg);
    assert.equal(c.guestyBlocks.length, 4);
    assert.deepEqual(ids(c.guestyHoldsUncarried).sort(), [fixedClose.id, owner.id].sort());
    assert.equal(carryoverClear(c), false);
    // Re-entered as Helm blocks (the writer lets a hold land on a hold): carried.
    const helmBlock = (check_in: string, check_out: string) =>
      row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, check_in, check_out });
    const after = run([rolling, notice, fixedClose, owner, helmBlock('2026-12-20', '2026-12-27'), helmBlock('2027-01-01', '2028-09-27')], agg);
    assert.deepEqual(after.guestyHoldsUncarried, []);
    assert.equal(carryoverClear(after), true);
  });

  test('a Guesty block over a Guesty-era reservation is carried by that reservation (20 Enon\'s owner stays)', () => {
    const ownerStay = legacy({ channel: 'direct', check_in: '2027-05-25', check_out: '2027-06-28' });
    const blockOverIt = tagged(null, '2027-05-25', '2027-06-28');
    assert.deepEqual(run([ownerStay, blockOverIt], agg).guestyHoldsUncarried, []);
    // A cancelled one carries nothing.
    const gone = { ...ownerStay, status: 'cancelled' };
    assert.deepEqual(ids(run([gone, blockOverIt], agg).guestyHoldsUncarried), [blockOverIt.id]);
  });

  test('isGuestyRule reads the type tag: an, bw, b and a are rules; bd and untagged blocks are not', () => {
    for (const t of ['an', 'bw', 'b', 'a']) assert.equal(isGuestyRule({ ical_uid: uid(t, '2027-01-01', '2027-01-02') }), true, t);
    for (const t of ['bd', 'm', 'o', null]) assert.equal(isGuestyRule({ ical_uid: uid(t, '2027-01-01', '2027-01-02') }), false, String(t));
    assert.equal(isGuestyRule({ ical_uid: null }), false);
    assert.equal(guestyBlockTag('668c635d25b8180012fd30b7_bd_2026-10-01_2028-09-15@guesty.com_3UYyl/HMwkjDuLv53sNEF58Dv58='), 'bd');
  });
});

describe('Booking.com is compared only once its closures are on file', () => {
  test('right after the first tick, before the Booking.com feed has synced again, nothing reads as reopened', () => {
    const gl = legacy({ channel: 'booking_com' });
    const tickedJustNow = [
      listing('airbnb', { export_subscribed_at: '2026-10-01T14:50:00Z' }),
      listing('vrbo', { export_subscribed_at: '2026-10-01T14:55:00Z' }),
      listing('booking_com', { export_subscribed_at: '2026-10-01T14:55:00Z', last_imported_at: '2026-10-01T14:30:00Z' }),
    ];
    assert.deepEqual(run([gl], tickedJustNow).bookingComNotShown, []);
    const synced = tickedJustNow.map((l) => (l.channel === 'booking_com' ? { ...l, last_imported_at: '2026-10-01T15:00:00Z' } : l));
    assert.deepEqual(ids(run([gl], synced).bookingComNotShown), [gl.id]);
  });

  test('a Helm-run home is compared whatever its ticks say', () => {
    const gl = legacy({ channel: 'booking_com' });
    const unticked = LISTINGS.map((l) => ({ ...l, export_subscribed: false }));
    assert.deepEqual(run([gl], unticked).bookingComNotShown, [], 'Guesty-run and nothing ticked: closures are not on file');
    assert.deepEqual(ids(evaluateCarryover({ rows: [gl], listings: unticked, todayIso: TODAY, now: NOW, calendarAuthority: 'helm' }).bookingComNotShown), [gl.id]);
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

  test("the rate plan must not sell further ahead than Guesty's rolling booking window did", () => {
    const withBw = (planWindow: number | null) => {
      const f = facts([]);
      f.feeds = [...f.feeds, { id: 'L-guesty', channel: 'guesty', is_active: true, ical_import_url: 'https://guesty.example/ical.ics', last_import_status: 'success', last_imported_at: '2026-10-01T14:30:00Z', last_import_error: null, export_subscribed: false, export_subscribed_at: null }];
      f.carryRows = [row({ channel: 'block', status: 'block', channel_listing_id: 'L-guesty', check_in: '2027-06-28', check_out: '2028-09-27', ical_uid: '668c635d25b8180012fd30b7_bw_2027-06-28_2028-09-27@guesty.com_x=' })];
      f.ratePlan = { base_nightly_cents: 35000, min_nights_default: 3, booking_window_days: planWindow };
      return evaluateCutoverPreflight(f);
    };
    // 2026-10-01 to 2027-06-28 is 270 days.
    assert.deepEqual(withBw(270).failing, []);
    assert.deepEqual(withBw(365).failing, ['guesty_stays_carried']);
    assert.match(withBw(365).checks.find((x) => x.key === 'guesty_stays_carried')!.detail, /Guesty stops taking bookings 270 days out \(closed from 2027-06-28\); the Helm rate plan's booking window is 365 days/);
    assert.match(withBw(null).checks.find((x) => x.key === 'guesty_stays_carried')!.detail, /booking window is unlimited/);
  });

  test('an unexplained or orphaned Booking.com closure turns the reconciliation check red', () => {
    const r = evaluateCutoverPreflight(facts([bcomHold({})]));
    assert.deepEqual(r.failing, ['booking_com_reconciled']);
    assert.match(r.checks.find((x) => x.key === 'booking_com_reconciled')!.detail, /Enter each Booking.com booking/);
  });
});
