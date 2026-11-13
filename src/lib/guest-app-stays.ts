/**
 * The Stay Cape Ann guest app, phase 2: the per-stay layer, as pure rules.
 *
 * Phase 1 gave every home one permanent link (/h/<token>), printed in the
 * house, so it never carries an access code. Phase 2 is a second, separate
 * link per reservation (/h/s/<token>, `guest_app_stays`) that shows the
 * home's app plus "Your stay": the guest's dates, the arrival steps and the
 * stay's own Seam door code. It is Guesty's per-reservation link, kept to
 * what our check-in message already does:
 *
 *  - The window. The stay layer exists only from 10:00 AM Eastern the day
 *    before check-in (the hour the fleet's arrival message texts the code,
 *    `pre_arrival` at -1 day 10:00) to the guest's checkout (House policy
 *    checkout, or a paid late checkout). Before it the link is the home's
 *    app and the hour the stay opens; after it, a thank-you page. Nothing
 *    on the page is earlier than what the guest's own messages carry.
 *  - The code is the stay's Seam code only (guest_access_codes, through
 *    getLiveStayCode in guest-locks.ts), never property_access's standing
 *    smart_lock_code: a stay code dies on the lock at checkout, so a copy
 *    of the page that outlives the stay opens nothing. A home with no live
 *    stay code says the code comes in the check-in message, as phase 1 does.
 *  - The code is never in the page's HTML. The page knows only whether
 *    there is one (StayCodeState has no field that could hold the digits);
 *    the guest taps "Show my door code" and the digits come back from a
 *    POST that re-checks the window. A link preview, a mail scanner or the
 *    offline copy the service worker keeps all fetch with GET, so none of
 *    them ever holds the code.
 *  - Verification is the link alone. The link travels in the same message
 *    that today carries the code itself, so a name or phone check would
 *    stop nobody who holds the message (it greets the guest by name) while
 *    it would stop the friend who arrives first with a forwarded link, and
 *    fail on OTA placeholders ("Guest to be announced") and on spelling.
 *    What the link alone cannot be is guessed (16 characters from 62, about
 *    95 bits) or derived: the stay token is independent of the printed home
 *    token.
 *
 * Pure (relative .ts imports, no server-only), so node:test pins it.
 */
import { addDays, formatLongDate, nightsBetween, zonedTimeToMs } from './automations-core.ts';
import { clockLabel, type GuestApp, type GuestItem } from './guest-app.ts';

export const STAY_TIMEZONE = 'America/New_York';

/**
 * A stay token: 16 characters from 62 (about 95 random bits), so the link
 * in a guest's text stays short (staycapeann.com/s/<token>, since
 * 2026-11-13) and still cannot be guessed. Links minted before then are 32
 * lowercase hex (128 bits) and keep working.
 */
export const STAY_TOKEN_RE = /^(?:[A-Za-z0-9]{16}|[a-f0-9]{32})$/;

export const STAY_TOKEN_LENGTH = 16;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * A new stay token from a source of random bytes (node:crypto's in
 * guest-app-stays-db.ts). Each character takes one byte under 248 (4 x 62)
 * and the rest are thrown away, so every character is equally likely.
 */
export function stayTokenFrom(random: (n: number) => Uint8Array): string {
  let out = '';
  while (out.length < STAY_TOKEN_LENGTH) {
    for (const b of random(32)) {
      if (b < 248 && out.length < STAY_TOKEN_LENGTH) out += BASE62[b % 62];
    }
  }
  return out;
}

/** The stay opens this many days before check-in, at STAY_OPENS_AT Eastern. */
export const STAY_OPENS_DAYS_BEFORE = 1;
/** The fleet arrival message's hour (`pre_arrival`, offset -1, 10:00). */
export const STAY_OPENS_AT = '10:00';
/** Checkout when House policy has none: the hour the Seam code ends (guest-locks.ts). */
export const DEFAULT_CHECKOUT_AT = '11:00';

// ── The window ─────────────────────────────────────────────────────────────

export type StayDates = {
  checkIn: string;
  checkOut: string;
};

export type StayTimes = {
  /** The rate plan's guest check-in, HH:MM (never the cleaner deadline). */
  checkInTime: string | null;
  /** House policy checkout, HH:MM. */
  checkOutTime: string | null;
  /** An active checkout_adjustments row (a paid late checkout, a moved day). */
  adjustedCheckOut?: string | null;
  adjustedCheckOutTime?: string | null;
};

