/**
 * A partner home's host, on staycapeann.com: who they are, how they sign
 * in, and what they see of their booking requests.
 *
 * The host is the email on their home's row (properties.owner_emails on a
 * kind 'partner' row, written when an owner adds the home). They sign in on
 * the site's /host page with a six-digit code Helm emails them; the code
 * buys a session token the site keeps in an httpOnly cookie and sends back
 * in the x-host-session header on every bridge call, never in a URL. Helm
 * keeps hashes only (src/lib/partner-host-db.ts).
 *
 * A host answers their own requests through the same writers the office
 * uses (acceptBookingRequest, declineBookingRequest), so every check Accept
 * runs today (the card hold, the host's calendars read again, the claim on a
 * live clock) runs for a host's yes too. The actor is recorded as
 * "host:<email>".
 *
 * What a host sees of a request: the dates, party size, the guest's first
 * name and last initial, their message, the total, our fee and what reaches
 * the host. The guest's email and phone appear only once the stay is
 * accepted. Never an internal note or the office's decline reason.
 *
 * PURE MODULE: the bridge routes and the tests import it.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  clockLabel,
  easternWhen,
  effectiveStatus,
  isOpen,
  nightsOf,
  RESPONSE_WINDOW_HOURS,
  type BookingRequestRow,
  type BookingRequestStatus,
} from './booking-requests.ts';
import type { HoldStatus } from './partner-payments.ts';
import { datesLine } from './booking-request-copy.ts';
import { displayTitle, fmtCents } from './sca-quotes-types.ts';
import { maskContact } from './partner-messages.ts';

export const HOST_CODE_MINUTES = 10;
export const HOST_CODE_TRIES = 5;
/** Codes one email may ask for in an hour. */
export const HOST_CODES_PER_HOUR = 5;
export const HOST_SESSION_DAYS = 30;
/** How long a decided request stays on the host's list. */
export const HOST_HISTORY_DAYS = 60;
export const HOST_SESSION_HEADER = 'x-host-session';
export const HOST_ACTOR_PREFIX = 'host:';
/** A host's Accept with no card on hold: the office settles that one with them. */
export const HOST_NO_HOLD =
  "There's no card on hold for this request, so Stay Cape Ann will confirm it with you. Write to hello@staycapeann.com.";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^\d{6}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** A sign-in email as Helm stores and compares it, or null. */
export function normalizeHostEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 200 && EMAIL.test(e) ? e : null;
}

/** Six digits as typed, spaces dropped, or null. */
export function normalizeHostCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.replace(/\s+/g, '');
  return CODE.test(c) ? c : null;
}

