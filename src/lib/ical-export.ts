/**
 * Build an RFC 5545 iCalendar feed of the nights a property has taken.
 *
 * Used by /api/channels/ical/[token] so external channels (Airbnb / VRBO /
 * Booking.com) can subscribe to Helm's master availability and avoid
 * double-bookings on the days a stay landed on a different channel.
 *
 * Only what actually holds nights is exported (exportableBooking): a
 * confirmed or completed stay, or a block, and only the canonical row of
 * each (duplicate_of null). Inquiries and pending requests hold nothing yet;
 * a duplicate is the same stay seen a second time. Exporting either blocked
 * dates on the OTAs that were open. And the event says nothing about the
 * guest: SUMMARY is "Reserved" or "Blocked", DESCRIPTION carries the channel
 * and the Helm booking id and nothing else. The old feed printed the guest's
 * name and the operator's notes to whoever held the URL.
 *
 * Import-free at runtime (the imports below are types), so `npm test`
 * covers the builder with no bundler.
 */

import type { Booking, BookingChannel } from '@/lib/channels-types';

export type IcalExportInput = {
  propertyName: string;
  propertyAddress: string;
  bookings: Booking[];
};

/** Statuses under which the nights are actually taken. */
export const EXPORTABLE_STATUSES = ['confirmed', 'completed', 'block'] as const;

/** The columns exportableBooking reads. A full `Booking` satisfies this. */
export type ExportCandidate = {
  status: string;
  duplicate_of: string | null;
  check_in: string | null;
  check_out: string | null;
};

/**
 * True when a row belongs in the export: it holds nights (confirmed,
 * completed or block), it is the canonical row of its stay, and it has
 * both dates. The route filters the query the same way; this is the second
 * gate, so a caller that hands the builder a broader read still leaks
 * nothing.
 */
export function exportableBooking(b: ExportCandidate): boolean {
  if (!(EXPORTABLE_STATUSES as readonly string[]).includes(b.status)) return false;
  if (b.duplicate_of != null) return false;
  if (!b.check_in || !b.check_out) return false;
  return b.check_out > b.check_in;
}

/**
 * Channel labels for the DESCRIPTION line. A local copy of CHANNEL_LABELS
 * (channels-types.ts) rather than an import, so this module stays
 * import-free for the test runner; `satisfies` makes tsc fail here the day
 * BOOKING_CHANNELS gains a member this map does not know.
 */
const CHANNEL_LABEL = {
  airbnb: 'Airbnb',
  vrbo: 'VRBO',
  booking_com: 'Booking.com',
  direct: 'Direct',
  manual: 'Manual',
  block: 'Block',
  guesty: 'Guesty',
  other: 'Other',
} as const satisfies Record<BookingChannel, string>;

function channelLabel(channel: string): string {
  return (CHANNEL_LABEL as Record<string, string>)[channel] ?? channel;
}

/**
 * Which OTA is pulling, read off the User-Agent of a GET on the export
 * route. Best effort: the OTAs do not document their fetchers, so this
 * matches the vendor names and returns null for anything else (a browser,
 * curl, a calendar app). Recorded on ical_export_pulls as channel_guess.
 */
export function guessChannelFromUserAgent(userAgent: string | null | undefined): 'airbnb' | 'vrbo' | 'booking_com' | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (ua.includes('airbnb')) return 'airbnb';
  if (ua.includes('vrbo') || ua.includes('homeaway') || ua.includes('expedia')) return 'vrbo';
  if (ua.includes('booking')) return 'booking_com';
  return null;
}

export function buildIcalExport({ propertyName, propertyAddress, bookings }: IcalExportInput): string {
  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//Rising Tide Helm//Channels//EN');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push(foldLine(`X-WR-CALNAME:${escapeText(`${propertyName} - Helm`)}`));
  lines.push(foldLine(`X-WR-CALDESC:${escapeText(`Master availability for ${propertyAddress}, published by Rising Tide Helm.`)}`));
  lines.push('X-WR-TIMEZONE:UTC');

  const now = formatStamp(new Date());

  for (const b of bookings) {
    if (!exportableBooking(b)) continue;

    const summary = b.status === 'block' ? 'Blocked' : 'Reserved';
    // Channel and Helm id only. No guest name, no notes: the URL is a
    // bearer token and every OTA that has it can read this.
    const description = `Channel: ${channelLabel(b.channel)}\nHelm: ${b.id}`;

    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:${b.id}@helm.risingtidestr.com`));
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART;VALUE=DATE:${stripDashes(b.check_in)}`);
    lines.push(`DTEND;VALUE=DATE:${stripDashes(b.check_out)}`);
    lines.push(foldLine(`SUMMARY:${escapeText(summary)}`));
    lines.push(foldLine(`DESCRIPTION:${escapeText(description)}`));
    lines.push('TRANSP:OPAQUE');
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  // RFC 5545 line ending is CRLF.
  return lines.join('\r\n') + '\r\n';
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function stripDashes(d: string): string {
  return d.replace(/-/g, '');
}

function formatStamp(d: Date): string {
  const yyyy = d.getUTCFullYear().toString();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const MM = String(d.getUTCMinutes()).padStart(2, '0');
  const SS = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${HH}${MM}${SS}Z`;
}

/** RFC 5545 line folding: split lines longer than 75 octets. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const chunk = line.slice(i, i + (i === 0 ? 75 : 74));
    out.push(i === 0 ? chunk : ` ${chunk}`);
    i += i === 0 ? 75 : 74;
  }
  return out.join('\r\n');
}