export type StayWindow = {
  opensAt: Date;
  closesAt: Date;
  /** The day the guest leaves (an adjustment's date when it moved). */
  leaveDay: string;
  /** HH:MM the guest leaves by. */
  leaveAt: string;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^(\d{1,2}):(\d{2})/;

function hhmm(raw: string | null | undefined): string | null {
  const m = HHMM.exec((raw ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** The stay's window, or null for dates that cannot be read (a link that never opens). */
export function stayWindow(dates: StayDates, times: StayTimes): StayWindow | null {
  if (!YMD.test(dates.checkIn) || !YMD.test(dates.checkOut) || dates.checkOut <= dates.checkIn) return null;
  const leaveDay = times.adjustedCheckOut && YMD.test(times.adjustedCheckOut) ? times.adjustedCheckOut : dates.checkOut;
  const leaveAt = hhmm(times.adjustedCheckOutTime) ?? hhmm(times.checkOutTime) ?? DEFAULT_CHECKOUT_AT;
  const opensAt = new Date(zonedTimeToMs(addDays(dates.checkIn, -STAY_OPENS_DAYS_BEFORE), STAY_OPENS_AT, STAY_TIMEZONE));
  const closesAt = new Date(zonedTimeToMs(leaveDay, leaveAt, STAY_TIMEZONE));
  if (!(closesAt.getTime() > opensAt.getTime())) return null;
  return { opensAt, closesAt, leaveDay, leaveAt };
}

export type StayPhase = 'before' | 'open' | 'over';

/** Open is [opensAt, closesAt): at the checkout minute the stay is over. */
export function stayPhase(now: Date, window: StayWindow): StayPhase {
  const t = now.getTime();
  if (t < window.opensAt.getTime()) return 'before';
  if (t < window.closesAt.getTime()) return 'open';
  return 'over';
}

// ── Labels (Eastern) ───────────────────────────────────────────────────────

/** "Thursday, November 12" for an instant, in Eastern time. */
export function easternDayLabel(at: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: STAY_TIMEZONE, weekday: 'long', month: 'long', day: 'numeric' }).format(at);
}

/** "10:00 AM" for an instant, in Eastern time. */
export function easternClockLabel(at: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: STAY_TIMEZONE, hour: 'numeric', minute: '2-digit' }).format(at);
}

/** "10:00 AM on Thursday, November 12". */
export function easternMoment(at: Date): string {
  return `${easternClockLabel(at)} on ${easternDayLabel(at)}`;
}

// ── The door code, without its digits ──────────────────────────────────────

/** What getLiveStayCode (guest-locks.ts) reads: the one place the digits live. */
export type LiveStayCode = {
  code: string;
  starts_at: string | null;
  ends_at: string | null;
  /** How many of the home's mapped locks carry this code. */
  doorCount: number;
};

/**
 * What the page may know about the code: whether there is one and when it
 * works. Deliberately no field that could hold the digits; the page's HTML
 * is built from this, and the digits come only from the reveal POST.
 */
