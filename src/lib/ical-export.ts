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
 * dates on the OTAs that were open.
 *
 * Each OTA subscribes to its own URL, `?for=airbnb` / `vrbo` / `booking_com`
 * (the channel hub hands out one per channel). That feed leaves out every
 * row that came from that same OTA: the OTA already holds its own
 * reservations and closures, and a closure of its own sent back to it would
 * outlive the operator's unblock. A pull with no `for` is attributed by user
 * agent (guessChannelFromUserAgent); an unrecognised puller gets everything,
 * because the worse failure there is a double booking, not a stuck block.
 *
 * ## Which OTA closures travel: Booking.com's, and nobody else's
 *
 * A closed night on an OTA's own calendar (bookings.status 'block',
 * hold_kind 'ota') is forwarded to the other channels only when it came
 * from Booking.com. Booking.com's iCal is the one that publishes real
 * reservations as closures ("CLOSED - Not available", no guest, no code), so
 * dropping its closures would let Airbnb and VRBO sell nights a Booking.com
 * guest holds. Airbnb and VRBO publish their reservations as stays
 * ("Reserved"), so a closure on either is an owner block set in that app, an
 * availability setting, or an echo of Helm's own export: nothing Helm should
 * repeat to a third channel. Owner blocks belong in Helm.
 *
 * That one rule is what makes the export loop-free. A Booking.com closure is
 * forwarded to Airbnb, VRBO and 'other' platforms; their closures of those
 * nights are forwarded to nobody; and the Booking.com feed itself never
 * carries an OTA closure (its own are left out by channel, the others are
 * never forwarded). So every closed night on every OTA traces, in at most
 * one hop, to a stay, a Helm row, or Booking.com's own calendar. When the
 * cause goes, Booking.com reopens at its next pull, the closure leaves its
 * feed, Helm cancels it on the two-look rule (ical-cancel-policy), and
 * Airbnb and VRBO reopen at their next pull. A Booking.com closure that was
 * only an echo costs a few extra hours closed after its cause is gone,
 * never more. The earlier design judged every OTA closure as echo or real
 * the moment it appeared and forwarded the real ones; two adversarial
 * rounds found races, pre-cutover verdicts and unrevocable stamps that
 * either reopened a real reservation or held nights closed on two OTAs for
 * good. There is no verdict now, so there is nothing to get wrong.
 *
 * A Booking.com closure is forwarded even when the dedupe has marked it a
 * duplicate (its pass four files a closure under the stay it overlaps):
 * forwarding a redundant closure is harmless, and a duplicate mark can
 * outlive the row it points at until the next dedupe run.
 *
 * And the event says nothing about the
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
  bookings: ExportBooking[];
  /** The OTA this feed is for; its own rows are left out. Null: unidentified. */
  forChannel?: string | null;
  /** The listing this feed is for; its own rows are left out. */
  forListingId?: string | null;
};

/** Statuses under which the nights are actually taken. */
export const EXPORTABLE_STATUSES = ['confirmed', 'completed', 'block'] as const;

/** bookings.hold_kind of a block imported from an OTA's own feed. */
export const OTA_HOLD_KIND = 'ota';

/** The one channel whose OTA closures are forwarded (see the docblock). */
export const FORWARDED_HOLD_CHANNEL = 'booking_com';

/** True for a block imported from an OTA's own feed. */
export function isOtaHold(b: { status: string; hold_kind?: string | null }): boolean {
  return b.status === 'block' && b.hold_kind === OTA_HOLD_KIND;
}

/** The channels that import Helm's export, one URL each. */
export const EXPORT_FOR_CHANNELS = ['airbnb', 'vrbo', 'booking_com'] as const;
export type ExportForChannel = (typeof EXPORT_FOR_CHANNELS)[number];

/** The `for` query parameter of an export URL, or null when absent or unknown. */
export function parseExportFor(value: string | null | undefined): ExportForChannel | null {
  const v = (value ?? '').trim().toLowerCase();
  return (EXPORT_FOR_CHANNELS as readonly string[]).includes(v) ? (v as ExportForChannel) : null;
}

