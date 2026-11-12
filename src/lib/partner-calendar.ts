/**
 * A partner home's own calendars, pure.
 *
 * The host keeps selling on Airbnb, Vrbo or their own software, so Helm
 * reads each of those calendars in (partner_calendar_feeds, every 30 minutes
 * on /api/cron/channels-sync) and the host imports Helm's export, which
 * carries the stays booked on staycapeann.com (the accepted booking
 * requests). Two rules keep it safe:
 *
 *   - A host's nights are kept in partner_calendar_holds, never in bookings.
 *     Everything that runs our houses (Rosa's schedule, Work, statements, the
 *     concierge) reads bookings, so a stranger's guests can never reach it.
 *     No guest name, no description is kept: only stay or block, and dates.
 *   - Helm's export for a partner home carries only what was booked on
 *     staycapeann.com. A night the host's own calendar holds is never sent
 *     back out, so no calendar can echo another.
 *
 * A feed that comes back empty after holding stays is not believed (the
 * calendar keeps its last good read), the same guard the OTA import has.
 * No Next or database imports, so the tests load it offline.
 */

import { classifyIcalEvent, type IcalEvent } from './ical.ts';

export const PARTNER_FEED_CHANNELS = ['airbnb', 'vrbo', 'booking_com', 'other'] as const;
export type PartnerFeedChannel = (typeof PARTNER_FEED_CHANNELS)[number];

export function isPartnerFeedChannel(s: unknown): s is PartnerFeedChannel {
  return typeof s === 'string' && (PARTNER_FEED_CHANNELS as readonly string[]).includes(s);
}

/** A feed with at least this many future holds that comes back empty is not believed. */
export const EMPTY_FEED_GUARD = 2;
/** Holds kept per feed. A real calendar has a few dozen. */
export const MAX_HOLDS_PER_FEED = 1000;
/** Nights older than this are dropped at import. */
export const PAST_DAYS_KEPT = 30;
/** A feed body larger than this is refused. */
export const MAX_FEED_BYTES = 2_000_000;
/** A host feed not read for this long no longer counts as read in: not for the listing bar, not for Accept. */
export const FEED_STALE_MS = 6 * 60 * 60_000;

/** True when the feed's last good read is recent enough to trust. */
export function feedIsFresh(lastSyncedAt: string | null | undefined, now: Date): boolean {
  if (!lastSyncedAt) return false;
  const t = Date.parse(lastSyncedAt);
  return Number.isFinite(t) && now.getTime() - t <= FEED_STALE_MS;
}

/**
 * Why Accept must wait, or null. Accept reads the host's calendars again
 * first; a feed that still has no good read in FEED_STALE_MS cannot vouch
 * for the nights, so a stay the host sold there since would be sold twice.
 */
export function staleFeedsBlockAccept(
  feeds: ReadonlyArray<{ channel: string; last_synced_at: string | null; last_error: string | null }> | null,
  now: Date,
): string | null {
  if (feeds == null) return 'The host’s calendars could not be read just now. Try again in a minute.';
  const stale = feeds.filter((f) => !feedIsFresh(f.last_synced_at, now));
  if (stale.length === 0) return null;
  const f = stale[0];
  const name = f.channel === 'other' ? 'their own' : f.channel === 'booking_com' ? 'Booking.com' : f.channel === 'vrbo' ? 'Vrbo' : 'Airbnb';
  return `The host’s ${name} calendar has not been read in over six hours${f.last_error ? ` (${f.last_error})` : ''}, so these nights cannot be checked. Fix it on the home’s page, or ask the host, before accepting.`;
}

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

/**
 * A calendar URL the office pasted, checked. https only, a public host, no
 * credentials in it. The channel is read off the host when it is one we know.
 */
