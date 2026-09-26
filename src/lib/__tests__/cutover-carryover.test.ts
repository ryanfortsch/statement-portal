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
import { CARRIED_SEASON_NOTE, carryoverClear, echoFingerprint, evaluateCarryover, guestyBlockTag, isGuestyRule, mirrorRunsFromDays, ECHO_LAG_GRACE_MS, NOT_SHOWN_GRACE_MS, type CarryListing, type CarryRow, type MirrorDay } from '../cutover-carryover.ts';
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
    // With no rate plan window the rolling rule still has a gap to close.
    assert.notEqual(after.bookingWindowGap, null);
    const withPlan = evaluateCarryover({
      rows: [rolling, notice, fixedClose, owner, helmBlock('2026-12-20', '2026-12-27'), helmBlock('2027-01-01', '2028-09-27')],
      listings: agg, todayIso: TODAY, now: NOW, planWindowDays: 200,
    });
    assert.equal(carryoverClear(withPlan), true);
  });

  test("the rolling window is measured from the day Guesty published it, not from today (a frozen feed keeps its own day)", () => {
    // Published 09-26 at 00:30 EDT, closed from 270 nights later; the feed
    // froze when the listing was deleted, and today is 10-01.
    const bw = gBlock({ check_in: '2027-06-23', check_out: '2028-09-27', created_at: '2026-09-26T04:30:00Z', ical_uid: uid('bw', '2027-06-23', '2028-09-27') });
    const at = (planWindowDays: number) => evaluateCarryover({ rows: [bw], listings: agg, todayIso: TODAY, now: NOW, planWindowDays }).bookingWindowGap;
    assert.equal(at(269), null);
    assert.deepEqual(at(270), { closedFrom: '2027-06-23', maxPlanWindow: 269, planWindow: 270 });
  });

  test("a 'bd' closure only has to be carried as far as Helm could ever sell, so its rolling end never re-opens the check", () => {
    // Guesty re-keys 20 Hammond's block every night: 2027-01-01 to 2028-09-27, then to 09-28, ...
    const helm = row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, check_in: '2027-01-01', check_out: '2028-09-27' });
    const tomorrowsRow = tagged('bd', '2027-01-01', '2028-09-28');
    assert.deepEqual(run([tomorrowsRow, helm], agg).guestyHoldsUncarried, []);
  });

  test('on a home with no aggregate feed, Guesty\'s calendar holds must be carried (65 Calderwood; 8 of 18 homes)', () => {
    const noAgg = LISTINGS;
    const mirrorHolds = [{ check_in: '2026-10-16', check_out: '2026-12-30', block_type: 'm', note: 'owner season' }];
    const c = evaluateCarryover({ rows: [], listings: noAgg, todayIso: TODAY, now: NOW, mirrorHolds });
    assert.deepEqual(c.guestyHoldsUncarried.map((r) => [r.id, r.check_in, r.check_out]), [['mirror:2026-10-16', '2026-10-16', '2026-12-30']]);
    const helm = row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, check_in: '2026-10-16', check_out: '2026-12-30' });
    assert.deepEqual(evaluateCarryover({ rows: [helm], listings: noAgg, todayIso: TODAY, now: NOW, mirrorHolds }).guestyHoldsUncarried, []);
    // A Helm-run home's mirror is Helm's own: nothing to carry.
    assert.deepEqual(evaluateCarryover({ rows: [], listings: noAgg, todayIso: TODAY, now: NOW, mirrorHolds, calendarAuthority: 'helm' }).guestyHoldsUncarried, []);
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

describe('a stay made after a Booking.com closure never explains it', () => {
  test('an Airbnb stay booked after Booking.com closed the nights is a double booking, and stays visible', () => {
    const closure = bcomHold({ created_at: '2026-09-20T00:00:00Z' });
    const before = row({ channel: 'airbnb', created_at: '2026-09-10T00:00:00Z' });
    const after = row({ channel: 'airbnb', created_at: '2026-09-25T00:00:00Z' });
    assert.deepEqual(run([closure, before]).bookingComUnexplained, [], 'a stay Booking.com could have been sent');
    assert.deepEqual(ids(run([closure, after]).bookingComUnexplained), [closure.id], 'a stay that came after it');
  });

  test('a hold made after it explains it only by taking over cover that predates it (a Guesty block re-entered in Helm)', () => {
    const closure = bcomHold({ created_at: '2026-09-20T00:00:00Z' });
    const helm = row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, created_at: '2026-09-25T00:00:00Z' });
    // On its own a later hold is no cause: the booking writer refuses one
    // over an unexplained Booking.com closure, so it can only be a hold
    // typed over a real guest.
    assert.deepEqual(ids(run([closure, helm]).bookingComUnexplained), [closure.id]);
    // Over the Guesty aggregate block Booking.com was echoing, it carries on
    // after the flip cancels that block.
    const guesty = row({ channel: 'block', status: 'cancelled', hold_kind: 'guesty', channel_listing_id: 'L-guesty', created_at: OLD, cancelled_at: '2026-09-28T00:00:00Z' });
    assert.deepEqual(run([closure, helm, guesty]).bookingComUnexplained, []);
  });
});

