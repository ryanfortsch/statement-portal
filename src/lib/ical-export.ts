/**
 * Build an RFC 5545 iCalendar feed of confirmed bookings for a property.
 *
 * Used by /api/channels/ical/[token] so external channels (Airbnb / VRBO /
 * Booking.com) can subscribe to Helm's master availability and avoid
 * double-bookings on the days a stay landed on a different channel.
 */

import type { Booking } from '@/lib/channels-types';
import { CHANNEL_LABELS } from '@/lib/channels-types';

export type IcalExportInput = {
  propertyName: string;
  propertyAddress: string;
  bookings: Booking[];
};

export function buildIcalExport({ propertyName, propertyAddress, bookings }: IcalExportInput): string {
  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//Rising Tide Helm//Channels//EN');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push(foldLine(`X-WR-CALNAME:${escapeText(`${propertyName} — Helm`)}`));
  lines.push(foldLine(`X-WR-CALDESC:${escapeText(`Master availability for ${propertyAddress}, published by Rising Tide Helm.`)}`));
  lines.push('X-WR-TIMEZONE:UTC');

  const now = formatStamp(new Date());

  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    if (!b.check_in || !b.check_out) continue;

    const channelLabel = CHANNEL_LABELS[b.channel] ?? b.channel;
    const summary = b.status === 'block'
      ? `Block — ${propertyName}`
      : `Reserved (${channelLabel})`;
    const description = [
      b.guest_name ? `Guest: ${b.guest_name}` : null,
      `Channel: ${channelLabel}`,
      `Status: ${b.status}`,
      b.notes ? `Note: ${b.notes}` : null,
    ].filter(Boolean).join('\\n');

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
    .replace(/;/g, '\\;')
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
