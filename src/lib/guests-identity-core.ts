/**
 * Pure rules for the Helm-native guest record (guests-identity.ts).
 *
 * A booking names a guest three ways at most: a name, an email, a phone.
 * This module decides which of those identifies a person (pickMatchStrategy)
 * and how a found record absorbs a new booking's fields without losing what
 * it already knows (mergeGuestFields). The database edge lives in
 * guests-identity.ts; nothing here does IO.
 *
 * Two rules the whole module bends around:
 *   - never invent an email. A guest with only a phone stays email-less;
 *     placeholder addresses poison the unique index and the audience sync.
 *   - an OTA proxy address (guest.airbnb.com, mchat.booking.com) identifies
 *     a conversation, not a person, so when the booking also carries a
 *     phone the phone is tried first and the proxy address only as a
 *     fallback.
 *
 * The one import is normalizePhone from quo-lines.ts, itself import-free.
 */
import { normalizePhone } from './quo-lines.ts';

export type GuestLike = {
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
};

export type GuestRecordFields = {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  phone_e164: string | null;
};

export type MatchStrategy =
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phone: string };

/** lower(trim(email)); null unless it looks like an address. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const at = s.indexOf('@');
  if (at < 1 || at === s.length - 1) return null;
  if (s.indexOf('@', at + 1) !== -1) return null;
  if (/\s/.test(s)) return null;
  return s;
}

/**
 * E.164 from whatever a form or an OTA feed handed us. US and Canada are
 * the default country: ten digits (or eleven starting with 1) become +1...;
 * an explicit + with at least ten digits is kept as-is. Anything shorter is
 * not a phone and yields null rather than a half-number.
 */
export function toE164Phone(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const allDigits = s.replace(/\D/g, '');
  if (s.startsWith('+') && allDigits.length >= 10 && allDigits.length <= 15 && !allDigits.startsWith('0')) {
    if (allDigits.length === 11 && allDigits.startsWith('1')) return `+${allDigits}`;
    if (allDigits.length === 10) return `+1${allDigits}`;
    return `+${allDigits}`;
  }
  const us = normalizePhone(s);
  if (us.length === 10) return `+1${us}`;
  return null;
}

/**
 * In what order do we look for this guest? Email first, then phone, per
 * the identity rule; but a proxy email is demoted below the phone when
 * both exist. An empty list means the booking carries no identity at all
 * (an iCal "Reserved" row) and no guest record should be made.
 */
export function pickMatchStrategy(
  g: GuestLike,
  opts: { isProxyEmail?: (email: string) => boolean } = {},
): MatchStrategy[] {
  const email = normalizeEmail(g.guest_email);
  const phone = toE164Phone(g.guest_phone);
  const proxy = !!email && !!opts.isProxyEmail && opts.isProxyEmail(email);
  const out: MatchStrategy[] = [];
  if (email && !proxy) out.push({ kind: 'email', email });
  if (phone) out.push({ kind: 'phone', phone });
  if (email && proxy) out.push({ kind: 'email', email });
  return out;
}

/** "Jane Q. Doe" -> first "Jane Q.", last "Doe". A single word is a first name. */
export function splitName(full: string | null | undefined): { first_name: string | null; last_name: string | null } {
  const s = (full ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return { first_name: null, last_name: null };
  const parts = s.split(' ');
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] };
}

function blank(v: string | null | undefined): boolean {
  return !v || !v.trim();
}

/**
 * Fold a booking's guest fields into an existing record. Fill blanks only:
 * a real value on file is never overwritten by a different real value
 * (that is a human's call), with one exception, a proxy email on file
 * yields to a real one. Returns the patch to write and whether anything
 * changed, so a no-op booking costs no UPDATE.
 */
export function mergeGuestFields(
  existing: GuestRecordFields,
  incoming: GuestLike,
  opts: { isProxyEmail?: (email: string) => boolean } = {},
): { patch: Partial<GuestRecordFields>; changed: boolean } {
  const patch: Partial<GuestRecordFields> = {};

  const inEmail = normalizeEmail(incoming.guest_email);
  const exEmail = normalizeEmail(existing.email);
  if (inEmail && inEmail !== exEmail) {
    const exIsProxy = !!exEmail && !!opts.isProxyEmail && opts.isProxyEmail(exEmail);
    const inIsProxy = !!opts.isProxyEmail && opts.isProxyEmail(inEmail);
    if (!exEmail || (exIsProxy && !inIsProxy)) patch.email = inEmail;
  }

  const inPhone = toE164Phone(incoming.guest_phone);
  if (inPhone && inPhone !== existing.phone_e164) {
    if (blank(existing.phone_e164)) {
      patch.phone_e164 = inPhone;
      patch.phone = (incoming.guest_phone ?? '').trim() || inPhone;
    }
  } else if (inPhone && blank(existing.phone) && incoming.guest_phone) {
    patch.phone = incoming.guest_phone.trim();
  }

  const inName = (incoming.guest_name ?? '').replace(/\s+/g, ' ').trim();
  if (inName && blank(existing.full_name)) {
    patch.full_name = inName;
    const split = splitName(inName);
    if (blank(existing.first_name) && split.first_name) patch.first_name = split.first_name;
    if (blank(existing.last_name) && split.last_name) patch.last_name = split.last_name;
  } else if (inName && (blank(existing.first_name) || blank(existing.last_name))) {
    const split = splitName(existing.full_name ?? inName);
    if (blank(existing.first_name) && split.first_name) patch.first_name = split.first_name;
    if (blank(existing.last_name) && split.last_name) patch.last_name = split.last_name;
  }

  return { patch, changed: Object.keys(patch).length > 0 };
}

/** The insert payload for a guest nobody matched. Null email stays null. */
export function newGuestFields(incoming: GuestLike): GuestRecordFields {
  const name = (incoming.guest_name ?? '').replace(/\s+/g, ' ').trim() || null;
  const split = splitName(name);
  const e164 = toE164Phone(incoming.guest_phone);
  const rawPhone = (incoming.guest_phone ?? '').trim() || null;
  return {
    first_name: split.first_name,
    last_name: split.last_name,
    full_name: name,
    email: normalizeEmail(incoming.guest_email),
    phone: rawPhone,
    phone_e164: e164,
  };
}
