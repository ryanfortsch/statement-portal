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
  guessGuestNameFromIcal,
  isPlaceholderGuestName,
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
