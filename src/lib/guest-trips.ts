/**
 * A guest's trips on staycapeann.com/trips: how they sign in and what they
 * see.
 *
 * The guest is the email they asked or booked with:
 *   - booking_requests.guest_email, a request to a partner home;
 *   - bookings.guest_email on a direct stay Helm holds (channel 'direct',
 *     the canonical row).
 * A Rising Tide home Guesty still runs keeps its guest's email in Guesty,
 * not here, so those stays are not listed yet; the guest's confirmation and
 * the concierge's texts carry them.
 *
 * Sign-in is the host area's (partner-host.ts): six digits Helm emails, ten
 * minutes, five tries, five codes an hour, then a 30-day session the site
 * keeps in an httpOnly cookie and sends as the x-trip-session header, never
 * in a URL. The code's hash is salted 'trip:' and the tables are their own
 * (guest_trip_codes, guest_trip_sessions), so a host's code or session never
 * opens a guest's trips. An email with no trip gets the same answer as one
 * with a trip, and nothing is sent.
 *
 * What a guest sees: the home's listing title, the dates and party, where it
 * stands, the total and the card's state, the cancellation policy and house
 * rules they agreed to, and on a booked direct stay at a guest app home its
 * stay link. Never the host's contact, an internal note or the office's
 * decline reason. A request still waiting can be withdrawn through the
 * office's own writer (withdrawBookingRequest), recorded as guest:<email>.
 *
 * PURE MODULE: the bridge routes and the tests import it.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { clockLabel, easternWhen, effectiveStatus, isOpen, nightsOf, type BookingRequestRow } from './booking-requests.ts';
import type { HoldStatus } from './partner-payments.ts';
import { displayTitle } from './sca-quotes-types.ts';
import {
  HOST_CODE_MINUTES,
  HOST_CODE_TRIES,
  HOST_CODES_PER_HOUR,
  HOST_SESSION_DAYS,
  hostCodeEmail,
  hostSessionHash,
  makeHostCode,
  makeHostSessionToken,
  normalizeHostCode,
  normalizeHostEmail,
  parseHostSessionToken,
  type HostEmail,
} from './partner-host.ts';

export const TRIP_CODE_MINUTES = HOST_CODE_MINUTES;
export const TRIP_CODE_TRIES = HOST_CODE_TRIES;
export const TRIP_CODES_PER_HOUR = HOST_CODES_PER_HOUR;
export const TRIP_SESSION_DAYS = HOST_SESSION_DAYS;
export const TRIP_SESSION_HEADER = 'x-trip-session';
export const GUEST_ACTOR_PREFIX = 'guest:';
/** A stay stays on the list for a year after checkout. */
export const TRIP_PAST_DAYS = 365;
/** A request that closed without a stay stays on the list for 60 days. */
export const TRIP_CLOSED_DAYS = 60;

export const normalizeTripEmail = normalizeHostEmail;
export const normalizeTripCode = normalizeHostCode;
export const makeTripCode = makeHostCode;
export const makeTripSessionToken = makeHostSessionToken;
export const parseTripSessionToken = parseHostSessionToken;
export const tripSessionHash = hostSessionHash;

/** The stored form of a guest's code: tied to its email and salted apart from a host's. */
export function tripCodeHash(email: string, code: string): string {
  return createHash('sha256').update(`trip:${email}:${code}`).digest('hex');
}

