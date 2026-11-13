/**
 * Booking requests for partner homes: the rules.
 *
 * A partner home (properties.kind = 'partner') is run by its own host, so a
 * guest on staycapeann.com never books it instantly. They send a request,
 * the host has RESPONSE_WINDOW_HOURS to answer, and the guest hears back
 * either way. staycapeann.com posts the request through the PMS bridge
 * (POST /api/pms/requests, src/lib/booking-requests-db.ts), Helm prices it
 * from the home's own rate plan, and the owners work the queue at
 * /guests/requests.
 *
 * Money: when the host's Stripe account is connected (src/lib/partner-payments.ts),
 * the site places a hold on the guest's card before the request is filed,
 * and the request carries it. Accepting books the nights and the site then
 * charges the hold; a decline, a withdrawal or the clock running out
 * releases it. A request from a home not yet taking cards carries no hold
 * and cannot be accepted.
 *
 * PURE MODULE: no env, no database, no server-only imports. The bridge, the
 * review page, the cron, the home feed and the tests all read it.
 */

import { validateHold, type HoldStatus, type RequestHold } from './partner-payments.ts';

export type BookingRequestStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'withdrawn';

/** How long a host has to answer, from the moment the request lands. */
export const RESPONSE_WINDOW_HOURS = 24;

/** Under this, the clock reads as urgent on the review screen. */
export const URGENT_HOURS = 4;

/** A declined or closed request whose email failed is retried this long. */
export const OUTCOME_RETRY_DAYS = 3;

export const MAX_MESSAGE = 2000;
export const MAX_NAME = 120;
export const MAX_PHONE = 40;
export const MAX_GUESTS = 30;
export const MAX_KEY = 200;

export const BOOKING_REQUEST_STATUS_LABEL: Record<BookingRequestStatus, string> = {
  pending: 'Waiting on the host',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Closed, no answer',
  withdrawn: 'Guest withdrew',
};

export type BookingRequestRow = {
  id: string;
  request_key: string;
  source: string;
  property_id: string;
  check_in: string;
  check_out: string;
  guests: number;
  guest_first_name: string;
  guest_last_name: string;
  guest_email: string;
  guest_phone: string | null;
  message: string | null;
  quoted_total_cents: number;
  currency: string;
  quote: Record<string, unknown>;
  status: BookingRequestStatus;
  respond_by: string;
  host_told_at: string | null;
  host_told_by: string | null;
  /** When the host was emailed that the request landed (src/lib/partner-host-email.ts). */
  host_emailed_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decline_reason: string | null;
  receipt_emailed_at: string | null;
  outcome_emailed_at: string | null;
  stripe_account_id: string | null;
  payment_intent_id: string | null;
  hold_cents: number | null;
  fee_cents: number | null;
  hold_status: HoldStatus;
  hold_placed_at: string | null;
  captured_at: string | null;
  released_at: string | null;
  charge_id: string | null;
  hold_error: string | null;
  confirmation_emailed_at: string | null;
  /** The home's cancellation policy and house rules when the request landed (requestTerms). */
  cancellation_terms: string | null;
  house_rules: string | null;
  /** The staycapeann.com Terms of Service the guest agreed to, by its date. */
  terms_version: string | null;
  created_at: string;
  updated_at: string;
};

export const BOOKING_REQUEST_COLS =
  'id, request_key, source, property_id, check_in, check_out, guests, guest_first_name, guest_last_name, guest_email, guest_phone, message, quoted_total_cents, currency, quote, status, respond_by, host_told_at, host_told_by, host_emailed_at, decided_at, decided_by, decline_reason, receipt_emailed_at, outcome_emailed_at, stripe_account_id, payment_intent_id, hold_cents, fee_cents, hold_status, hold_placed_at, captured_at, released_at, charge_id, hold_error, confirmation_emailed_at, cancellation_terms, house_rules, terms_version, created_at, updated_at';

/**
 * What a guest agrees to when they send a request: the home's cancellation
 * policy and house rules as they stand that moment. Kept on the request, so
 * a cancellation or a card dispute is judged against the words the guest
 * saw, even after the host changes them. A home with no cancellation policy
 * (or a policy that cannot be read) takes no request: null.
 */
export function requestTerms(
  policy: { cancellation_policy: string | null; house_rules: string | null } | null,
): { cancellation_terms: string; house_rules: string | null } | null {
  const cancellation = (policy?.cancellation_policy ?? '').trim();
  if (!cancellation) return null;
  const rules = (policy?.house_rules ?? '').trim();
  return { cancellation_terms: cancellation, house_rules: rules || null };
}

