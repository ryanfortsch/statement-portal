/**
 * Minimal RFC 5545 iCalendar parser, plus the per-channel event classifier.
 *
 * Scoped to the .ics feeds Airbnb / VRBO / Booking.com publish: all-day
 * VEVENT blocks with a UID, DTSTART, DTEND, SUMMARY, DESCRIPTION. Not a
 * general-purpose parser: RRULE, timezones beyond UTC, alarms, and
 * VTODO/VJOURNAL are ignored.
 *
 * No external dependency: each OTA's feed is small (kilobytes), the
 * format is line-oriented, and we only need maybe a dozen properties.
 *
 * Import-free at runtime on purpose (the one import below is a type), so
 * `npm test` exercises the classifier with no bundler and no database.
 */

import type { BookingChannel } from '@/lib/channels-types';

export type IcalEvent = {
  uid: string;
  summary: string | null;
  description: string | null;
  url: string | null;
  /** Inclusive check-in date, YYYY-MM-DD. */
  dtstart: string;
  /** Exclusive check-out date, YYYY-MM-DD (matches iCal semantics). */
  dtend: string;
  cancelled: boolean;
  /** Raw property -> first-occurrence value, for debugging unusual feeds. */
  raw: Record<string, string>;
};

export function parseIcal(text: string): IcalEvent[] {
  const lines = unfoldLines(text);
  const events: IcalEvent[] = [];
  let current: (Partial<IcalEvent> & { raw: Record<string, string> }) | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = { raw: {}, cancelled: false };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.uid && current.dtstart && current.dtend) {
        events.push({
          uid: current.uid,
          summary: current.summary ?? null,
          description: current.description ?? null,
          url: current.url ?? null,
          dtstart: current.dtstart,
          dtend: current.dtend,
          cancelled: current.cancelled ?? false,
          raw: current.raw,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const lhs = line.slice(0, colon);
    const rhs = line.slice(colon + 1);
    const semi = lhs.indexOf(';');
    const prop = (semi >= 0 ? lhs.slice(0, semi) : lhs).toUpperCase();

    current.raw[prop] = rhs;

    switch (prop) {
      case 'UID':
        current.uid = rhs.trim();
        break;
      case 'SUMMARY':
        current.summary = unescapeText(rhs);
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(rhs);
        break;
      case 'URL':
        current.url = rhs.trim();
        break;
      case 'DTSTART':
        current.dtstart = parseIcalDate(rhs);
        break;
      case 'DTEND':
        current.dtend = parseIcalDate(rhs);
        break;
      case 'STATUS':
        if (rhs.trim().toUpperCase() === 'CANCELLED') current.cancelled = true;
        break;
    }
  }
  return events;
}

/**
 * RFC 5545 §3.1: a CRLF followed by a single linear-white-space character
 * is a "line fold": collapse the next line into the previous one.
 */
function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.length > 0);
}

