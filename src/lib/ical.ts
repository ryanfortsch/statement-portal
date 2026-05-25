/**
 * Minimal RFC 5545 iCalendar parser.
 *
 * Scoped to the .ics feeds Airbnb / VRBO / Booking.com publish: all-day
 * VEVENT blocks with a UID, DTSTART, DTEND, SUMMARY, DESCRIPTION. Not a
 * general-purpose parser — RRULE, timezones beyond UTC, alarms, and
 * VTODO/VJOURNAL are ignored.
 *
 * No external dependency: each OTA's feed is small (kilobytes), the
 * format is line-oriented, and we only need maybe a dozen properties.
 */

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
 * is a "line fold" — collapse the next line into the previous one.
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
 * Heuristic: an Airbnb iCal SUMMARY of "Reserved" / "Not available" /
 * "Closed - Not available" all mean a stay is on the books, even though
 * the platform redacts guest names from public iCal feeds. VRBO uses
 * "Blocked" or "Unavailable". Booking.com uses "CLOSED - Not available".
 */
export function isBookingEvent(event: IcalEvent): boolean {
  if (event.cancelled) return false;
  const s = (event.summary ?? '').toLowerCase();
  if (s.includes('available')) return false;          // "Available" only — not booked
  // Anything reserved, blocked, closed, or unavailable counts as a stay.
  return true;
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