describe('round 7: Booking.com closures judged by continuous cover (lib/echo-cause)', () => {
  test("a same-dates rebook inside Booking.com's pull lag stays explained until checkout", () => {
    const closure = bcomHold({ created_at: '2026-09-15T00:00:00Z', live_since: '2026-09-15T00:00:00Z' });
    const first = row({ created_at: '2026-09-10T00:00:00Z', status: 'cancelled', cancelled_at: '2026-09-30T01:00:00Z' });
    const rebook = row({ created_at: '2026-09-30T01:30:00Z', channel_listing_id: 'L-vrbo', channel: 'vrbo' });
    assert.deepEqual(run([closure, first, rebook]).bookingComUnexplained, []);
    const later = evaluateCarryover({ rows: [closure, first, rebook], listings: LISTINGS, todayIso: '2026-10-12', now: new Date('2026-10-12T12:00:00Z') });
    assert.deepEqual(later.bookingComUnexplained, []);
  });

  test("an Airbnb stay moved onto a Booking.com guest's nights after the closure appeared is listed", () => {
    const closure = bcomHold({ created_at: '2026-09-30T10:00:00Z', live_since: '2026-09-30T10:00:00Z' });
    const moved = row({ created_at: '2026-09-15T00:00:00Z', live_since: '2026-09-30T12:00:00Z' });
    assert.deepEqual(ids(run([closure, moved]).bookingComUnexplained), [closure.id]);
  });

  test('a stay extended keeps its old nights, so its unchanged Booking.com closures stay explained for good', () => {
    // Round 8: an 8-hour allowance used to cover this; the old nights were
    // then listed for good once it ran out. held_ages carries them.
    const closure = bcomHold({ created_at: '2026-09-16T00:00:00Z', live_since: '2026-09-16T00:00:00Z', check_out: '2026-10-13' });
    const extended = row({ created_at: '2026-09-15T00:00:00Z', live_since: '2026-10-01T13:00:00Z', held_ages: [{ from: '2026-10-10', to: '2026-10-13', since: '2026-09-15T00:00:00Z' }] });
    assert.deepEqual(run([closure, extended]).bookingComUnexplained, []);
    const weeksLater = evaluateCarryover({ rows: [closure, extended], listings: LISTINGS, todayIso: '2026-10-09', now: new Date('2026-10-09T12:00:00Z') });
    assert.deepEqual(weeksLater.bookingComUnexplained, []);
    const noKept = row({ created_at: '2026-09-15T00:00:00Z', live_since: '2026-10-01T13:00:00Z' });
    assert.deepEqual(ids(run([closure, noKept]).bookingComUnexplained), [closure.id], 'moved with nothing kept: those nights start at the move');
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
    const lifted = row({ source: 'manual', channel: 'block', status: 'cancelled', hold_kind: 'owner', channel_listing_id: null, live_since: OLD, cancelled_at: new Date(NOW.getTime() - 3_600_000).toISOString() });
    assert.deepEqual(run([lifted, bcomHold({})]).bookingComUnexplained, []);
    // A Helm row that never held (a declined inquiry: no live_since) was never sent.
    const declined = row({ source: 'direct_booking', channel: 'direct', status: 'cancelled', channel_listing_id: null, live_since: null, cancelled_at: new Date(NOW.getTime() - 3_600_000).toISOString() });
    assert.deepEqual(ids(run([declined, bcomHold({})]).bookingComUnexplained).length, 1);
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
    assert.match(r.checks.find((x) => x.key === 'guesty_stays_carried')!.detail, /1 hold set in Guesty has nothing in Helm over it/);

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
      // Published 00:30 EDT on 10-01 (04:30 UTC), closed from 270 nights later.
      f.carryRows = [row({ channel: 'block', status: 'block', channel_listing_id: 'L-guesty', check_in: '2027-06-28', check_out: '2028-09-27', created_at: '2026-10-01T04:30:00Z', ical_uid: '668c635d25b8180012fd30b7_bw_2027-06-28_2028-09-27@guesty.com_x=' })];
      f.ratePlan = { base_nightly_cents: 35000, min_nights_default: 3, booking_window_days: planWindow };
      return evaluateCutoverPreflight(f);
    };
    // 2026-10-01 to 2027-06-28 is 270 days; Helm sells a night at most
    // booking_window_days away, so 269 is the widest window that keeps
    // 2027-06-28 closed.
    assert.deepEqual(withBw(269).failing, []);
    assert.deepEqual(withBw(270).failing, ['guesty_stays_carried']);
    assert.match(withBw(365).checks.find((x) => x.key === 'guesty_stays_carried')!.detail, /Guesty takes no bookings from 2027-06-28; the Helm rate plan's booking window is 365 days, which would sell some of those nights. Set it to 269 days or fewer/);
    assert.match(withBw(null).checks.find((x) => x.key === 'guesty_stays_carried')!.detail, /booking window is unlimited/);
  });

  test('an unexplained or orphaned Booking.com closure turns the reconciliation check red', () => {
    const r = evaluateCutoverPreflight(facts([bcomHold({})]));
    assert.deepEqual(r.failing, ['booking_com_reconciled']);
    assert.match(r.checks.find((x) => x.key === 'booking_com_reconciled')!.detail, /Check each in the extranet/);
  });
});

