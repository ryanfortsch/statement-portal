/**
 * Do not host again: the flag on a guest record, and the one red line that
 * carries it wherever a guest appears.
 *
 * Until 2026-10-30 Helm had no place to say a guest is not welcome back. A
 * guest harassed the team after an October stay; Airbnb's Block covered
 * Airbnb, and VRBO, Booking.com and a direct Stay Cape Ann booking had no
 * guard at all. The concierge's red review tier records only in its own
 * ledger. So the flag lives on the guest record (`audience_contacts`, keyed
 * by email), owners and staff set it with a reason, and every surface that
 * names a guest reads it: the record, the messaging approval card, the
 * booking record and row, and the New numbers card.
 *
 * Resolution order, strongest key first:
 *
 *   1. the guest record's own id (the record page)
 *   2. the Guesty guest id (an OTA card knows its reservation, never an
 *      email or a phone; `audience_contacts.guesty_guest_id` is stamped by
 *      the Guesty guests sync)
 *   3. email, lower-cased and trimmed, the record's unique key and what a
 *      booking and an email card carry
 *   4. phone, by the last ten digits, the weakest key (a household shares
 *      one; an OTA relays another), so it is the last resort
 *
 * The phone key is normalized by `normalizePhone` from quo-lines, the one
 * rule the Quo ingest and the number directory (known-numbers.ts) use, so
 * this never disagrees with them about which digits are the number. The
 * register's phones are collected by the server loader from the places a
 * guest's phone already lives (`guests`, `bookings`); nothing here reads
 * a database.
 *
 * Pure: no database, no clock beyond formatting a stored timestamp.
 */
import { normalizePhone } from './quo-lines.ts';

/** The four columns on audience_contacts. */
export type DoNotHostFlag = {
  do_not_host: boolean;
  do_not_host_reason: string | null;
  do_not_host_set_by: string | null;
  do_not_host_set_at: string | null;
};

/** What a surface needs to print the line: why, who decided, when. */
export type DoNotHostNote = {
  reason: string | null;
  set_by: string | null;
  set_at: string | null;
};

/** One flagged guest, as the register loads it: every key the record is
 *  known by, and the note. */
export type DoNotHostGuest = DoNotHostNote & {
  contact_id: string;
  name: string;
  guesty_guest_ids: string[];
  emails: string[];
  phones: string[];
};

export type DoNotHostMatchedBy = 'contact' | 'guesty_guest' | 'email' | 'phone';

export type DoNotHostMatch = DoNotHostNote & {
  contact_id: string;
  name: string;
  matched_by: DoNotHostMatchedBy;
};

/** What a surface knows about the guest in front of it. Any subset. */
export type DoNotHostLookup = {
  contactId?: string | null;
  guestyGuestId?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type DoNotHostIndex = {
  resolve(lookup: DoNotHostLookup): DoNotHostMatch | null;
  /** How many guests are flagged. Zero means every resolve is null. */
  size: number;
};

export const DO_NOT_HOST_LABEL = 'Do not host again';

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

/** A phone key, or '' when the digits are not a ten-digit number. */
function phoneKey(raw: string | null | undefined): string {
  const n = normalizePhone(raw);
  return n.length === 10 ? n : '';
}

/** The record's flag as a note, or null when the guest is not flagged. */
export function doNotHostNote(flag: Partial<DoNotHostFlag> | null | undefined): DoNotHostNote | null {
  if (!flag?.do_not_host) return null;
  return {
    reason: flag.do_not_host_reason ?? null,
    set_by: flag.do_not_host_set_by ?? null,
    set_at: flag.do_not_host_set_at ?? null,
  };
}

/**
 * The one red line: "Do not host again · Harassed the team by text after
 * checkout". The reason is required when the flag is set, so the bare label
 * is only ever a row flagged outside the form.
 */
export function doNotHostLine(note: Pick<DoNotHostNote, 'reason'>): string {
  const reason = (note.reason ?? '').trim().replace(/\s+/g, ' ');
  return reason ? `${DO_NOT_HOST_LABEL} · ${reason}` : DO_NOT_HOST_LABEL;
}

/** Behind the line (its title): "Flagged by dotti@risingtidestr.com on Oct 30, 2026". */
export function doNotHostDetail(note: Pick<DoNotHostNote, 'set_by' | 'set_at'>): string {
  const who = (note.set_by ?? '').trim();
  const when = formatDay(note.set_at);
  const parts = ['Flagged'];
  if (who) parts.push(`by ${who}`);
  if (when) parts.push(`on ${when}`);
  return parts.join(' ');
}

function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
}

/**
 * Build the lookup once per register. When two flagged records share a key
 * (two records for one person, one phone in two households), the first in
 * register order wins; the loader orders newest flag first.
 */
export function buildDoNotHostIndex(guests: readonly DoNotHostGuest[]): DoNotHostIndex {
  const byContact = new Map<string, DoNotHostGuest>();
  const byGuestyGuest = new Map<string, DoNotHostGuest>();
  const byEmail = new Map<string, DoNotHostGuest>();
  const byPhone = new Map<string, DoNotHostGuest>();
  const put = (m: Map<string, DoNotHostGuest>, key: string, g: DoNotHostGuest) => {
    if (key && !m.has(key)) m.set(key, g);
  };
  for (const g of guests) {
    put(byContact, g.contact_id, g);
    for (const id of g.guesty_guest_ids) put(byGuestyGuest, id.trim(), g);
    for (const e of g.emails) put(byEmail, normalizeEmail(e), g);
    for (const p of g.phones) put(byPhone, phoneKey(p), g);
  }
  const match = (g: DoNotHostGuest, matched_by: DoNotHostMatchedBy): DoNotHostMatch => ({
    contact_id: g.contact_id,
    name: g.name,
    reason: g.reason,
    set_by: g.set_by,
    set_at: g.set_at,
    matched_by,
  });
  return {
    size: guests.length,
    resolve(lookup) {
      if (guests.length === 0) return null;
      const byId = lookup.contactId ? byContact.get(lookup.contactId) : undefined;
      if (byId) return match(byId, 'contact');
      const byGuesty = lookup.guestyGuestId ? byGuestyGuest.get(lookup.guestyGuestId.trim()) : undefined;
      if (byGuesty) return match(byGuesty, 'guesty_guest');
      const email = normalizeEmail(lookup.email);
      const byMail = email ? byEmail.get(email) : undefined;
      if (byMail) return match(byMail, 'email');
      const phone = phoneKey(lookup.phone);
      const byTel = phone ? byPhone.get(phone) : undefined;
      if (byTel) return match(byTel, 'phone');
      return null;
    },
  };
}

/** An index with nobody in it, for a surface whose register read failed:
 *  the flag is an enrichment, never a gate, so a failed read shows nothing. */
export const EMPTY_DO_NOT_HOST_INDEX: DoNotHostIndex = buildDoNotHostIndex([]);