export function makeHostCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** The stored form of a code: tied to its email, so one code cannot open another inbox. */
export function hostCodeHash(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}`).digest('hex');
}

export function hostCodeMatches(email: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hostCodeHash(email, code), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 256 bits, base64url: 43 characters. */
export function makeHostSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function parseHostSessionToken(raw: unknown): string | null {
  return typeof raw === 'string' && TOKEN.test(raw) ? raw : null;
}

export function hostSessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hostActor(email: string): string {
  return `${HOST_ACTOR_PREFIX}${email}`;
}

/** The emails on a home's row, compared the way sign-in compares them. */
export function hostEmailsOf(home: { owner_emails?: unknown }): string[] {
  const list = Array.isArray(home.owner_emails) ? home.owner_emails : [];
  return list.map(normalizeHostEmail).filter((e): e is string => !!e);
}

export type HostHome = { id: string; title: string };

/** The partner homes this email hosts. Pure: the caller reads partner rows only. */
export function homesForHost<H extends { id: string; kind?: string | null; owner_emails?: unknown }>(email: string, homes: H[]): H[] {
  return homes.filter((h) => h.kind === 'partner' && hostEmailsOf(h).includes(email));
}

/** "Sarah K." before the stay is booked; the whole name after. */
export function hostGuestName(r: Pick<BookingRequestRow, 'guest_first_name' | 'guest_last_name'>, booked: boolean): string {
  const firstName = (r.guest_first_name ?? '').trim();
  const last = (r.guest_last_name ?? '').trim();
  if (booked) return `${firstName} ${last}`.trim() || 'Guest';
  const initial = last ? ` ${last[0].toUpperCase()}.` : '';
  return firstName ? `${firstName}${initial}` : 'Guest';
}

export type HostRequestView = {
  id: string;
  property_id: string;
  home_title: string;
  check_in: string;
  check_out: string;
  nights: number;
  guests: number;
  guest_name: string;
  message: string | null;
  status: BookingRequestStatus;
  respond_by: string;
  /** "5 h left", or "Closed". */
  clock: string;
  /** "Friday, November 14 at 3:40 PM" Eastern: when the request closes. */
  respond_by_label: string;
  total_cents: number;
  fee_cents: number | null;
  /** The hold less our fee: what reaches the host before Stripe's card fee. */
  payout_cents: number | null;
  currency: string;
  hold_status: HoldStatus;
  can_accept: boolean;
  can_decline: boolean;
  /** The guest's contact, once the stay is booked. */
  contact: { email: string; phone: string | null } | null;
  cancellation_terms: string | null;
  house_rules: string | null;
  decided_at: string | null;
  created_at: string;
  /** Messages in the request's conversation and how many the host has not opened (src/lib/partner-messages.ts). Filled by the list. */
  messages: number;
  unread: number;
};

export function hostRequestView(row: BookingRequestRow, title: string | null, now: Date): HostRequestView {
  const status = effectiveStatus(row, now);
  const open = isOpen(row, now);
  const booked = status === 'accepted';
  const held = row.hold_cents != null && row.hold_status !== 'none' ? row.hold_cents : null;
  const fee = held != null && row.fee_cents != null ? row.fee_cents : null;
  return {
    id: row.id,
    property_id: row.property_id,
    home_title: displayTitle(title) || 'Your home',
    check_in: row.check_in,
    check_out: row.check_out,
    nights: nightsOf(row.check_in, row.check_out),
    guests: row.guests,
    guest_name: hostGuestName(row, booked),
    // Contact in the guest's note stays hidden until the stay is booked, as in their messages.
    message: row.message && !booked ? maskContact(row.message).body : row.message,
    status,
    respond_by: row.respond_by,
    clock: clockLabel(row, now),
    respond_by_label: easternWhen(row.respond_by),
    total_cents: held ?? row.quoted_total_cents,
    fee_cents: fee,
    payout_cents: held != null && fee != null ? held - fee : null,
    currency: row.currency,
    hold_status: row.hold_status,
    can_accept: open && row.hold_status === 'held',
    can_decline: open,
    contact: booked ? { email: row.guest_email, phone: row.guest_phone } : null,
    cancellation_terms: row.cancellation_terms,
    house_rules: row.house_rules,
    decided_at: row.decided_at,
    created_at: row.created_at,
    messages: 0,
    unread: 0,
  };
}

/** Open requests first, soonest clock first; then the rest, newest first. */
export function sortHostRequests(list: HostRequestView[]): HostRequestView[] {
  return list.slice().sort((a, b) => {
    const ao = a.can_decline ? 0 : 1;
    const bo = b.can_decline ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (ao === 0) return a.respond_by < b.respond_by ? -1 : a.respond_by > b.respond_by ? 1 : 0;
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
  });
}

// ─── Email to the host ─────────────────────────────────────────────────────

export type HostEmail = { subject: string; text: string; html: string };

const HELLO = 'hello@staycapeann.com';
const PHONE = '(978) 865-2575';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const WRAP_OPEN =
  '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">';
const SIGN_OFF_TEXT = `Stay Cape Ann\n${HELLO} · ${PHONE}`;
const SIGN_OFF_HTML = `<p style="margin-top: 28px;">Stay Cape Ann<br/><span style="color: #506068; font-size: 13px;">${HELLO} &middot; ${PHONE}</span></p>`;

/** Paragraphs to an email; a [text, url, label] paragraph ends in a link. */
function build(subject: string, paragraphs: Array<string | [string, string, string]>): HostEmail {
  const text = [...paragraphs.map((p) => (typeof p === 'string' ? p : `${p[0]} ${p[1]}`)), SIGN_OFF_TEXT].join('\n\n');
  const html =
    WRAP_OPEN +
    paragraphs
      .map((p) =>
        typeof p === 'string'
          ? `<p>${escapeHtml(p)}</p>`
          : `<p>${escapeHtml(p[0])} <a href="${escapeHtml(p[1])}" style="color: #1e2e34;">${escapeHtml(p[2])}</a></p>`,
      )
      .join('') +
    SIGN_OFF_HTML +
    '</div>';
  return { subject, text, html };
}

export function hostAreaUrl(siteOrigin: string): string {
  return `${siteOrigin.replace(/\/+$/, '')}/host`;
}

/** The sign-in code. Nothing else in it: a code email can sit in any inbox. */
export function hostCodeEmail(code: string): HostEmail {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text = [
    `Your Stay Cape Ann sign-in code is ${spaced}.`,
    `It works for ${HOST_CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.`,
    SIGN_OFF_TEXT,
  ].join('\n\n');
  const html =
    WRAP_OPEN +
    `<p>Your Stay Cape Ann sign-in code is</p>` +
    `<p style="font-size: 28px; letter-spacing: 4px; font-weight: 600; margin: 8px 0 16px;">${escapeHtml(spaced)}</p>` +
    `<p>It works for ${HOST_CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.</p>` +
    SIGN_OFF_HTML +
    '</div>';
  return { subject: `Your sign-in code: ${spaced}`, text, html };
}

/** A request landed: what it is and when it closes. No guest contact. */
export function hostNewRequestEmail(row: BookingRequestRow, title: string | null, siteOrigin: string): HostEmail {
  const home = displayTitle(title) || 'your home';
  const n = nightsOf(row.check_in, row.check_out);
  const held = row.hold_cents != null && row.hold_status === 'held' ? row.hold_cents : null;
  const money =
    held != null && row.fee_cents != null
      ? `The guest's card is on hold for ${fmtCents(held, row.currency)}. If you accept, it is charged and ${fmtCents(held - row.fee_cents, row.currency)} reaches your Stripe account after our fee, before Stripe's card fee.`
      : `The quoted total is ${fmtCents(row.quoted_total_cents, row.currency)}.`;
  return build(`Booking request for ${home}: ${datesLine(row.check_in, row.check_out)}`, [
    `${hostGuestName(row, false)} asked to stay at ${home}, ${datesLine(row.check_in, row.check_out)} (${n} night${n === 1 ? '' : 's'}, ${row.guests} guest${row.guests === 1 ? '' : 's'}).`,
    ...(row.message ? [`They wrote: "${maskContact(row.message.trim()).body}"`] : []),
    money,
    `Please answer by ${easternWhen(row.respond_by)} Eastern, within ${RESPONSE_WINDOW_HOURS} hours of the request. If no one answers by then, the request closes and the hold is released.`,
    ['Accept or decline it, or write to them first:', hostAreaUrl(siteOrigin), 'Your requests'],
    'Before you accept, check the dates against your other calendars. You can also reply to this email and we will help.',
  ]);
}