export function tripCodeMatches(email: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(tripCodeHash(email, code), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function guestActor(email: string): string {
  return `${GUEST_ACTOR_PREFIX}${email}`;
}

/** The sign-in email: the host area's, which names no one and nothing but the code. */
export function tripCodeEmail(code: string): HostEmail {
  return hostCodeEmail(code);
}

/** YYYY-MM-DD, `days` before `today` (itself YYYY-MM-DD). */
export function daysBefore(today: string, days: number): string {
  return new Date(Date.parse(`${today}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

export type TripStatus = 'waiting' | 'booked' | 'declined' | 'expired' | 'withdrawn' | 'cancelled';
/** How the page groups a trip: an answer to wait for, a stay to come, a past stay, or one that closed without a stay. */
export type TripGroup = 'waiting' | 'upcoming' | 'past' | 'closed';

export type TripView = {
  id: string;
  kind: 'request' | 'stay';
  home_title: string;
  check_in: string;
  check_out: string;
  nights: number;
  guests: number | null;
  status: TripStatus;
  group: TripGroup;
  /** While a request waits: "Friday, November 14 at 3:40 PM" Eastern, and "5 h left". */
  respond_by_label: string | null;
  clock: string | null;
  /** The hold or the quote on a request. Null on a direct stay: its receipt is the guest's record. */
  total_cents: number | null;
  currency: string;
  hold_status: HoldStatus | null;
  can_withdraw: boolean;
  /** The stay's guest app link, on a booked direct stay at a guest app home. */
  stay_url: string | null;
  cancellation_terms: string | null;
  house_rules: string | null;
  /** When it closed without a stay; null otherwise. */
  closed_at: string | null;
  /** On a request: messages with the host and how many the guest has not opened (src/lib/partner-messages.ts). Filled by the list. */
  messages: number;
  unread: number;
};

const STATUS: Record<BookingRequestRow['status'], TripStatus> = {
  pending: 'waiting',
  accepted: 'booked',
  declined: 'declined',
  expired: 'expired',
  withdrawn: 'withdrawn',
};

type RequestRow = Pick<
  BookingRequestRow,
  | 'id'
  | 'check_in'
  | 'check_out'
  | 'guests'
  | 'status'
  | 'respond_by'
  | 'quoted_total_cents'
  | 'currency'
  | 'hold_status'
  | 'hold_cents'
  | 'cancellation_terms'
  | 'house_rules'
  | 'decided_at'
>;

export function tripFromRequest(row: RequestRow, title: string | null, today: string, now: Date): TripView {
  const status = STATUS[effectiveStatus(row, now)];
  const waiting = status === 'waiting';
  const group: TripGroup = waiting ? 'waiting' : status === 'booked' ? (row.check_out > today ? 'upcoming' : 'past') : 'closed';
  const held = row.hold_cents != null && row.hold_status !== 'none' ? row.hold_cents : null;
  return {
    id: row.id,
    kind: 'request',
    home_title: displayTitle(title) || 'Your home',
    check_in: row.check_in,
    check_out: row.check_out,
    nights: nightsOf(row.check_in, row.check_out),
    guests: row.guests,
    status,
    group,
    respond_by_label: waiting ? easternWhen(row.respond_by) : null,
    clock: waiting ? clockLabel(row, now) : null,
    total_cents: held ?? row.quoted_total_cents,
    currency: row.currency,
    hold_status: row.hold_status,
    can_withdraw: isOpen(row, now),
    stay_url: null,
    cancellation_terms: row.cancellation_terms,
    house_rules: row.house_rules,
    // An expired request closed when its clock ran out.
    closed_at: group === 'closed' ? (row.decided_at ?? row.respond_by) : null,
    messages: 0,
    unread: 0,
  };
}

export type TripBookingRow = {
  id: string;
  check_in: string;
  check_out: string;
  status: string;
  num_guests: number | null;
  currency: string | null;
};

export function tripFromBooking(row: TripBookingRow, title: string | null, today: string, stayUrl: string | null): TripView {
  const cancelled = row.status === 'cancelled';
  const group: TripGroup = cancelled ? 'closed' : row.check_out > today ? 'upcoming' : 'past';
  return {
    id: row.id,
    kind: 'stay',
    home_title: displayTitle(title) || 'Your home',
    check_in: row.check_in,
    check_out: row.check_out,
    nights: nightsOf(row.check_in, row.check_out),
    guests: row.num_guests,
    status: cancelled ? 'cancelled' : 'booked',
    group,
    respond_by_label: null,
    clock: null,
    total_cents: null,
    currency: row.currency || 'USD',
    hold_status: null,
    can_withdraw: false,
    stay_url: group === 'upcoming' ? stayUrl : null,
    cancellation_terms: null,
    house_rules: null,
    closed_at: null,
    messages: 0,
    unread: 0,
  };
}

/**
 * What stays on the list: everything waiting or to come, a stay for a year
 * after checkout, a closed request for 60 days after it closed, a cancelled
 * stay until its dates pass.
 */
export function keepTrip(t: Pick<TripView, 'group' | 'kind' | 'check_out' | 'closed_at'>, today: string): boolean {
  if (t.group === 'waiting' || t.group === 'upcoming') return true;
  if (t.group === 'past') return t.check_out >= daysBefore(today, TRIP_PAST_DAYS);
  if (t.kind === 'stay') return t.check_out > today;
  return !!t.closed_at && t.closed_at.slice(0, 10) >= daysBefore(today, TRIP_CLOSED_DAYS);
}

const GROUP_ORDER: Record<TripGroup, number> = { waiting: 0, upcoming: 1, closed: 2, past: 3 };

/** Waiting, then to come (soonest first), then closed (newest first), then past (latest first). */
export function sortTrips(list: TripView[]): TripView[] {
  return list.slice().sort((a, b) => {
    const g = GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
    if (g !== 0) return g;
    if (a.group === 'waiting' || a.group === 'upcoming') return a.check_in < b.check_in ? -1 : a.check_in > b.check_in ? 1 : 0;
    if (a.group === 'closed') {
      const ac = a.closed_at ?? a.check_in;
      const bc = b.closed_at ?? b.check_in;
      return ac < bc ? 1 : ac > bc ? -1 : 0;
    }
    return a.check_in < b.check_in ? 1 : a.check_in > b.check_in ? -1 : 0;
  });
}
