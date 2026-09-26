/**
 * What Helm's iCal export tells the OTAs, and what it must not.
 *
 * Only rows that hold nights (confirmed / completed / block) and stand
 * canonical are exported; an inquiry, a pending request, a cancelled row
 * or a duplicate blocks nothing. And the event carries no guest name and
 * no operator notes: the URL is a bearer token held by three OTAs.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIcalExport,
  exportableBooking,
  exportPullState,
  guessChannelFromUserAgent,
  EXPORTABLE_STATUSES,
  EXPORT_HOLD_FILTER,
  EXPORT_FOR_CHANNELS,
  exportUrlFor,
  exportUrlForListing,
  parseExportFor,
  resolveExportAudience,
  type ExportBooking,
} from '../ical-export.ts';
import type { Booking } from '../channels-types.ts';

function booking(over: Partial<Booking> & { id: string }): Booking {
  return {
    property_id: 'helm_home',
    channel_listing_id: null,
    channel: 'vrbo',
    source: 'ical_import',
    external_booking_id: null,
    external_confirmation_code: null,
    ical_uid: null,
    check_in: '2026-10-10',
    check_out: '2026-10-14',
    nights: 4,
    status: 'confirmed',
    guest_name: null,
    guest_email: null,
    guest_phone: null,
    num_guests: null,
    num_adults: null,
    num_children: null,
    gross_amount: null,
    cleaning_fee: null,
    service_fee: null,
    taxes: null,
    payout: null,
    currency: 'USD',
    raw_summary: null,
    raw_description: null,
    raw_url: null,
    notes: null,
    duplicate_of: null,
    first_seen_at: '2026-09-01T00:00:00Z',
    last_seen_at: '2026-09-01T00:00:00Z',
    cancelled_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

const build = (bookings: ExportBooking[]) =>
  buildIcalExport({ propertyName: '65 Calderwood', propertyAddress: '65 Calderwood Street', bookings });

const uids = (ics: string) => [...ics.matchAll(/^UID:([^@\r\n]+)@/gm)].map((m) => m[1]);

describe('what is exported', () => {
  test('a confirmed stay, a completed stay and a block are; nothing else is', () => {
    const rows = [
      booking({ id: 'confirmed', status: 'confirmed' }),
      booking({ id: 'completed', status: 'completed', check_in: '2026-09-01', check_out: '2026-09-05' }),
      booking({ id: 'block', status: 'block', source: 'manual', channel: 'block', check_in: '2026-11-01', check_out: '2026-11-03' }),
      booking({ id: 'inquiry', status: 'inquiry', check_in: '2026-12-01', check_out: '2026-12-05' }),
      booking({ id: 'pending', status: 'pending', check_in: '2026-12-10', check_out: '2026-12-15' }),
      booking({ id: 'cancelled', status: 'cancelled', cancelled_at: '2026-09-10T00:00:00Z', check_in: '2027-01-01', check_out: '2027-01-05' }),
    ];
    assert.deepEqual(uids(build(rows)).sort(), ['block', 'completed', 'confirmed']);
    assert.deepEqual([...EXPORTABLE_STATUSES], ['confirmed', 'completed', 'block']);
  });

  test('a duplicate of a stay is absent: the stay itself already holds the nights', () => {
    const rows = [
      booking({ id: 'canonical', channel: 'vrbo', guest_name: 'John Doe' }),
      booking({ id: 'echo', channel: 'airbnb', status: 'block', duplicate_of: 'canonical', raw_summary: 'Airbnb (Not available)' }),
      booking({ id: 'twin', source: 'guesty_legacy', duplicate_of: 'canonical' }),
    ];
    assert.deepEqual(uids(build(rows)), ['canonical']);
  });

  test('exportableBooking is the same gate, row by row', () => {
    assert.equal(exportableBooking(booking({ id: 'a' })), true);
    assert.equal(exportableBooking(booking({ id: 'a', status: 'completed' })), true);
    assert.equal(exportableBooking(booking({ id: 'a', status: 'block' })), true);
    assert.equal(exportableBooking(booking({ id: 'a', status: 'inquiry' })), false);
    assert.equal(exportableBooking(booking({ id: 'a', status: 'pending' })), false);
    assert.equal(exportableBooking(booking({ id: 'a', status: 'cancelled' })), false);
    assert.equal(exportableBooking(booking({ id: 'a', duplicate_of: 'b' })), false);
    assert.equal(exportableBooking({ status: 'confirmed', duplicate_of: null, check_in: null, check_out: '2026-10-14' }), false);
    assert.equal(exportableBooking({ status: 'confirmed', duplicate_of: null, check_in: '2026-10-14', check_out: '2026-10-14' }), false, 'zero nights');
  });
});

describe('OTA holds: echoes go nowhere, real holds go to every other channel', () => {
  // A block row with hold_kind 'ota' is what ical-sync stores from an OTA's
  // own feed on a Helm-run home. echo_seen_at is set when it first appeared
  // on nights Helm was already holding (lib/ical-echo.ts).
  const ota = (over: Partial<Booking> & { id: string }, echo_seen_at: string | null = null): ExportBooking => ({
    ...booking({ status: 'block', channel: 'airbnb', raw_summary: 'Airbnb (Not available)', ...over }),
    hold_kind: 'ota',
    echo_seen_at,
  });
  const held = (id: string, hold_kind: string | null, over: Partial<Booking> = {}): ExportBooking => ({
    ...booking({ id, status: 'block', source: 'manual', channel: 'block', check_in: '2026-11-01', check_out: '2026-11-03', ...over }),
    hold_kind,
  });
  const feed = (rows: ExportBooking[], forChannel: string | null) =>
    uids(buildIcalExport({ propertyName: '65 Calderwood', propertyAddress: '65 Calderwood Court', bookings: rows, forChannel })).sort();
  const ECHOED = '2026-10-01T00:00:00Z';

  test('a stamped echo is in no feed; Helm holds are in every feed', () => {
    const rows: ExportBooking[] = [
      ota({ id: 'airbnb-echo' }, ECHOED),
      ota({ id: 'bcom-echo', channel: 'booking_com', raw_summary: 'CLOSED - Not available' }, ECHOED),
      ota({ id: 'vrbo-echo', channel: 'vrbo', raw_summary: 'Blocked' }, ECHOED),
      held('owner', 'owner'),
      held('maintenance', 'maintenance', { check_in: '2026-11-05', check_out: '2026-11-06' }),
      held('other', 'other', { check_in: '2026-11-07', check_out: '2026-11-08' }),
      held('legacy', null, { check_in: '2026-11-09', check_out: '2026-11-10' }),
    ];
    for (const ch of [null, 'airbnb', 'vrbo', 'booking_com']) {
      assert.deepEqual(feed(rows, ch), ['legacy', 'maintenance', 'other', 'owner'], String(ch));
    }
  });

  test('a Booking.com reservation (an unstamped CLOSED hold) closes Airbnb and VRBO, and is not sent back to Booking.com', () => {
    // Booking.com's iCal publishes a real booking as "CLOSED - Not available".
    // Dropping it from the export would let Airbnb and VRBO sell the nights.
    const rows = [ota({ id: 'R', channel: 'booking_com', raw_summary: 'CLOSED - Not available' })];
    assert.deepEqual(feed(rows, 'airbnb'), ['R']);
    assert.deepEqual(feed(rows, 'vrbo'), ['R']);
    assert.deepEqual(feed(rows, 'booking_com'), []);
    assert.deepEqual(feed(rows, null), ['R']);
  });

  test("an owner block set in the Airbnb app reaches VRBO and Booking.com but never goes back to Airbnb", () => {
    // Sent back, Airbnb would hold it because Helm said so, keep publishing
    // it after the operator unblocked, and the nights would never reopen.
    const rows = [ota({ id: 'G' })];
    assert.deepEqual(feed(rows, 'airbnb'), []);
    assert.deepEqual(feed(rows, 'vrbo'), ['G']);
    assert.deepEqual(feed(rows, 'booking_com'), ['G']);
  });

  test("a channel's feed leaves out that channel's own stays too; every other stay is in it", () => {
    const rows = [
      booking({ id: 'air-stay', channel: 'airbnb' }),
      booking({ id: 'vrbo-stay', channel: 'vrbo', check_in: '2026-10-20', check_out: '2026-10-22' }),
      booking({ id: 'direct-stay', channel: 'direct', source: 'direct_booking', check_in: '2026-10-25', check_out: '2026-10-27' }),
    ];
    assert.deepEqual(feed(rows, 'airbnb'), ['direct-stay', 'vrbo-stay']);
    assert.deepEqual(feed(rows, 'vrbo'), ['air-stay', 'direct-stay']);
    assert.deepEqual(feed(rows, null), ['air-stay', 'direct-stay', 'vrbo-stay']);
  });

  test('the echo loop: once the stay that caused them is cancelled, its echoes publish nothing anywhere', () => {
    // VRBO stay S cancelled; Airbnb's and Booking.com's echoes of Helm's
    // export stand canonical again. Stamped at first sight, they go nowhere,
    // so the OTAs reopen the nights and the echoes age out.
    const rows: ExportBooking[] = [
      booking({ id: 'S', channel: 'vrbo', status: 'cancelled', cancelled_at: '2026-10-01T00:00:00Z' }),
      ota({ id: 'A' }, ECHOED),
      ota({ id: 'B', channel: 'booking_com', raw_summary: 'CLOSED - Not available' }, ECHOED),
    ];
    for (const ch of [null, 'airbnb', 'vrbo', 'booking_com']) assert.deepEqual(feed(rows, ch), [], String(ch));
  });

  test('exportableBooking applies the same rules row by row', () => {
    const base = { duplicate_of: null, check_in: '2026-10-10', check_out: '2026-10-12' };
    assert.equal(exportableBooking({ ...base, status: 'block', channel: 'airbnb', hold_kind: 'ota', echo_seen_at: ECHOED }), false);
    assert.equal(exportableBooking({ ...base, status: 'block', channel: 'airbnb', hold_kind: 'ota', echo_seen_at: null }), true);
    assert.equal(exportableBooking({ ...base, status: 'block', channel: 'airbnb', hold_kind: 'ota', echo_seen_at: null }, 'airbnb'), false);
    assert.equal(exportableBooking({ ...base, status: 'block', hold_kind: 'owner' }), true);
    assert.equal(exportableBooking({ ...base, status: 'block', hold_kind: null }), true);
    assert.equal(exportableBooking({ ...base, status: 'block' }), true);
    // echo_seen_at only means something on an OTA block: a stay carrying it still exports.
    assert.equal(exportableBooking({ ...base, status: 'confirmed', channel: 'vrbo', hold_kind: 'ota', echo_seen_at: ECHOED }), true);
  });

  test("the route's query filter keeps null hold_kind and unstamped OTA holds", () => {
    assert.equal(EXPORT_HOLD_FILTER, 'status.neq.block,hold_kind.is.null,hold_kind.neq.ota,echo_seen_at.is.null');
  });

  test('parseExportFor accepts the three OTAs only; exportUrlFor appends for=', () => {
    assert.equal(parseExportFor('airbnb'), 'airbnb');
    assert.equal(parseExportFor(' VRBO '), 'vrbo');
    assert.equal(parseExportFor('booking_com'), 'booking_com');
    assert.equal(parseExportFor('direct'), null);
    assert.equal(parseExportFor(''), null);
    assert.equal(parseExportFor(null), null);
    assert.deepEqual([...EXPORT_FOR_CHANNELS], ['airbnb', 'vrbo', 'booking_com']);
    assert.equal(exportUrlFor('https://helm.example/api/channels/ical/tok', 'vrbo'), 'https://helm.example/api/channels/ical/tok?for=vrbo');
    assert.equal(exportUrlFor('https://helm.example/x?a=1', 'airbnb'), 'https://helm.example/x?a=1&for=airbnb');
  });
});

describe('what an event says', () => {
  const stay = booking({
    id: 'stay-1',
    channel: 'vrbo',
    guest_name: 'John Doe',
    guest_email: 'john@example.com',
    guest_phone: '+19785550100',
    notes: 'Late arrival, code in the lockbox',
    raw_description: 'Reservation\nGuest: John Doe',
  });
  const block = booking({ id: 'hold-1', status: 'block', source: 'manual', channel: 'block', notes: 'Owner painting the deck' });

  test('a stay is SUMMARY Reserved, a block is SUMMARY Blocked', () => {
    const ics = build([stay, block]);
    assert.match(ics, /^SUMMARY:Reserved\r?$/m);
    assert.match(ics, /^SUMMARY:Blocked\r?$/m);
    assert.doesNotMatch(ics, /SUMMARY:Block -/);
    assert.doesNotMatch(ics, /SUMMARY:Reserved \(/);
  });

  test('DESCRIPTION is the channel and the Helm id, nothing else', () => {
    const ics = build([stay, block]);
    assert.match(ics, /^DESCRIPTION:Channel: VRBO\\nHelm: stay-1\r?$/m);
    assert.match(ics, /^DESCRIPTION:Channel: Block\\nHelm: hold-1\r?$/m);
  });

  test('no guest name, contact or note reaches the feed', () => {
    const ics = build([stay, block]);
    assert.doesNotMatch(ics, /John/);
    assert.doesNotMatch(ics, /Doe/);
    assert.doesNotMatch(ics, /example\.com/);
    assert.doesNotMatch(ics, /9785550100/);
    assert.doesNotMatch(ics, /lockbox/i);
    assert.doesNotMatch(ics, /painting/i);
    assert.doesNotMatch(ics, /Guest:/);
    assert.doesNotMatch(ics, /Status:/);
  });

  test('dates, transparency and the envelope are intact', () => {
    const ics = build([stay]);
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /END:VCALENDAR\r\n$/);
    assert.match(ics, /^DTSTART;VALUE=DATE:20261010\r?$/m);
    assert.match(ics, /^DTEND;VALUE=DATE:20261014\r?$/m);
    assert.match(ics, /^TRANSP:OPAQUE\r?$/m);
    assert.match(ics, /^STATUS:CONFIRMED\r?$/m);
    assert.match(ics, /^UID:stay-1@helm\.risingtidestr\.com\r?$/m);
    assert.doesNotMatch(ics, /\u2014/, 'no em dash');
  });

  test('a semicolon or comma in the property name is escaped per RFC 5545', () => {
    const ics = buildIcalExport({ propertyName: 'Stay; at, Home', propertyAddress: 'x', bookings: [] });
    assert.match(ics, /X-WR-CALNAME:Stay\\; at\\, Home - Helm/);
  });

  test('an empty book is a valid, empty calendar', () => {
    const ics = build([]);
    assert.doesNotMatch(ics, /BEGIN:VEVENT/);
    assert.match(ics, /^BEGIN:VCALENDAR/);
  });
});

describe('guessChannelFromUserAgent', () => {
  test('names the OTA when the agent does', () => {
    assert.equal(guessChannelFromUserAgent('Airbnb/1.0 Calendar Sync'), 'airbnb');
    assert.equal(guessChannelFromUserAgent('Vrbo Calendar Import'), 'vrbo');
    assert.equal(guessChannelFromUserAgent('HomeAway iCal fetcher'), 'vrbo');
    assert.equal(guessChannelFromUserAgent('Booking.com Calendar Sync'), 'booking_com');
  });

  test('null for anything else', () => {
    assert.equal(guessChannelFromUserAgent('Mozilla/5.0 (Macintosh)'), null);
    assert.equal(guessChannelFromUserAgent('curl/8.4.0'), null);
    assert.equal(guessChannelFromUserAgent(''), null);
    assert.equal(guessChannelFromUserAgent(null), null);
    assert.equal(guessChannelFromUserAgent(undefined), null);
  });
});

describe('exportPullState: pulled, never, or unknown', () => {
  const pulls = new Map([
    [
      'home_a',
      [
        { channel_guess: null, pulled_at: '2026-09-26T14:55:00Z' },
        { channel_guess: 'airbnb', pulled_at: '2026-09-26T14:00:00Z' },
        { channel_guess: 'airbnb', pulled_at: '2026-09-26T12:00:00Z' },
        { channel_guess: 'vrbo', pulled_at: '2026-09-26T08:00:00Z' },
      ],
    ],
    ['home_b', []],
  ]);

  test("a property read with a matching pull reads 'pulled', newest first", () => {
    assert.deepEqual(exportPullState(pulls, 'home_a', 'airbnb'), { state: 'pulled', pull: { channel_guess: 'airbnb', pulled_at: '2026-09-26T14:00:00Z' } });
    assert.deepEqual(exportPullState(pulls, 'home_a', 'vrbo'), { state: 'pulled', pull: { channel_guess: 'vrbo', pulled_at: '2026-09-26T08:00:00Z' } });
    assert.deepEqual(exportPullState(pulls, 'home_a', null), { state: 'pulled', pull: { channel_guess: null, pulled_at: '2026-09-26T14:55:00Z' } });
    assert.deepEqual(exportPullState(pulls, 'home_a'), { state: 'pulled', pull: { channel_guess: null, pulled_at: '2026-09-26T14:55:00Z' } }, 'any channel');
  });

  test("a property read with no matching pull reads 'never'", () => {
    assert.deepEqual(exportPullState(pulls, 'home_a', 'booking_com'), { state: 'never' });
    assert.deepEqual(exportPullState(pulls, 'home_b', 'airbnb'), { state: 'never' });
    assert.deepEqual(exportPullState(pulls, 'home_b'), { state: 'never' });
  });

  test("a property absent from the map reads 'unknown', never 'never'", () => {
    assert.deepEqual(exportPullState(pulls, 'home_c', 'airbnb'), { state: 'unknown' });
    assert.deepEqual(exportPullState(new Map(), 'home_a'), { state: 'unknown' });
  });
});

describe('resolveExportAudience: who a pull is for', () => {
  const listings = [
    { id: 'L-air', channel: 'airbnb' },
    { id: 'L-vrbo', channel: 'vrbo' },
    { id: 'L-other-1', channel: 'other' },
    { id: 'L-other-2', channel: 'other' },
  ];
  const AIRBNB_UA = 'Airbnb iCal Fetcher/1.0';
  const VRBO_UA = 'Vrbo-Calendar-Sync';

  test('for= names the channel and its one listing', () => {
    const a = resolveExportAudience({ forParam: 'airbnb', listingParam: null, userAgent: null, listings });
    assert.deepEqual([a.channel, a.listingId, a.mismatch], ['airbnb', 'L-air', false]);
  });

  test('listing= names an other platform exactly; its channel is not used to exclude rows', () => {
    const a = resolveExportAudience({ forParam: null, listingParam: 'L-other-2', userAgent: null, listings });
    assert.deepEqual([a.channel, a.listingId, a.requestedFor], ['other', 'L-other-2', 'other']);
  });

  test('a bare URL falls back to the user agent', () => {
    const a = resolveExportAudience({ forParam: null, listingParam: null, userAgent: VRBO_UA, listings });
    assert.deepEqual([a.channel, a.listingId, a.requestedFor], ['vrbo', 'L-vrbo', null]);
  });

  test('the Airbnb line pasted into VRBO is served for nobody and flagged', () => {
    const a = resolveExportAudience({ forParam: 'airbnb', listingParam: null, userAgent: VRBO_UA, listings });
    assert.deepEqual([a.channel, a.listingId, a.requestedFor, a.uaGuess, a.mismatch], [null, null, 'airbnb', 'vrbo', true]);
  });

  test('an agreeing user agent is no mismatch; an unknown listing id is ignored', () => {
    assert.equal(resolveExportAudience({ forParam: 'airbnb', listingParam: null, userAgent: AIRBNB_UA, listings }).mismatch, false);
    const a = resolveExportAudience({ forParam: null, listingParam: 'not-mine', userAgent: null, listings });
    assert.deepEqual([a.channel, a.listingId], [null, null]);
  });
});

describe('listing-scoped feeds', () => {
  const otherHold = (id: string, listing: string): ExportBooking => ({
    ...booking({ id, status: 'block', channel: 'other', channel_listing_id: listing }),
    hold_kind: 'ota',
    echo_seen_at: null,
  });
  const rows = [otherHold('O1', 'L-other-1'), otherHold('O2', 'L-other-2'), booking({ id: 'V', channel: 'vrbo' })];
  const feedFor = (listingId: string | null, channel: string | null) =>
    uids(buildIcalExport({ propertyName: 'x', propertyAddress: 'x', bookings: rows, forChannel: channel, forListingId: listingId })).sort();

  test("an other platform's feed leaves out its own rows but keeps the other other platform's", () => {
    assert.deepEqual(feedFor('L-other-1', 'other'), ['O2', 'V']);
    assert.deepEqual(feedFor('L-other-2', 'other'), ['O1', 'V']);
  });

  test("a named OTA's feed carries every other platform's rows", () => {
    assert.deepEqual(feedFor(null, 'vrbo'), ['O1', 'O2']);
  });

  test('exportUrlForListing encodes the id', () => {
    assert.equal(exportUrlForListing('https://h/api/channels/ical/t', 'a b'), 'https://h/api/channels/ical/t?listing=a%20b');
  });
});