describe('round 6: what Guesty closed, read off its calendar mirror', () => {
  const day = (date: string, patch: Partial<MirrorDay> = {}): MirrorDay => ({ date, status: 'unavailable', block_type: null, block_rule_type: null, block_ref_id: null, block_note: null, synced_at: '2026-10-01T08:30:00Z', ...patch });
  const range = (from: string, to: string, patch: Partial<MirrorDay> = {}) => {
    const out: MirrorDay[] = [];
    for (let d = from; d < to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(day(d, patch));
    return out;
  };

  test('holds by Guesty ref, a fixed-date season, an untyped closure; rules skipped; the rolling window returned apart', () => {
    const rows = [
      day('2026-10-01'), // lone untyped night today: advance notice
      ...range('2026-10-05', '2026-10-08', { block_type: 'm', block_ref_id: 'ref-a', block_note: 'owner' }),
      ...range('2026-10-08', '2026-10-10', { block_type: 'm', block_ref_id: 'ref-b' }),
      day('2026-10-12', { status: 'available' }),
      ...range('2026-10-20', '2026-10-22', { block_rule_type: 'b' }),
      ...range('2026-11-02', '2026-11-10'), // untyped: carried
      ...range('2027-01-01', '2027-03-01', { block_rule_type: 'bd' }),
      ...range('2027-06-23', '2027-06-26', { block_rule_type: 'bw', synced_at: '2026-10-01T08:30:00Z' }),
    ];
    const { holds, bw } = mirrorRunsFromDays(rows, TODAY);
    assert.deepEqual(holds.map((h) => [h.kind, h.check_in, h.check_out, !!h.rolling]), [
      ['hold', '2026-10-05', '2026-10-08', false],
      ['hold', '2026-10-08', '2026-10-10', false],
      ['unknown', '2026-11-02', '2026-11-10', false],
      ['closed_from_date', '2027-01-01', '2027-03-01', false],
    ]);
    assert.deepEqual(bw, { check_in: '2027-06-23', seen_at: '2026-10-01T08:30:00Z' });
  });

  test("a home with no aggregate feed flips only once its closed season is carried to the horizon, not to the mirror's edge (16 Waterman's shape)", () => {
    const { holds, lastDate } = mirrorRunsFromDays(range('2026-11-02', '2027-09-30'), TODAY);
    assert.equal(holds[0].rolling, true, 'it runs to the end of the mirror');
    assert.equal(lastDate, '2027-09-29');
    const c = evaluateCarryover({ rows: [], listings: LISTINGS, todayIso: TODAY, now: NOW, mirrorHolds: holds, mirrorLastDate: lastDate });
    // Covered to today + 540; listed (and the hub's re-enter link
    // pre-filled) a year past it, so the block still satisfies tomorrow.
    assert.deepEqual(c.guestyHoldsUncarried.map((r) => [r.check_in, r.check_out, r.rolling]), [['2026-11-02', '2029-03-24', true]]);
    const toMirrorEdge = row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, check_in: '2026-11-02', check_out: '2027-09-30' });
    const toHorizon = { ...toMirrorEdge, id: 'H2', check_out: '2028-03-24' };
    const carried = (rows: CarryRow[]) => evaluateCarryover({ rows, listings: LISTINGS, todayIso: TODAY, now: NOW, mirrorHolds: holds, mirrorLastDate: lastDate }).guestyHoldsUncarried;
    assert.equal(carried([toMirrorEdge]).length, 1, "a block to the mirror's edge sold the rest of the season");
    assert.deepEqual(carried([toHorizon]), []);
    // A wider plan window widens the horizon with it.
    const wide = evaluateCarryover({ rows: [toHorizon], listings: LISTINGS, todayIso: TODAY, now: NOW, mirrorHolds: holds, mirrorLastDate: lastDate, planWindowDays: 700 });
    assert.deepEqual(wide.guestyHoldsUncarried.map((r) => r.check_out), ['2029-09-01']);
    // The pre-filled block still satisfies the check the next day.
    const prefilled = { ...toMirrorEdge, id: 'H3', check_out: '2029-03-24' };
    const tomorrow = evaluateCarryover({ rows: [prefilled], listings: LISTINGS, todayIso: '2026-10-02', now: new Date('2026-10-02T15:00:00Z'), mirrorHolds: holds, mirrorLastDate: lastDate });
    assert.deepEqual(tomorrow.guestyHoldsUncarried, []);
  });

  test("a hold that runs past the mirror's edge is carried to its Guesty ref's end", () => {
    const rows = range('2027-09-20', '2027-09-30', { block_type: 'o', block_ref_id: 'ref-owner', block_end: '2027-10-09' });
    const { holds } = mirrorRunsFromDays(rows, TODAY);
    assert.deepEqual(holds.map((h) => [h.kind, h.check_in, h.check_out, !!h.rolling]), [['hold', '2027-09-20', '2027-10-10', false]]);
    const noRef = mirrorRunsFromDays(range('2027-09-20', '2027-09-30', { block_type: 'o', block_ref_id: 'ref-owner' }), TODAY).holds;
    assert.equal(noRef[0].rolling, true, 'with no end on record it is carried to the horizon');
  });

  test('a Guesty rule type nobody classified is carried and named, never read as an open night', () => {
    const { holds } = mirrorRunsFromDays([...range('2026-12-31', '2027-02-01', { block_rule_type: 'r' }), ...range('2027-03-01', '2027-03-05', { block_rule_type: 'an' })], TODAY);
    assert.deepEqual(holds.map((h) => [h.kind, h.check_in, h.check_out, h.note]), [['unknown', '2026-12-31', '2027-02-01', 'Guesty rule r']]);
  });

  test("the range past Guesty's calendar mirror is reported while Guesty runs a home with no aggregate feed", () => {
    const base = { rows: [], listings: LISTINGS, todayIso: TODAY, now: NOW, mirrorHolds: [] };
    assert.equal(evaluateCarryover({ ...base, mirrorLastDate: '2027-09-28' }).mirrorBlindFrom, '2027-09-29');
    assert.equal(evaluateCarryover({ ...base, mirrorLastDate: null }).mirrorBlindFrom, TODAY, 'no mirror at all: blind from today');
    assert.equal(evaluateCarryover({ ...base, mirrorLastDate: '2028-06-01' }).mirrorBlindFrom, null, 'the mirror reaches past the horizon');
    assert.equal(evaluateCarryover({ ...base, mirrorLastDate: '2027-09-28', calendarAuthority: 'helm' }).mirrorBlindFrom, null);
    assert.equal(evaluateCarryover({ ...base, listings: [listing('guesty'), ...LISTINGS], mirrorLastDate: '2027-09-28' }).mirrorBlindFrom, null, 'the aggregate feed reaches the horizon');
    assert.equal(carryoverClear(evaluateCarryover({ ...base, mirrorLastDate: '2027-09-28' })), true, 'a note for the acknowledgement, not a blocker');
  });

  test("a fixed owner hold beyond the plan's window must still be carried: the window reaches it later", () => {
    // 73 Rocky Neck: Guesty's window 150 days, the plan set to 149, an owner week in July.
    const owner = gBlockFor(null, '2027-07-03', '2027-07-10');
    const bwRow = gBlockFor('bw', '2027-02-23', '2028-09-27');
    const c = evaluateCarryover({ rows: [owner, bwRow], listings: [listing('guesty'), ...LISTINGS], todayIso: TODAY, now: NOW, planWindowDays: 149 });
    assert.deepEqual(ids(c.guestyHoldsUncarried), [owner.id]);
  });

  test('a fixed hold is carried to its own end however far out; only a rolling-end closure stops at the bound', () => {
    // 2028-06 is past today + 540; a fixed owner week there still has to be in Helm.
    const farOwner = gBlockFor(null, '2028-06-10', '2028-06-17');
    assert.deepEqual(ids(run([farOwner], [listing('guesty'), ...LISTINGS]).guestyHoldsUncarried), [farOwner.id]);
    const helm = row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, check_in: '2028-06-10', check_out: '2028-06-17' });
    assert.deepEqual(run([farOwner, helm], [listing('guesty'), ...LISTINGS]).guestyHoldsUncarried, []);
  });

  test("the booking-window check also reads the mirror's rolling window on a home with no aggregate feed", () => {
    const c = evaluateCarryover({ rows: [], listings: LISTINGS, todayIso: TODAY, now: NOW, planWindowDays: 365, mirrorBookingWindow: { check_in: '2027-06-28', seen_at: '2026-10-01T08:30:00Z' } });
    assert.deepEqual(c.bookingWindowGap, { closedFrom: '2027-06-28', maxPlanWindow: 269, planWindow: 365 });
  });

  test("a revived Booking.com closure is aged from when its nights came back, not from the UID's first import", () => {
    // C first seen 10-01 for an earlier guest; cancelled; revived 10-20 when a
    // new Airbnb guest (row created 10-19) booked the same nights.
    const closure = bcomHold({ created_at: '2026-09-01T00:00:00Z', live_since: '2026-09-20T00:00:00Z' });
    const airbnb = row({ channel: 'airbnb', created_at: '2026-09-19T00:00:00Z' });
    assert.deepEqual(run([closure, airbnb]).bookingComUnexplained, []);
    const stillLater = row({ channel: 'airbnb', created_at: '2026-09-25T00:00:00Z' });
    assert.deepEqual(ids(run([closure, stillLater]).bookingComUnexplained), [closure.id]);
  });
});

