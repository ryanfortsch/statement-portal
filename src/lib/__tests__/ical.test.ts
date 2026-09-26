/**
 * The Airbnb confirmation code a direct feed hides in DESCRIPTION.
 *
 * Fixtures are the two real 20 Hammond rows of 2026-09-21 (#1568): Ashley
 * Dobransky's HMEFDNMS4Z and Lauren Foy's HMWM9T9STJ, both published as
 * SUMMARY "Reserved" with no guest name, the code reachable only through
 * the reservation link in DESCRIPTION.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  airbnbConfirmationCode,
  parseIcal,
  isBookingEvent,
  classifyIcalEvent,
  isBlockSummary,
  guessGuestNameFromIcal,
  isPlaceholderGuestName,
  type IcalEvent,
} from '../ical.ts';

const ASHLEY =
  'Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMEFDNMS4Z\nPhone Number (Last 4 Digits): 4905';
const LAUREN =
  'Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMWM9T9STJ\nPhone Number (Last 4 Digits): 5682';

describe('airbnbConfirmationCode', () => {
  test('reads the code out of the reservation link', () => {
    assert.equal(airbnbConfirmationCode(ASHLEY), 'HMEFDNMS4Z');
    assert.equal(airbnbConfirmationCode(LAUREN), 'HMWM9T9STJ');
  });

  test('no link, no code: null rather than a placeholder', () => {
    assert.equal(airbnbConfirmationCode(null), null);
    assert.equal(airbnbConfirmationCode(undefined), null);
    assert.equal(airbnbConfirmationCode(''), null);
    assert.equal(airbnbConfirmationCode('Phone Number (Last 4 Digits): 4905'), null);
    assert.equal(
      airbnbConfirmationCode('Reservation URL: https://www.airbnb.com/hosting/reservations/details/'),
      null,
    );
    // A VRBO-style description names the guest but links nothing.
    assert.equal(airbnbConfirmationCode('Reservation\nGuest: John Doe\nCheck-in: 2026-09-19'), null);
  });

  test('other Airbnb links are not reservation codes', () => {
    assert.equal(airbnbConfirmationCode('https://www.airbnb.com/hosting/reservations'), null);
    assert.equal(airbnbConfirmationCode('https://www.airbnb.com/rooms/12345'), null);
    assert.equal(airbnbConfirmationCode('https://www.airbnb.com/hosting/reservations/details'), null);
  });

  test('the code is the whole path segment and nothing after it', () => {
    assert.equal(
      airbnbConfirmationCode('https://www.airbnb.com/hosting/reservations/details/HMEFDNMS4Z?source=ical'),
      'HMEFDNMS4Z',
    );
    assert.equal(
      airbnbConfirmationCode('See https://www.airbnb.com/hosting/reservations/details/HMEFDNMS4Z. Phone 4905'),
      'HMEFDNMS4Z',
    );
    assert.equal(
      airbnbConfirmationCode('https://www.airbnb.com/hosting/reservations/details/HMEFDNMS4Z/'),
      'HMEFDNMS4Z',
    );
    assert.equal(
      airbnbConfirmationCode('Link: https://www.airbnb.com/hosting/reservations/details/HMEFDNMS4Z\n'),
      'HMEFDNMS4Z',
    );
  });

  test('uppercased, because the dedupe join is an exact match against Guesty', () => {
    assert.equal(
      airbnbConfirmationCode('https://airbnb.com/hosting/reservations/details/hmefdnms4z'),
      'HMEFDNMS4Z',
    );
  });

  test('the first link wins when a description carries two', () => {
    assert.equal(airbnbConfirmationCode(`${ASHLEY}\n${LAUREN}`), 'HMEFDNMS4Z');
  });
});

describe('through the feed parser', () => {
  // As Airbnb publishes it: CRLF line endings, the DESCRIPTION escaped and
  // folded at 75 octets, and a block with no DESCRIPTION at all.
  const ICS = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Airbnb Inc//Hosting Calendar 0.8.8//EN',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'DTSTAMP:20260921T120000Z',
    'DTSTART;VALUE=DATE:20260919',
    'DTEND;VALUE=DATE:20260922',
    'UID:1440e26e5ac0-6ce5bb3ef1bfb2c1cbd4b28fe8bd2c0e@airbnb.com',
    'SUMMARY:Reserved',
    'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/de',
    ' tails/HMEFDNMS4Z\\nPhone Number (Last 4 Digits): 4905',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTAMP:20260921T120000Z',
    'DTSTART;VALUE=DATE:20260925',
    'DTEND;VALUE=DATE:20260928',
    'UID:block-1@airbnb.com',
    'SUMMARY:Airbnb (Not available)',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  test('a folded, escaped DESCRIPTION still yields the code', () => {
    const events = parseIcal(ICS);
    assert.equal(events.length, 2);
    const [reserved, block] = events;
    assert.equal(reserved.summary, 'Reserved');
    assert.equal(reserved.description, ASHLEY);
    assert.equal(reserved.dtstart, '2026-09-19');
    assert.equal(reserved.dtend, '2026-09-22');
    assert.equal(isBookingEvent(reserved), true);
    assert.equal(airbnbConfirmationCode(reserved.description), 'HMEFDNMS4Z');
    // The block carries no DESCRIPTION, so no code.
    assert.equal(block.description, null);
    assert.equal(airbnbConfirmationCode(block.description), null);
  });

  test('the feed still names no guest, so guest_name stays untouched', () => {
    const [reserved] = parseIcal(ICS);
    assert.equal(guessGuestNameFromIcal(reserved), null);
    assert.equal(isPlaceholderGuestName(reserved.summary), true);
    // And the code must never be mistaken for a name.
    assert.equal(isPlaceholderGuestName('Reservation HMEFDNMS4Z'), true);
  });
});

describe('classifyIcalEvent: what each OTA feed means by its SUMMARY', () => {
  // The event shapes each feed actually publishes. The old isBookingEvent
  // dropped every summary containing "available" (so the Airbnb and
  // Booking.com blocks below vanished) and the sync stored whatever was
  // left as confirmed (so the VRBO "Blocked" became a guest).
  const ev = (summary: string | null, description: string | null = null, cancelled = false): IcalEvent => ({
    uid: 'u',
    summary,
    description,
    url: null,
    dtstart: '2026-09-01',
    dtend: '2026-09-05',
    cancelled,
    raw: {},
  });

  test('Airbnb: Reserved with a reservation link is a stay', () => {
    assert.equal(classifyIcalEvent(ev('Reserved', ASHLEY), 'airbnb'), 'stay');
    assert.equal(classifyIcalEvent(ev('Reserved'), 'airbnb'), 'stay');
    // Summary lost but the link survived: still a stay.
    assert.equal(classifyIcalEvent(ev(null, ASHLEY), 'airbnb'), 'stay');
  });

  test('Airbnb: "Airbnb (Not available)" is a block, as is anything unnamed', () => {
    assert.equal(classifyIcalEvent(ev('Airbnb (Not available)'), 'airbnb'), 'block');
    assert.equal(classifyIcalEvent(ev('Not available'), 'airbnb'), 'block');
    assert.equal(classifyIcalEvent(ev('Unavailable'), 'airbnb'), 'block');
    assert.equal(classifyIcalEvent(ev('Blocked'), 'airbnb'), 'block');
    assert.equal(classifyIcalEvent(ev(null), 'airbnb'), 'block');
  });

  test('VRBO: Blocked is a block; Reserved, a Guest: line or a bare name is a stay', () => {
    assert.equal(classifyIcalEvent(ev('Blocked'), 'vrbo'), 'block');
    assert.equal(classifyIcalEvent(ev('Unavailable'), 'vrbo'), 'block');
    assert.equal(classifyIcalEvent(ev('Not available'), 'vrbo'), 'block');
    assert.equal(classifyIcalEvent(ev('Closed'), 'vrbo'), 'block');
    assert.equal(classifyIcalEvent(ev('Reserved'), 'vrbo'), 'stay');
    assert.equal(classifyIcalEvent(ev('Reserved - Guest: John Doe'), 'vrbo'), 'stay');
    assert.equal(classifyIcalEvent(ev('Reservation'), 'vrbo'), 'stay');
    assert.equal(classifyIcalEvent(ev(null, 'Reservation\nGuest: John Doe\nCheck-in: 2026-09-01'), 'vrbo'), 'stay');
    assert.equal(classifyIcalEvent(ev('John Doe'), 'vrbo'), 'stay');
  });

  test('Booking.com: "CLOSED - Not available" is a block, a named event a stay', () => {
    assert.equal(classifyIcalEvent(ev('CLOSED - Not available'), 'booking_com'), 'block');
    assert.equal(classifyIcalEvent(ev('Unavailable'), 'booking_com'), 'block');
    assert.equal(classifyIcalEvent(ev('Jane Roe'), 'booking_com'), 'stay');
    assert.equal(classifyIcalEvent(ev('Reservation'), 'booking_com'), 'stay');
  });

  test('a bare Available / Open is a skip on every channel, as is a cancelled event', () => {
    for (const channel of ['airbnb', 'vrbo', 'booking_com', 'guesty', 'direct', 'manual', 'other']) {
      assert.equal(classifyIcalEvent(ev('Available'), channel), 'skip', `Available on ${channel}`);
      assert.equal(classifyIcalEvent(ev('Open'), channel), 'skip', `Open on ${channel}`);
      assert.equal(classifyIcalEvent(ev(' available '), channel), 'skip', `padded Available on ${channel}`);
      assert.equal(classifyIcalEvent(ev('Reserved', null, true), channel), 'skip', `cancelled on ${channel}`);
    }
  });

  test('the Guesty aggregate feed keeps its own path, byte-identical to before', () => {
    assert.equal(classifyIcalEvent(ev('Reservation HMEFDNMS4Z'), 'guesty'), 'stay');
    assert.equal(classifyIcalEvent(ev('Reservation BC-Wz2rvkB8x'), 'guesty'), 'stay');
    assert.equal(classifyIcalEvent(ev('Blocked by Guesty'), 'guesty'), 'block');
    assert.equal(classifyIcalEvent(ev('Owner stay'), 'guesty'), 'block');
    // The old filter dropped any summary containing "available"; the
    // aggregate feed keeps that so Guesty-managed homes see no new rows.
    assert.equal(classifyIcalEvent(ev('Not available'), 'guesty'), 'skip');
  });

  test('direct / manual / other: a stay unless the summary carries a hold keyword', () => {
    assert.equal(classifyIcalEvent(ev('Reserved'), 'direct'), 'stay');
    assert.equal(classifyIcalEvent(ev('Pat Lee'), 'other'), 'stay');
    assert.equal(classifyIcalEvent(ev('Blocked'), 'direct'), 'block');
    assert.equal(classifyIcalEvent(ev('Not available'), 'manual'), 'block');
  });

  test('isBookingEvent is now "anything worth storing": a block is kept, only a skip is dropped', () => {
    assert.equal(isBookingEvent(ev('Reserved')), true);
    assert.equal(isBookingEvent(ev('Airbnb (Not available)')), true);
    assert.equal(isBookingEvent(ev('Available')), false);
    assert.equal(isBookingEvent(ev('Reserved', null, true)), false);
  });
});

describe('isBlockSummary: the same hold test over a stored raw_summary', () => {
  test('every hold fixture reads as a block', () => {
    for (const raw of ['Airbnb (Not available)', 'Not available', 'Unavailable', 'Blocked', 'Block', 'CLOSED - Not available', 'Closed', 'Blocked by Guesty']) {
      assert.equal(isBlockSummary(raw), true, raw);
    }
  });

  test('a stay never does', () => {
    for (const raw of ['Reserved', 'Reservation HMEFDNMS4Z', 'Reserved - Guest: John Doe', 'John Doe', 'Jane Roe', '', null, undefined]) {
      assert.equal(isBlockSummary(raw), false, String(raw));
    }
  });

  test('and it agrees with the classifier on the direct feeds', () => {
    const ev = (summary: string): IcalEvent => ({ uid: 'u', summary, description: null, url: null, dtstart: '2026-09-01', dtend: '2026-09-05', cancelled: false, raw: {} });
    for (const [summary, channel] of [
      ['Airbnb (Not available)', 'airbnb'],
      ['Blocked', 'vrbo'],
      ['CLOSED - Not available', 'booking_com'],
    ] as const) {
      assert.equal(classifyIcalEvent(ev(summary), channel), 'block');
      assert.equal(isBlockSummary(summary), true);
    }
    for (const [summary, channel] of [
      ['Reserved', 'airbnb'],
      ['Reserved', 'vrbo'],
      ['Jane Roe', 'booking_com'],
    ] as const) {
      assert.equal(classifyIcalEvent(ev(summary), channel), 'stay');
      assert.equal(isBlockSummary(summary), false);
    }
  });
});
