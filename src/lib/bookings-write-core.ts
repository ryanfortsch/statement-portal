/**
 * Pure helpers for the locked booking writer (bookings-write.ts).
 *
 * Everything here is arithmetic on strings and plain objects so node:test
 * can load it without a database: the confirmation code mint, the
 * booking_events diff, the SQLSTATE P0002 detail parser, and the query
 * string contract a server action uses to hand a refused overlap back to
 * the page that submitted the form.
 *
 * No imports. Keep it that way.
 */

/**
 * Crockford base32: digits plus the uppercase alphabet without I, L, O and
 * U, so a code read over the phone or off a cleaner's printout cannot be
 * mistyped as a look-alike. 32 symbols, 6 of them: about a billion codes.
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const HELM_CODE_PREFIX = 'HELM-';
export const HELM_CODE_BODY_LENGTH = 6;

const HELM_CODE_RE = /^HELM-[0-9A-HJKMNP-TV-Z]{6}$/;

/**
 * A Helm-minted confirmation code: 'HELM-' plus six Crockford base32
 * characters. The prefix keeps it visibly apart from Guesty's HM..., Airbnb's
 * HA-..., Booking.com's BC-... and the GY- shadow codes, so a code that
 * starts with HELM- is always a stay Helm itself created.
 *
 * `random` is injectable for tests; it must return a float in [0, 1).
 */
export function mintHelmConfirmationCode(random: () => number = Math.random): string {
  let body = '';
  for (let i = 0; i < HELM_CODE_BODY_LENGTH; i++) {
    const r = random();
    const idx = Math.min(CROCKFORD_ALPHABET.length - 1, Math.max(0, Math.floor(r * CROCKFORD_ALPHABET.length)));
    body += CROCKFORD_ALPHABET[idx];
  }
  return HELM_CODE_PREFIX + body;
}

export function isHelmCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && HELM_CODE_RE.test(code.trim());
}

// ── booking_events diff ───────────────────────────────────────────────

export type EventDiff = {
  /** Keys whose value changed, in the order they were first seen. */
  changed: string[];
  /** The old value of every changed key. */
  before: Record<string, unknown>;
  /** The new value of every changed key. */
  after: Record<string, unknown>;
};

/** undefined and '' read as null so a blank form field never fakes a change. */
function norm(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  return v;
}

function same(a: unknown, b: unknown): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  if (na === null || nb === null) return false;
  if (typeof na === 'number' && typeof nb === 'string') return String(na) === nb.trim();
  if (typeof na === 'string' && typeof nb === 'number') return na.trim() === String(nb);
  if (typeof na === 'object' || typeof nb === 'object') return JSON.stringify(na) === JSON.stringify(nb);
  return false;
}

/**
 * The before / after payload for a booking_events row: only the keys whose
 * value actually changed, so the change log reads as a diff and not as two
 * copies of the row. `keys` narrows the comparison (a guest-fields update
 * must not report a money column the caller never touched); without it the
 * union of both objects' keys is compared.
 */
export function diffForEvent(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  keys?: readonly string[],
): EventDiff {
  const b = before ?? {};
  const a = after ?? {};
  const candidates = keys ?? Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  const diff: EventDiff = { changed: [], before: {}, after: {} };
  for (const k of candidates) {
    if (!(k in b) && !(k in a)) continue;
    if (same(b[k], a[k])) continue;
    diff.changed.push(k);
    diff.before[k] = norm(b[k]);
    diff.after[k] = norm(a[k]);
  }
  return diff;
}

// ── the overlap the database refused ──────────────────────────────────

/** What helm_create_booking / helm_move_booking put in the P0002 detail. */
export type BookingConflict = {
  booking_id: string;
  status: string;
  /** YYYY-MM-DD */
  check_in: string;
  /** YYYY-MM-DD, exclusive */
  check_out: string;
};

/**
 * The RPCs raise 'booking_overlap' with errcode P0002 and a JSON `detail`.
 * PostgREST surfaces that as error.code / error.details. Anything that is
 * not the expected shape yields null so the caller can still refuse the
 * write with a generic message.
 */