function gBlockFor(tag: string | null, check_in: string, check_out: string) {
  return row({
    channel: 'block',
    status: 'block',
    channel_listing_id: 'L-guesty',
    check_in,
    check_out,
    ical_uid: tag ? `668c635d25b8180012fd30b7_${tag}_${check_in}_${check_out}@guesty.com_x=` : `c0ffee-${check_in}@guesty.com`,
  });
}

describe('round 7: stays from a feed Helm no longer reads', () => {
  test('are listed for a person, and never block the flip', () => {
    const stay = row({ channel: 'vrbo', channel_listing_id: 'L-vrbo' });
    const retired = [listing('airbnb'), listing('vrbo', { is_active: false }), listing('booking_com')];
    const c = run([stay], retired);
    assert.deepEqual(ids(c.unreadFeedStays), [stay.id]);
    assert.equal(carryoverClear(c), true);
    assert.deepEqual(run([stay]).unreadFeedStays, [], 'its feed is read');
    const deleted = row({ channel: 'other', channel_listing_id: null });
    assert.deepEqual(ids(run([deleted]).unreadFeedStays), [deleted.id], 'its feed row was deleted');
  });

  test('a stay typed by hand whose feed twin sits on a retired feed is listed (round 8)', () => {
    const typed = row({ source: 'manual', channel: 'airbnb', channel_listing_id: null });
    const twin = row({ duplicate_of: typed.id });
    const retired = [listing('airbnb', { is_active: false }), listing('vrbo'), listing('booking_com')];
    assert.deepEqual(ids(run([typed, twin], retired).unreadFeedStays), [typed.id]);
    assert.deepEqual(run([typed, twin]).unreadFeedStays, [], 'its twin is read');
    assert.deepEqual(run([typed], retired).unreadFeedStays, [], 'no feed twin at all: nothing to lose');
  });

  test('leave out duplicates, closures, cancelled or past stays, and the Guesty aggregate feed', () => {
    const retired = [listing('airbnb', { is_active: false }), listing('guesty', { is_active: false }), listing('vrbo'), listing('booking_com')];
    const rows = [
      row({ duplicate_of: 'x' }),
      row({ status: 'block', hold_kind: 'ota' }),
      row({ status: 'cancelled' }),
      row({ check_in: '2026-09-20', check_out: '2026-09-25' }),
      row({ channel_listing_id: 'L-guesty' }),
    ];
    assert.deepEqual(run(rows, retired).unreadFeedStays, []);
  });
});