/** A Terms of Service version label, as the site sends it: its date or a short tag. */
const TERMS_VERSION = /^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/;

// ─── The clock ──────────────────────────────────────────────────────────────

/** When the host must have answered a request that lands at `now`. */
export function respondByFor(now: Date): string {
  return new Date(now.getTime() + RESPONSE_WINDOW_HOURS * 3600_000).toISOString();
}

/**
 * The status a person should see. A pending request past its clock reads as
 * closed before the cron gets to it, so the screen never offers a decision
 * the server would refuse.
 */
export function effectiveStatus(row: Pick<BookingRequestRow, 'status' | 'respond_by'>, now: Date): BookingRequestStatus {
  if (row.status === 'pending' && Date.parse(row.respond_by) <= now.getTime()) return 'expired';
  return row.status;
}

/** True while the host can still answer. */
export function isOpen(row: Pick<BookingRequestRow, 'status' | 'respond_by'>, now: Date): boolean {
  return effectiveStatus(row, now) === 'pending';
}

/** Milliseconds left on the clock, never negative. */
export function msLeft(row: Pick<BookingRequestRow, 'respond_by'>, now: Date): number {
  return Math.max(0, Date.parse(row.respond_by) - now.getTime());
}

/** "5 h left", "40 min left", "Closed". */
export function clockLabel(row: Pick<BookingRequestRow, 'status' | 'respond_by'>, now: Date): string {
  if (!isOpen(row, now)) return 'Closed';
  const mins = Math.floor(msLeft(row, now) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min left`;
  return `${Math.floor(mins / 60)} h left`;
}

export function isUrgent(row: Pick<BookingRequestRow, 'status' | 'respond_by'>, now: Date): boolean {
  return isOpen(row, now) && msLeft(row, now) < URGENT_HOURS * 3600_000;
}

const EASTERN = 'America/New_York';

/** "3:40 PM" in Eastern time. */
export function easternTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: EASTERN, hour: 'numeric', minute: '2-digit' });
}

/** "Friday, November 13 at 3:40 PM" in Eastern time. */
export function easternWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { timeZone: EASTERN, weekday: 'long', month: 'long', day: 'numeric' });
  return `${day} at ${easternTime(iso)}`;
}

/** "Fri 3:40 PM" in Eastern time, for a dense row. */
export function easternShort(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { timeZone: EASTERN, weekday: 'short' });
  return `${day} ${easternTime(iso)}`;
}

// ─── Overlaps ───────────────────────────────────────────────────────────────

/** Two half-open stays [check_in, check_out) share a night. */
export function staysOverlap(a: { check_in: string; check_out: string }, b: { check_in: string; check_out: string }): boolean {
  return a.check_in < b.check_out && b.check_in < a.check_out;
}

/**
 * For each open request, the other open requests at the same home that want
 * a night it wants. The host can say yes to only one of them, so the screen
 * names the others on each card.
 */
export function openOverlaps<R extends Pick<BookingRequestRow, 'id' | 'property_id' | 'check_in' | 'check_out' | 'status' | 'respond_by'>>(
  rows: R[],
  now: Date,
): Map<string, string[]> {
  const open = rows.filter((r) => isOpen(r, now));
  const out = new Map<string, string[]>();
  for (const r of open) {
    const others = open.filter((o) => o.id !== r.id && o.property_id === r.property_id && staysOverlap(r, o)).map((o) => o.id);
    if (others.length > 0) out.set(r.id, others);
  }
  return out;
}

// ─── The home feed line ─────────────────────────────────────────────────────

/**
 * "Booking requests: 2 waiting · first answer due Fri 3:40 PM", or null when
 * nothing is open. `respondBys` are the open requests' clocks.
 */
export function requestQueueText(respondBys: string[], now: Date): string | null {
  const open = respondBys.filter((r) => Date.parse(r) > now.getTime()).sort();
  if (open.length === 0) return null;
  const head = `Booking requests: ${open.length} waiting`;
  return `${head} · ${open.length === 1 ? 'answer' : 'first answer'} due ${easternShort(open[0])}`;
}

// ─── Validation ─────────────────────────────────────────────────────────────

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isIsoDay(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Control characters (C0, DEL, C1) to a space, runs squeezed: one line. */
export function oneLine(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** The guest's note keeps its line breaks and loses every other control character. */
export function cleanMessage(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\n') out += ch;
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) out += ' ';
    else out += ch;
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export type RequestInput = {
  request_key: string;
  source: string;
  property_id: string;
  check_in: string;
  check_out: string;
  guests: number;
  guest: { first_name: string; last_name: string; email: string; phone: string | null };
  message: string | null;
  /** What the guest was shown, so a price that moved is a question, not a surprise. */
  quoted_total_cents: number | null;
  /** The card hold the site placed on the host's Stripe account, if the home takes cards. */
  hold: RequestHold | null;
  /** The site's Terms of Service version the guest agreed to by sending. */
  terms_version: string | null;
};

export type RequestValidation = { ok: true; input: RequestInput } | { ok: false; detail: string };

/** The bridge body, checked and cleaned. Never trusts a number it does not re-derive. */
export function validateRequestInput(raw: unknown): RequestValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, detail: 'body must be an object' };
  const b = raw as Record<string, unknown>;
  const key = typeof b.request_key === 'string' ? b.request_key.trim() : '';
  if (!key || key.length > MAX_KEY) return { ok: false, detail: 'request_key is required' };
  const propertyId = typeof b.property_id === 'string' ? b.property_id.trim() : '';
  if (!propertyId) return { ok: false, detail: 'property_id is required' };
  if (!isIsoDay(b.check_in) || !isIsoDay(b.check_out)) return { ok: false, detail: 'check_in and check_out must be YYYY-MM-DD' };
  if (b.check_out <= b.check_in) return { ok: false, detail: 'check_out must be after check_in' };
  const guests = Number(b.guests);
  if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS) return { ok: false, detail: `guests must be a whole number from 1 to ${MAX_GUESTS}` };

  const g = (b.guest && typeof b.guest === 'object' ? b.guest : {}) as Record<string, unknown>;
  const first = typeof g.first_name === 'string' ? oneLine(g.first_name).slice(0, MAX_NAME) : '';
  const last = typeof g.last_name === 'string' ? oneLine(g.last_name).slice(0, MAX_NAME) : '';
  if (!first && !last) return { ok: false, detail: 'guest needs a name' };
  const email = typeof g.email === 'string' ? g.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, detail: 'guest needs a valid email' };
  const phone = typeof g.phone === 'string' ? oneLine(g.phone).slice(0, MAX_PHONE) : '';

  const message = typeof b.message === 'string' ? cleanMessage(b.message).slice(0, MAX_MESSAGE) : '';
  const shown = b.quoted_total_cents == null ? null : Number(b.quoted_total_cents);
  if (shown != null && (!Number.isInteger(shown) || shown < 0)) return { ok: false, detail: 'quoted_total_cents must be whole cents' };
  const source = typeof b.source === 'string' && b.source.trim() ? b.source.trim().toLowerCase().slice(0, 40) : 'sca';
  const hold = validateHold(b.hold);
  if (!hold.ok) return { ok: false, detail: hold.detail };
  const termsVersion = b.terms_version == null ? null : typeof b.terms_version === 'string' ? b.terms_version.trim() : '';
  if (termsVersion !== null && !TERMS_VERSION.test(termsVersion)) return { ok: false, detail: 'terms_version must be a short version label' };

  return {
    ok: true,
    input: {
      request_key: key,
      source,
      property_id: propertyId,
      check_in: b.check_in,
      check_out: b.check_out,
      guests,
      guest: { first_name: first, last_name: last, email, phone: phone || null },
      message: message || null,
      quoted_total_cents: shown,
      hold: hold.hold,
      terms_version: termsVersion,
    },
  };
}

/** The nights between two ISO days. */
export function nightsOf(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}

export function guestFullName(r: Pick<BookingRequestRow, 'guest_first_name' | 'guest_last_name'>): string {
  return `${r.guest_first_name} ${r.guest_last_name}`.trim() || 'Guest';
}

/** What a request says to the guest-facing site: never an internal note or a host contact. */
export type PublicBookingRequest = {
  id: string;
  status: BookingRequestStatus;
  respond_by: string;
  property_id: string;
  check_in: string;
  check_out: string;
  guests: number;
  quoted_total_cents: number;
  currency: string;
  /** Which hold the request kept, so the site can release one it did not. */
  hold_status: HoldStatus;
  payment_intent_id: string | null;
};

export function toPublicRequest(row: BookingRequestRow, now: Date): PublicBookingRequest {
  return {
    id: row.id,
    status: effectiveStatus(row, now),
    respond_by: row.respond_by,
    property_id: row.property_id,
    check_in: row.check_in,
    check_out: row.check_out,
    guests: row.guests,
    quoted_total_cents: row.quoted_total_cents,
    currency: row.currency,
    hold_status: row.hold_status,
    payment_intent_id: row.payment_intent_id,
  };
}