/** The URL a given OTA should import: the property's feed with `?for=`. */
export function exportUrlFor(baseUrl: string, channel: ExportForChannel): string {
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}for=${channel}`;
}

/** The columns exportableBooking reads. A full `Booking` satisfies this. */
export type ExportCandidate = {
  status: string;
  duplicate_of: string | null;
  check_in: string | null;
  check_out: string | null;
  /** bookings.channel; a feed built `for` this channel leaves the row out. */
  channel?: string | null;
  /** bookings.channel_listing_id; a feed built for this listing leaves it out. */
  channel_listing_id?: string | null;
  /** bookings.hold_kind; 'ota' on a block imported from an OTA's feed. */
  hold_kind?: string | null;
};

/** A bookings row as the export reads it: Booking plus the PMS columns. */
export type ExportBooking = Booking & { hold_kind?: string | null };

/**
 * Who a feed is for: the channel whose own rows it leaves out, and the
 * listing whose own rows it leaves out. Both null: a puller nobody could
 * identify, who gets every row.
 */
export type ExportAudience = { channel: string | null; listingId: string | null };

/**
 * True when a row belongs in the feed built for `audience`: it holds nights
 * (confirmed, completed or block), it has both dates, it did not come from
 * the audience's channel (a named OTA) or listing, and either
 *   - it is an OTA closure from Booking.com, whatever its duplicate mark, or
 *   - it is not an OTA closure and it is the canonical row of its stay.
 * Any other OTA closure (Airbnb, VRBO, 'other') goes to no feed. The docblock
 * at the top says why this is the whole of the loop defence.
 *
 * The route reads the window and hands every row here; this is the gate.
 *
 * 'other' is never excluded by channel: several unrelated platforms share
 * it, and dropping one platform's rows from another's feed would let the
 * second sell nights the first holds. It is excluded by listing instead.
 */
export function exportableBooking(b: ExportCandidate, audience: ExportAudience | string | null = null): boolean {
  const aud: ExportAudience = typeof audience === 'string' || audience == null ? { channel: audience ?? null, listingId: null } : audience;
  if (!(EXPORTABLE_STATUSES as readonly string[]).includes(b.status)) return false;
  if (isOtaHold(b)) {
    if (b.channel !== FORWARDED_HOLD_CHANNEL) return false;
  } else if (b.duplicate_of != null) {
    return false;
  }
  if (aud.channel && aud.channel !== 'other' && b.channel === aud.channel) return false;
  if (aud.listingId && b.channel_listing_id === aud.listingId) return false;
  if (!b.check_in || !b.check_out) return false;
  return b.check_out > b.check_in;
}

/**
 * Resolve who is pulling, from the URL and the user agent.
 *
 *   ?listing=<channel_listings id> (one of this property's listings) names
 *     the listing exactly; its channel comes with it. This is the only way
 *     to give an 'other' platform its own feed.
 *   ?for=airbnb|vrbo|booking_com names the channel; the listing is that
 *     channel's one listing on the property, when there is exactly one.
 *   neither: the user agent's guess, if any.
 *
 * When the URL names one OTA and the user agent plainly names another (the
 * Airbnb line pasted into VRBO), the feed is served for NOBODY: every row.
 * Filtered for the wrong OTA, VRBO would never see
 * Airbnb's reservations and could sell them again. The pull is recorded
 * with both so the hub and the cutover preflight can say which OTA holds
 * the wrong URL.
 */
export function resolveExportAudience(input: {
  forParam: string | null | undefined;
  listingParam: string | null | undefined;
  userAgent: string | null | undefined;
  listings: ReadonlyArray<{ id: string; channel: string }>;
}): ExportAudience & { requestedFor: string | null; uaGuess: string | null; mismatch: boolean } {
  const uaGuess = guessChannelFromUserAgent(input.userAgent);
  const byId = input.listingParam ? input.listings.find((l) => l.id === input.listingParam) ?? null : null;
  const forChannel = byId ? byId.channel : parseExportFor(input.forParam);
  const requestedFor = forChannel ?? null;
  const mismatch = !!requestedFor && !!uaGuess && requestedFor !== uaGuess;
  if (mismatch) return { channel: null, listingId: null, requestedFor, uaGuess, mismatch };
  const channel = requestedFor ?? uaGuess;
  let listingId: string | null = byId ? byId.id : null;
  if (!listingId && channel && channel !== 'other') {
    const same = input.listings.filter((l) => l.channel === channel);
    if (same.length === 1) listingId = same[0].id;
  }
  return { channel, listingId, requestedFor, uaGuess, mismatch };
}

/** The URL a specific listing should import (the only form for 'other'). */
export function exportUrlForListing(baseUrl: string, listingId: string): string {
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}listing=${encodeURIComponent(listingId)}`;
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

/** The slice of an ical_export_pulls row exportPullState reads. */
export type ExportPullLike = { channel_guess: string | null; pulled_at: string };

/**
 * What a renderer may say about an OTA's pulls of a property's export:
 *   pulled   the newest matching pull
 *   never    the property was read and nothing matching has ever pulled
 *   unknown  the property is absent from the map: its read failed (or the
 *            caller never asked for it), so "never pulled" would be a guess
 */
export type ExportPullState<P extends ExportPullLike = ExportPullLike> =
  | { state: 'pulled'; pull: P }
  | { state: 'never' }
  | { state: 'unknown' };

/**
 * Reads the map lastPullsByProperty (lib/ical-export-pulls) returns, which
 * holds every property it read successfully (an empty array when nothing
 * ever pulled) and leaves out the ones it could not. `channel` narrows to
 * one OTA's pulls (null = the anonymous ones); undefined means any pull.
 */
export function exportPullState<P extends ExportPullLike>(
  pulls: ReadonlyMap<string, readonly P[]>,
  propertyId: string,
  channel?: string | null,
): ExportPullState<P> {
  const list = pulls.get(propertyId);
  if (!list) return { state: 'unknown' };
  let newest: P | null = null;
  for (const p of list) {
    if (channel !== undefined && (p.channel_guess ?? null) !== channel) continue;
    if (!newest || (Date.parse(p.pulled_at) || 0) > (Date.parse(newest.pulled_at) || 0)) newest = p;
  }
  return newest ? { state: 'pulled', pull: newest } : { state: 'never' };
}

export function buildIcalExport({ propertyName, propertyAddress, bookings, forChannel = null, forListingId = null }: IcalExportInput): string {
  const audience: ExportAudience = { channel: forChannel, listingId: forListingId };
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
    if (!exportableBooking(b, audience)) continue;

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