describe('round 8: a closed season rolling under the mirror\'s last night, and carried seasons after the flip', () => {
  const day = (date: string, patch: Partial<MirrorDay> = {}): MirrorDay => ({ date, status: 'unavailable', block_type: null, block_rule_type: null, block_ref_id: null, block_note: null, ...patch });
  const range = (from: string, to: string, patch: Partial<MirrorDay> = {}) => {
    const out: MirrorDay[] = [];
    for (let d = from; d < to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(day(d, patch));
    return out;
  };

  test("a hold on the last mirrored nights does not make the season under it look bounded (36 Granite's shape)", () => {
    const rows = [
      ...range('2027-01-01', '2027-09-20', { block_rule_type: 'bd' }),
      ...range('2027-09-20', '2027-09-29', { block_type: 'o', block_ref_id: 'ref-o', block_end: '2027-10-10', block_rule_type: 'bd' }),
    ];
    const { holds } = mirrorRunsFromDays(rows, TODAY);
    assert.deepEqual(holds.map((h) => [h.kind, h.check_in, !!h.rolling]), [['closed_from_date', '2027-01-01', true], ['hold', '2027-09-20', false]]);
  });

  test('a booked stay on the last nights, over rows with no type yet: the last unknown run fails closed as rolling', () => {
    const rows = [...range('2026-11-02', '2027-09-25'), ...range('2027-09-25', '2027-09-29', { status: 'booked' })];
    const { holds } = mirrorRunsFromDays(rows, TODAY);
    assert.equal(holds[0].rolling, true);
  });

  test('a season that really ends before a hold at the edge stays bounded', () => {
    const rows = [
      ...range('2027-01-01', '2027-03-01', { block_rule_type: 'bd' }),
      day('2027-03-01', { status: 'available' }),
      ...range('2027-09-20', '2027-09-29', { block_type: 'o', block_ref_id: 'ref-o', block_end: '2027-10-10' }),
    ];
    assert.equal(mirrorRunsFromDays(rows, TODAY).holds[0].rolling, false);
  });

  test("the aggregate path lists a rolling closure with the same slack", () => {
    const g = row({ channel: 'block', status: 'block', hold_kind: 'guesty', channel_listing_id: 'L-guesty', ical_uid: 'aaaa_bd_2027-01-01_2028-09-27@guesty.com', check_in: '2027-01-01', check_out: '2027-06-01' });
    const c = run([g], [listing('guesty'), ...LISTINGS]);
    assert.deepEqual(c.guestyHoldsUncarried.map((r) => [r.check_out, r.rolling]), [['2029-03-24', true]]);
  });

  test('a carried season whose end the booking window nears is listed for a person; a far one is not', () => {
    const carried = (check_in: string, check_out: string) => row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'other', channel_listing_id: null, notes: `${CARRIED_SEASON_NOTE}: extend it before the booking window reaches its end`, check_in, check_out });
    const near = carried('2026-11-02', '2027-11-15');
    const far = carried('2028-01-01', '2029-03-24');
    const c = evaluateCarryover({ rows: [near, far], listings: LISTINGS, todayIso: TODAY, now: NOW, planWindowDays: 365, calendarAuthority: 'helm' });
    assert.deepEqual(ids(c.carriedSeasonsEnding), [near.id]);
    assert.equal(carryoverClear(c), true, 'a follow-up, never a flip blocker');
    const plain = row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, check_in: '2027-11-01', check_out: '2027-11-08' });
    assert.deepEqual(evaluateCarryover({ rows: [plain], listings: LISTINGS, todayIso: TODAY, now: NOW, planWindowDays: 365 }).carriedSeasonsEnding, []);
  });
});