export type StayCodeState = {
  available: boolean;
  /** Set when the code starts working after now ("12:00 AM on Friday, November 13"). */
  worksFrom: string | null;
  /** When the lock stops taking it. */
  worksUntil: string | null;
  doorCount: number;
};

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * A code the lock will take for this stay: not ended, and starting before
 * the stay closes (a code minted for other dates is not this stay's).
 */
export function codeIsLive(code: Pick<LiveStayCode, 'code' | 'starts_at' | 'ends_at'> | null, now: Date, window: StayWindow): boolean {
  if (!code || !/^\d{4,8}$/.test(code.code ?? '')) return false;
  const end = ms(code.ends_at);
  const start = ms(code.starts_at);
  if (end !== null && end <= now.getTime()) return false;
  if (start !== null && start >= window.closesAt.getTime()) return false;
  return true;
}

/** The page's view of the code. Drops the digits; keeps when it works. */
export function codeState(code: LiveStayCode | null, now: Date, window: StayWindow): StayCodeState {
  if (!code || !codeIsLive(code, now, window)) return { available: false, worksFrom: null, worksUntil: null, doorCount: 0 };
  const start = ms(code.starts_at);
  const end = ms(code.ends_at);
  return {
    available: true,
    worksFrom: start !== null && start > now.getTime() ? easternMoment(new Date(start)) : null,
    worksUntil: end !== null ? easternMoment(new Date(end)) : null,
    doorCount: Math.max(1, code.doorCount),
  };
}

// ── Your stay ──────────────────────────────────────────────────────────────

export type StayLayer = {
  arriveDay: string;
  arriveTime: string | null;
  leaveDay: string;
  leaveTime: string;
  nights: number;
  /** null when the home has no smart lock Helm runs: the code comes in the check-in message. */
  code: StayCodeState | null;
  /** The keypad, for the step that uses the code. */
  lockBrand: string | null;
  steps: GuestItem[];
  /** "This link works until 10:00 AM on Sunday, November 15." */
  until: string;
};

export type StayLayerInput = {
  dates: StayDates;
  times: StayTimes;
  window: StayWindow;
  /** The home's built app: Parking and Address come from its Getting here section. */
  app: GuestApp;
  lockBrand: string | null;
  /** Whether a Seam lock is mapped to the home. */
  lockMapped: boolean;
  code: StayCodeState;
  now: Date;
};

/** The stay card, or null outside the window. Never anything outside it. */
export function buildStayLayer(input: StayLayerInput): StayLayer | null {
  const { dates, times, window, app, now } = input;
  if (stayPhase(now, window) !== 'open') return null;
  const arriveDay = formatLongDate(dates.checkIn);
  const arriveTime = clockLabel(times.checkInTime);
  const leaveDay = formatLongDate(window.leaveDay);
  const leaveTime = clockLabel(window.leaveAt) ?? window.leaveAt;
  const brand = (input.lockBrand ?? '').trim() || null;
  const code = input.lockMapped ? input.code : null;
  const arrival = app.sections.find((s) => s.id === 'arrival');
  const fromArrival = (label: string): GuestItem[] => (arrival?.items ?? []).filter((i) => i.label === label);

  const steps: GuestItem[] = [];
  steps.push({ label: 'Check in', text: arriveTime ? `From ${arriveTime} on ${arriveDay}.` : `${arriveDay}.` });
  steps.push(...fromArrival('Address'));
  steps.push(...fromArrival('Parking'));
  if (code?.available) {
    const keypad = brand ? `the ${brand} keypad` : 'the keypad';
    const doors = code.doorCount > 1 ? ' The same code works on every keypad at the house.' : '';
    steps.push({ label: 'The door', text: `Tap Show my door code above, then enter it on ${keypad}.${doors}` });
  } else {
    steps.push({ label: 'The door', text: 'Your door code comes in your check-in message. Text us if you cannot find it.' });
  }
  steps.push({ label: 'Checkout', text: `By ${leaveTime} on ${leaveDay}. Lock the door behind you.` });

  return {
    arriveDay,
    arriveTime,
    leaveDay,
    leaveTime,
    nights: Math.max(1, nightsBetween(dates.checkIn, window.leaveDay)),
    code,
    lockBrand: brand,
    steps,
    until: `This link works until ${easternMoment(window.closesAt)}. The QR card in the house opens the home guide any time.`,
  };
}

/** Before the window: the one stay line the page shows. */
export function opensLine(window: StayWindow): string {
  return `Your arrival steps and door code appear here at ${easternMoment(window.opensAt)}.`;
}

/**
 * The home's app as the stay page shows it: the Getting here door line
 * points at the stay card instead of the check-in message when the card
 * has a code. Everything else is the permanent page, unchanged.
 */
export function appForStay(app: GuestApp, layer: StayLayer | null): GuestApp {
  if (!layer?.code?.available) return app;
  return {
    ...app,
    sections: app.sections.map((s) =>
      s.id !== 'arrival'
        ? s
        : {
            ...s,
            items: s.items.map((i) =>
              i.label === 'The door'
                ? { ...i, text: `${layer.lockBrand ? `The door has a ${layer.lockBrand} keypad. ` : ''}Your door code is under Your stay, at the top of this page.` }
                : i,
            ),
          },
    ),
  };
}

// ── Which stay a reservation is ────────────────────────────────────────────

/** One bookings row of a stay's cluster (the canonical row and its duplicates). */
export type StayClusterRow = {
  source: string | null;
  external_booking_id: string | null;
  external_confirmation_code: string | null;
};

const norm = (v: string | null | undefined): string => (v ?? '').trim().toUpperCase();

/**
 * Whether a caller's reservation is this stay. The bridge finds the stay by
 * home and exact dates; the ids decide only when both sides carry one: a
 * stay whose rows name a DIFFERENT reservation (a cancel and rebook of the
 * same nights by someone else) is refused rather than handed over. An
 * ical_import row's booking id is a pooled copy (booking-dedupe.ts,
 * nativeBookingId) and vouches for nothing.
 */
export function stayMatchesReservation(rows: readonly StayClusterRow[], ids: { reservationId?: string | null; confirmationCode?: string | null }): boolean {
  const wanted = [norm(ids.reservationId), norm(ids.confirmationCode)].filter(Boolean);
  if (wanted.length === 0) return true;
  const carried = rows
    .flatMap((r) => [r.source === 'ical_import' ? '' : norm(r.external_booking_id), norm(r.external_confirmation_code)])
    .filter(Boolean);
  if (carried.length === 0) return true;
  return wanted.some((w) => carried.includes(w));
}

// ── The bridge request ─────────────────────────────────────────────────────

export type LinkRequest = {
  /** A Helm property id, or a 24-hex Guesty listing id (resolved through guesty_listings). */
  property: string;
  checkIn: string;
  checkOut: string;
  reservationId: string | null;
  confirmationCode: string | null;
};

const ID = /^[A-Za-z0-9_.:-]{1,80}$/;

/** POST /api/guest-app-links body, checked. Unknown keys are ignored. */
export function parseLinkRequest(body: unknown): { ok: true; value: LinkRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body' };
  const b = body as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const property = str(b.property_id) || str(b.listing_id);
  if (!property || !ID.test(property)) return { ok: false, error: 'property_id' };
  const checkIn = str(b.check_in).slice(0, 10);
  const checkOut = str(b.check_out).slice(0, 10);
  if (!YMD.test(checkIn) || !YMD.test(checkOut) || checkOut <= checkIn) return { ok: false, error: 'dates' };
  const opt = (v: unknown): string | null => {
    const s = str(v);
    return s && ID.test(s) ? s : null;
  };
  return { ok: true, value: { property, checkIn, checkOut, reservationId: opt(b.reservation_id), confirmationCode: opt(b.confirmation_code) } };
}

// ── The email line (direct bookings only) ─────────────────────────────────
//
// A direct booking's party are Stay Cape Ann's own guests, so their stay link
// may carry one optional line: anyone in the group can leave an email for the
// list (src/lib/guest-app-join.ts writes it). An OTA booking's party are that
// platform's guests: Airbnb's Off-Platform Policy bars asking anyone on the
// stay for an email, from bookings made 2026-11-20 on, and earlier ones may
// not be signed up for a contact list. Vrbo and Booking.com are treated the
// same until their rules are read. The printed home link never asks: it
// cannot tell whose stay its reader is on.

/**
 * The channels a stay's bookings rows may carry and still ask. The canonical
 * row must be `direct`; a duplicate may be `direct` too (the Guesty feed's
 * copy) or `block` (the OTA calendars closing the same nights). Any other
 * channel anywhere in the stay (an Airbnb twin, `manual`, `other`) means it
 * is not plainly ours, and the line stays off.
 */
const JOIN_DUPLICATE_CHANNELS = new Set(['direct', 'block']);

export function stayMayAskEmail(canonicalChannel: string | null, clusterChannels: ReadonlyArray<string | null>): boolean {
  if (canonicalChannel !== 'direct') return false;
  return clusterChannels.every((c) => c !== null && JOIN_DUPLICATE_CHANNELS.has(c));
}

/** One stay link adds at most this many emails: a house party, not a mailing list. */
export const STAY_JOIN_MAX = 20;

/** The form's email, checked (the shared writer's own rule), or null. */
export function parseJoinEmail(raw: unknown): string | null {
  const email = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** What a signup came to. `closed`: the link no longer opens anything, or the stay may not ask. */
export type StayJoinResult = 'joined' | 'invalid' | 'full' | 'failed' | 'closed';
export type StayJoinNotice = Exclude<StayJoinResult, 'closed'>;

/** The ?join= the form's POST redirects back with, read on the page. Anything else is no notice. */
export function joinNotice(param: unknown): StayJoinNotice | null {
  return param === 'joined' || param === 'invalid' || param === 'full' || param === 'failed' ? param : null;
}

// ── The page ───────────────────────────────────────────────────────────────

/**
 * What /h/s/<token> renders. The digits are in none of these. `join` is
 * stayMayAskEmail for the stay: whether the page may show the email line.
 */
export type GuestStayView =
  | { kind: 'void' }
  | { kind: 'over'; app: GuestApp; join: boolean }
  | { kind: 'before'; app: GuestApp; opens: string; join: boolean }
  | { kind: 'open'; app: GuestApp; stay: StayLayer; join: boolean };