export function parseFeedUrl(raw: unknown): { ok: true; url: string; channel: PartnerFeedChannel | null } | { ok: false; error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { ok: false, error: 'Paste the calendar link.' };
  if (s.length > 2000) return { ok: false, error: 'That link is too long.' };
  let u: URL;
  try {
    u = new URL(s.replace(/^webcal:\/\//i, 'https://'));
  } catch {
    return { ok: false, error: 'That is not a link.' };
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'The calendar link must start with https://.' };
  if (u.username || u.password) return { ok: false, error: 'That link carries a login. Paste the calendar export link instead.' };
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || PRIVATE_HOST.test(host)) return { ok: false, error: 'That link does not point at a public calendar.' };
  if (/(^|\.)risingtidestr\.com$/.test(host)) return { ok: false, error: 'That is Helm’s own calendar. Paste the host’s calendar from Airbnb or Vrbo.' };
  return { ok: true, url: u.toString(), channel: channelFromHost(host) };
}

export function channelFromHost(host: string): PartnerFeedChannel | null {
  const h = host.toLowerCase();
  if (/(^|\.)airbnb\.[a-z.]+$/.test(h)) return 'airbnb';
  if (/(^|\.)(vrbo|homeaway)\.[a-z.]+$/.test(h)) return 'vrbo';
  if (/(^|\.)booking\.com$/.test(h)) return 'booking_com';
  return null;
}

/** The URL with its secret path cut, for an error line or a list. */
export function maskFeedUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}/…`;
  } catch {
    return 'the link';
  }
}

export type PartnerHold = { kind: 'stay' | 'block'; check_in: string; check_out: string; uid: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The holds a feed's events make: each stay or block with real dates, past
 * nights over PAST_DAYS_KEPT dropped, 'skip' events (cancelled, "Available")
 * dropped. The channel's own rule says which is which (lib/ical
 * classifyIcalEvent); their software reads as a direct calendar.
 */
export function holdsFromEvents(events: readonly IcalEvent[], channel: PartnerFeedChannel, todayIso: string): PartnerHold[] {
  const from = shiftDay(todayIso, -PAST_DAYS_KEPT);
  const out: PartnerHold[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const kind = classifyIcalEvent(e, channel === 'other' ? 'direct' : channel);
    if (kind === 'skip') continue;
    const checkIn = e.dtstart;
    const checkOut = e.dtend;
    if (!checkIn || !checkOut || !DAY.test(checkIn) || !DAY.test(checkOut) || checkOut <= checkIn) continue;
    if (checkOut <= from) continue;
    const uid = (e.uid || `${checkIn}:${checkOut}`).slice(0, 300);
    const key = `${uid}|${checkIn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, check_in: checkIn, check_out: checkOut, uid });
    if (out.length >= MAX_HOLDS_PER_FEED) break;
  }
  return out;
}

/**
 * True when a read should not replace the calendar: it holds nothing now
 * while the last good read held stays still ahead. An Airbnb export that
 * fails open returns an empty calendar, and believing it reopens every night.
 */
export function emptyFeedSuspicious(next: readonly PartnerHold[], futureHoldsBefore: number): boolean {
  return next.length === 0 && futureHoldsBefore >= EMPTY_FEED_GUARD;
}

/** Calendar rows for the availability engine (lib/availability AvailabilityBooking). */
export function asAvailability(h: Pick<PartnerHold, 'kind' | 'check_in' | 'check_out'>): { status: string; check_in: string; check_out: string; source: string } {
  return { status: h.kind === 'stay' ? 'confirmed' : 'block', check_in: h.check_in, check_out: h.check_out, source: 'partner_calendar' };
}

/**
 * The export rows for a partner home: each accepted staycapeann.com stay,
 * shaped as the export builder reads a booking (lib/ical-export). Channel
 * 'direct' and the request's id, never a guest's name.
 */
export function exportRowsForRequests(rows: ReadonlyArray<{ id: string; check_in: string; check_out: string }>): Array<{
  id: string;
  status: 'confirmed';
  duplicate_of: null;
  check_in: string;
  check_out: string;
  channel: 'direct';
  hold_kind: null;
  source: 'booking_request';
}> {
  return rows
    .filter((r) => DAY.test(r.check_in) && DAY.test(r.check_out) && r.check_out > r.check_in)
    .map((r) => ({ id: r.id, status: 'confirmed', duplicate_of: null, check_in: r.check_in, check_out: r.check_out, channel: 'direct', hold_kind: null, source: 'booking_request' }));
}