describe('round 9: the tail rule needs contiguity; carried seasons are found however they were entered', () => {
  const day = (date: string, patch: Partial<MirrorDay> = {}): MirrorDay => ({ date, status: 'unavailable', block_type: null, block_rule_type: null, block_ref_id: null, block_note: null, ...patch });
  const range = (from: string, to: string, patch: Partial<MirrorDay> = {}) => {
    const out: MirrorDay[] = [];
    for (let d = from; d < to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(day(d, patch));
    return out;
  };

  test("a finished closure is not made rolling by an ordinary hold on the mirror's last night (79 Main's shape)", () => {
    const rows = [
      ...range('2026-12-31', '2027-06-01'),
      ...range('2027-06-01', '2027-09-20', { status: 'available' }),
      ...range('2027-09-20', '2027-09-29', { block_type: 'm', block_ref_id: 'ref-m' }),
    ];
    const { holds } = mirrorRunsFromDays(rows, TODAY);
    assert.equal(holds.find((h) => h.check_in === '2026-12-31')?.rolling, false);
    const typed = mirrorRunsFromDays([...range('2026-12-31', '2027-06-01', { block_rule_type: 'r' }), ...range('2027-06-01', '2027-09-20', { status: 'available' }), ...range('2027-09-20', '2027-09-29', { block_type: 'm', block_ref_id: 'ref-m' })], TODAY);
    assert.equal(typed.holds[0].rolling, false, 'the typed variant too');
  });

  test('a hold whose type differs from the closure beneath does not make it roll', () => {
    const rows = [...range('2027-01-01', '2027-09-20', { block_rule_type: 'r' }), ...range('2027-09-20', '2027-09-29', { block_type: 'm', block_ref_id: 'ref-m' })];
    assert.equal(mirrorRunsFromDays(rows, TODAY).holds[0].rolling, false, 'the hold carries no rule beneath it');
  });

  test('the flip is told which Helm blocks carry a rolling season, split around a stay or not', () => {
    const { holds, lastDate } = mirrorRunsFromDays(range('2026-11-02', '2027-09-30'), TODAY);
    const stay = row({ check_in: '2027-09-24', check_out: '2027-10-01' });
    const first = row({ id: 'B1', source: 'manual', channel: 'block', status: 'block', hold_kind: 'other', channel_listing_id: null, check_in: '2026-11-02', check_out: '2027-09-24' });
    const second = row({ id: 'B2', source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, check_in: '2027-10-01', check_out: '2029-03-24' });
    const c = evaluateCarryover({ rows: [stay, first, second], listings: LISTINGS, todayIso: TODAY, now: NOW, mirrorHolds: holds, mirrorLastDate: lastDate });
    assert.deepEqual(c.guestyHoldsUncarried, []);
    assert.deepEqual(c.carriedSeasonBlockIds, ['B2'], 'the block over the last night Helm could sell');
  });

  test("a noted block is running out where the season's cover ends, not where the block does (round 10)", () => {
    const noted = (id: string, check_in: string, check_out: string) =>
      row({ id, source: 'manual', channel: 'block', status: 'block', hold_kind: 'other', channel_listing_id: null, notes: `${CARRIED_SEASON_NOTE}: extend`, check_in, check_out });
    const first = noted('P1', '2026-11-02', '2027-09-24');
    const stay = row({ check_in: '2027-09-24', check_out: '2027-10-01' });
    const second = noted('P2', '2027-10-01', '2029-03-24');
    const ev = (rows: CarryRow[]) => evaluateCarryover({ rows, listings: LISTINGS, todayIso: TODAY, now: NOW, planWindowDays: 365 });
    assert.deepEqual(ev([first, stay, second]).carriedSeasonsEnding, [], 'the stay leads into the next carried block');
    const secondSoon = noted('P3', '2027-10-01', '2027-10-20');
    assert.deepEqual(ids(ev([first, stay, secondSoon]).carriedSeasonsEnding), ['P3'], 'the next carried block warns for itself, not the first');
    assert.deepEqual(ids(ev([first, stay]).carriedSeasonsEnding), ['P1'], 'a stay right after the season does not carry it on');
    const ownerWeek = row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, check_in: '2027-09-24', check_out: '2027-10-01' });
    assert.deepEqual(ids(ev([first, ownerWeek]).carriedSeasonsEnding), ['P1'], 'nor an owner week');
    const airbnbWindow = row({ status: 'block', hold_kind: 'ota', check_in: '2027-09-24', check_out: '2028-06-01' });
    assert.deepEqual(ids(ev([first, airbnbWindow]).carriedSeasonsEnding), ['P1'], "nor an OTA's own closure");
    assert.deepEqual(ids(ev([first]).carriedSeasonsEnding), ['P1']);
  });
});

