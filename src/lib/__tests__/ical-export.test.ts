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
  guessChannelFromUserAgent,
  EXPORTABLE_STATUSES,
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

const build = (bookings: Booking[]) =>
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