function parseIcalDate(value: string): string {
  // Forms: "20260515", "20260515T140000Z", "20260515T140000".
  // We only care about the date portion since OTA feeds are all-day events.
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return value;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * What an imported event IS, per channel.
 *
 *   stay   a guest holds the nights: store it as a confirmed booking
 *   block  the nights are held but nobody is coming: store it as a block
 *   skip   nothing to store (cancelled, or an "Available" marker)
 *
 * The old isBookingEvent dropped any SUMMARY containing "available", which
 * threw away Airbnb's "Airbnb (Not available)" and Booking.com's
 * "CLOSED - Not available" blocks, and the sync then stored whatever
 * survived as a confirmed stay, so a VRBO "Blocked" event became a guest
 * who never existed (a turnover scheduled, a double-booking reported).
 * Each OTA labels its feed differently, so the verdict is per channel:
 *
 *   airbnb       "Reserved" (or a reservation link in DESCRIPTION) is a
 *                stay; "Airbnb (Not available)", "Unavailable", "Blocked"
 *                and anything else unnamed is a block. Airbnb publishes
 *                nothing but those two shapes.
 *   vrbo         "Reserved" / "Reservation ..." / a "Guest:" line in
 *                DESCRIPTION / a bare guest name is a stay; "Blocked",
 *                "Unavailable", "Not available", "Closed" is a block.
 *   booking_com  "CLOSED - Not available" / "Unavailable" is a block,
 *                everything else (the guest name, "Reservation") a stay.
 *   guesty       the aggregate feed keeps its own path: "Reservation
 *                <code>" is a stay, any other summary a block, and a
 *                summary containing "available" is skipped exactly as
 *                before, so every Guesty-managed home keeps today's rows.
 *   direct / manual / other / block
 *                a stay unless the summary carries a hold keyword.
 *
 * A bare "Available" / "Open" summary is skipped on every channel: it is
 * the feed saying the nights are free.
 */
export type IcalEventKind = 'stay' | 'block' | 'skip';

const BARE_AVAILABLE = /^\W*(available|open)\W*$/i;
const HOLD_KEYWORD = /\b(not\s*available|unavailable|block(?:ed)?|closed)\b/i;

export function classifyIcalEvent(event: IcalEvent, channel: BookingChannel | string): IcalEventKind {
  if (event.cancelled) return 'skip';
  const summary = (event.summary ?? '').trim();
  if (BARE_AVAILABLE.test(summary)) return 'skip';
  const description = event.description ?? '';

  switch (channel) {
    case 'airbnb': {
      if (/^reserved\b/i.test(summary)) return 'stay';
      if (airbnbConfirmationCode(description)) return 'stay';
      // "Airbnb (Not available)", "Unavailable", "Blocked", or any other
      // unnamed shape: Airbnb's feed has no third kind.
      return 'block';
    }
    case 'vrbo': {
      if (/^(reserved|reservation)\b/i.test(summary) || /\bGuest:/i.test(description)) return 'stay';
      if (HOLD_KEYWORD.test(summary)) return 'block';
      // The bare guest name VRBO sometimes publishes. An empty summary is
      // also a stay: VRBO labels every hold, so unlabeled means a guest.
      return 'stay';
    }
    case 'booking_com': {
      if (/^closed\b/i.test(summary) || /not\s*available|unavailable/i.test(summary)) return 'block';
      return 'stay';
    }
    case 'guesty': {
      // Unchanged aggregate-feed path (see parseGuestySummary in ical-sync):
      // the "available" drop is today's behaviour and stays byte-identical.
      if (summary.toLowerCase().includes('available')) return 'skip';
      return /^Reservation\s+\S+/i.test(summary) ? 'stay' : 'block';
    }
    default: {
      return HOLD_KEYWORD.test(summary) ? 'block' : 'stay';
    }
  }
}

/**
 * The same hold-keyword test over a stored `bookings.raw_summary`, for the
 * dedupe (a hold never date-joins a stay) and the cancel pass (a hold a
 * direct feed stored as confirmed before the classifier is reclassified,
 * never treated as a stay cancel). "Reserved", "Reservation <code>" and a
 * guest name are not holds; "Airbnb (Not available)", "CLOSED - Not
 * available", "Blocked", "Unavailable" are.
 */
export function isBlockSummary(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return HOLD_KEYWORD.test(raw);
}

/**
 * @deprecated Use classifyIcalEvent(event, channel). Kept for one release
 * as "anything worth storing": true for a stay OR a block, false only for a
 * skip. Note this is wider than the old test, which also dropped every
 * summary containing "available" and so lost the OTA blocks.
 */
export function isBookingEvent(event: IcalEvent): boolean {
  return classifyIcalEvent(event, 'other') !== 'skip';
}

/**
 * True when a guest_name isn't a real person's name but a feed placeholder.
 * Airbnb's iCal carries no guest, so the SUMMARY arrives empty or as
 * "Reservation <confirmation-code>"; VRBO/Airbnb blocks come through as
 * "Reserved", "Not available", "Blocked". Treat all of these as "no name" so
 * a real name from another source (e.g. the Guesty mirror) can take over and
 * the UI never prints a raw confirmation code as if it were a guest.
 */
export function isPlaceholderGuestName(name: string | null | undefined): boolean {
  if (!name) return true;
  const t = name.trim();
  if (!t) return true;
  return /^(reservation|reserved|not available|unavailable|blocked|block|airbnb|guest)\b/i.test(t);
}

/**
 * The Airbnb confirmation code, read from the feed's own DESCRIPTION.
 *
 * Airbnb's direct per-listing feed redacts the guest (SUMMARY is just
 * "Reserved") but its DESCRIPTION links the reservation:
 *
 *   Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMEFDNMS4Z
 *   Phone Number (Last 4 Digits): 4905
 *
 * The last path segment is the same confirmation code Guesty reports for the
 * reservation ("Reservation HMEFDNMS4Z" on the aggregate feed, and the
 * guesty_reservations row), so a direct-feed row that carries it joins its
 * twins by identity in booking-dedupe's first pass instead of being placed by
 * dates alone. Nameless, codeless direct rows are what let a cancelled stay
 * and its same-dates rebooking fuse at 20 Hammond (#1568).
 *
 * Returns null when the description carries no such link (a block, a VRBO
 * feed, the Guesty aggregate feed). Uppercased, because the dedupe join is an
 * exact string match against Guesty's uppercase code. The guest name is not
 * touched: the feed has none, and the code must never be printed as one.
 */
export function airbnbConfirmationCode(description: string | null | undefined): string | null {
  if (!description) return null;
  const m = description.match(/airbnb\.com\/hosting\/reservations\/details\/([A-Za-z0-9]+)/);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Some OTAs leak the guest name in DESCRIPTION even when they redact it
 * from SUMMARY. Try a couple of common patterns.
 */
export function guessGuestNameFromIcal(event: IcalEvent): string | null {
  const desc = event.description ?? '';
  // VRBO: "Reservation\nGuest: John Doe\nCheck-in: ..."
  const m1 = desc.match(/Guest:\s*([^\n\r]+)/i);
  if (m1) return m1[1].trim();
  // Some feeds put the guest right in SUMMARY when not Airbnb.
  const sum = event.summary ?? '';
  if (sum && !/^(reserved|blocked|not\s*available|closed|unavailable)/i.test(sum.trim())) {
    return sum.trim();
  }
  return null;
}