describe('round 9: the handover reads a closure across its re-issued rows, and notes aggregate-path carriers', () => {
  test("a Booking.com guest's run re-issued under a new UID stays listed over the Airbnb stay sold in the race", () => {
    const first = bcomHold({ status: 'cancelled', cancelled_at: '2026-09-20T15:00:00Z', created_at: '2026-09-20T10:30:00Z', live_since: '2026-09-20T10:30:00Z', check_in: '2026-10-10', check_out: '2026-10-14' });
    const reissued = bcomHold({ created_at: '2026-09-20T14:30:00Z', live_since: '2026-09-20T14:30:00Z', check_in: '2026-10-10', check_out: '2026-10-16' });
    const race = row({ created_at: '2026-09-20T11:30:00Z', check_in: '2026-10-10', check_out: '2026-10-16' });
    assert.deepEqual(ids(run([first, reissued, race]).bookingComUnexplained), [reissued.id]);
    assert.deepEqual(run([reissued, race]).bookingComUnexplained, [], 'read alone, the re-issue hid the guest');
  });

  test('a Helm block over the last demanded night of a rolling aggregate closure is a carried season', () => {
    const g = row({ channel: 'block', status: 'block', hold_kind: 'guesty', channel_listing_id: 'L-guesty', ical_uid: 'aaaa_bd_2027-01-01_2028-09-27@guesty.com', check_in: '2027-01-01', check_out: '2028-09-27' });
    const helm = row({ id: 'HB', source: 'manual', channel: 'block', status: 'block', hold_kind: 'other', channel_listing_id: null, check_in: '2027-01-01', check_out: '2029-03-24' });
    const c = run([g, helm], [listing('guesty'), ...LISTINGS]);
    assert.deepEqual(c.guestyHoldsUncarried, []);
    assert.deepEqual(c.carriedSeasonBlockIds, ['HB']);
  });
});