export function parseOverlapDetail(detail: unknown): BookingConflict | null {
  if (detail == null) return null;
  let obj: unknown = detail;
  if (typeof detail === 'string') {
    try {
      obj = JSON.parse(detail);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const id = typeof o.booking_id === 'string' ? o.booking_id : null;
  const ci = typeof o.check_in === 'string' ? o.check_in.slice(0, 10) : null;
  const co = typeof o.check_out === 'string' ? o.check_out.slice(0, 10) : null;
  if (!id || !ci || !co) return null;
  return { booking_id: id, status: typeof o.status === 'string' ? o.status : 'confirmed', check_in: ci, check_out: co };
}

/** Is this a PostgREST / Postgres error for the RPC's overlap exception? */
export function isOverlapErrorCode(code: unknown): boolean {
  return code === 'P0002';
}

// ── the redirect contract ─────────────────────────────────────────────
// A server action cannot render; it redirects back to the form with the
// conflict in the query string, and the page renders it. These two
// functions are the whole contract, so a page owner imports
// conflictFromSearchParams and never parses by hand.

export const CONFLICT_PARAM_KEYS = {
  id: 'conflict_id',
  status: 'conflict_status',
  checkIn: 'conflict_in',
  checkOut: 'conflict_out',
} as const;

export function conflictToSearchParams(
  conflict: BookingConflict,
  extra: Record<string, string | null | undefined> = {},
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && v !== '') sp.set(k, v);
  }
  sp.set(CONFLICT_PARAM_KEYS.id, conflict.booking_id);
  sp.set(CONFLICT_PARAM_KEYS.status, conflict.status);
  sp.set(CONFLICT_PARAM_KEYS.checkIn, conflict.check_in);
  sp.set(CONFLICT_PARAM_KEYS.checkOut, conflict.check_out);
  return sp.toString();
}

type SearchParamsLike = Record<string, string | string[] | undefined> | URLSearchParams;

function readParam(sp: SearchParamsLike, key: string): string | null {
  if (sp instanceof URLSearchParams) return sp.get(key);
  const v = sp[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function conflictFromSearchParams(sp: SearchParamsLike): BookingConflict | null {
  const id = readParam(sp, CONFLICT_PARAM_KEYS.id);
  const ci = readParam(sp, CONFLICT_PARAM_KEYS.checkIn);
  const co = readParam(sp, CONFLICT_PARAM_KEYS.checkOut);
  if (!id || !ci || !co || !YMD_RE.test(ci) || !YMD_RE.test(co)) return null;
  return {
    booking_id: id,
    status: readParam(sp, CONFLICT_PARAM_KEYS.status) ?? 'confirmed',
    check_in: ci,
    check_out: co,
  };
}

/** One line for a banner: "Those nights overlap a confirmed stay, 2026-10-03 to 2026-10-07." */
export function describeConflict(c: BookingConflict): string {
  const what = c.status === 'block' ? 'a block' : c.status === 'completed' ? 'a completed stay' : 'a confirmed stay';
  return `Those nights overlap ${what}, ${c.check_in} to ${c.check_out}.`;
}

// ── small date guards shared by the actions ───────────────────────────

export function isYmd(s: string | null | undefined): s is string {
  return typeof s === 'string' && YMD_RE.test(s);
}

/** Nights in [checkIn, checkOut). 0 or negative when the range is reversed. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** The columns updateGuestFields may touch. Anything else is refused. */
export const GUEST_FIELD_KEYS = ['guest_name', 'guest_email', 'guest_phone', 'num_guests', 'notes'] as const;
export type GuestFieldKey = (typeof GUEST_FIELD_KEYS)[number];

/** The columns updateBookingMoney may touch. */
export const MONEY_FIELD_KEYS = ['gross_amount', 'cleaning_fee', 'taxes', 'payout'] as const;
export type MoneyFieldKey = (typeof MONEY_FIELD_KEYS)[number];

/**
 * Keep only the allowed keys of a patch, dropping undefined so an absent
 * form field is "leave alone" and an empty string is "clear".
 */
export function pickPatch<K extends string>(
  patch: Record<string, unknown>,
  allowed: readonly K[],
): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {};
  for (const k of allowed) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === undefined) continue;
    out[k] = v === '' ? null : v;
  }
  return out;
}