describe('round 10: the operator confirms an echo; a season past the horizon is still demanded', () => {
  test('a closure over nights Helm holds is flagged held, and a confirmation for it as it is now clears it', () => {
    const closure = bcomHold({ created_at: '2026-09-30T10:00:00Z', live_since: '2026-09-30T10:00:00Z' });
    const helm = row({ source: 'manual', channel: 'block', status: 'block', hold_kind: 'owner', channel_listing_id: null, created_at: '2026-09-30T12:00:00Z' });
    const listed = run([closure, helm]);
    assert.deepEqual(ids(listed.bookingComUnexplained), [closure.id]);
    assert.deepEqual(listed.bookingComUnexplainedHeld, [closure.id]);
    const confirmed = { ...closure, echo_confirmed: echoFingerprint(closure) };
    assert.deepEqual(run([confirmed, helm]).bookingComUnexplained, []);
    const moved = { ...confirmed, check_out: '2026-10-15' };
    assert.deepEqual(ids(run([moved, { ...helm, check_out: '2026-10-15' }]).bookingComUnexplained), [closure.id], 'a moved closure is judged afresh');
    assert.deepEqual(ids(run([confirmed]).bookingComUnexplained), [closure.id], 'nothing Helm holds there now: the confirmation does not count');
    assert.deepEqual(run([closure]).bookingComUnexplainedHeld, [], 'not held: open it in the extranet instead');
  });

  test('a season closed from a date past the horizon is demanded from its first night, listed, and its block noted', () => {
    const g = row({ channel: 'block', status: 'block', hold_kind: 'guesty', channel_listing_id: 'L-guesty', ical_uid: 'aaaa_bd_2028-06-01_2028-09-26@guesty.com', check_in: '2028-06-01', check_out: '2028-09-26' });
    const c = run([g], [listing('guesty'), ...LISTINGS]);
    assert.deepEqual(c.guestyHoldsUncarried.map((r) => [r.check_in, r.check_out, r.rolling]), [['2028-06-01', '2029-06-01', true]]);
    const helm = row({ id: 'HB2', source: 'manual', channel: 'block', status: 'block', hold_kind: 'other', channel_listing_id: null, check_in: '2028-06-01', check_out: '2029-06-01' });
    const carried = run([g, helm], [listing('guesty'), ...LISTINGS]);
    assert.deepEqual(carried.guestyHoldsUncarried, []);
    assert.deepEqual(carried.carriedSeasonBlockIds, ['HB2']);
  });
});
