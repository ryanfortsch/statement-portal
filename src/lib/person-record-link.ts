/**
 * One person, two records: the Guest list record (`audience_contacts`,
 * `/guests/<id>`) and the CRM contact (`contacts`, `/crm/<id>`). Merging the
 * two tables is later work; until then each page links the other, and Cmd+K
 * finds a guest and opens the record that knows the most about them.
 *
 * A link is an exact match only: the same email (case aside) or the same
 * phone as ten digits. One match is a link. None, or several, is no link,
 * never a guess. The Guest list keeps no phone, so from its side the match
 * is by email; phones come in through the Helm-native `guests` table when
 * search finds a guest by number.
 *
 * Pure: no database. person-record-link-server.ts does the reads.
 */
import { normalizePhone } from './quo-lines.ts';

/** An email lowercased and trimmed; '' when it is not one. */
export function emailKey(raw: string | null | undefined): string {
  const v = (raw || '').trim().toLowerCase();
  return v.includes('@') ? v : '';
}

/** A phone as ten digits; '' when it is not a full number. */
export function phoneKey(raw: string | null | undefined): string {
  const digits = normalizePhone(raw);
  return digits.length === 10 ? digits : '';
}

export type CrmLinkRow = { id: string; emails: string[] | null; phone: string | null };
export type GuestListLinkRow = { id: string; email: string | null };

/** The one CRM contact holding one of these emails or phones, or null. */
export function oneCrmContact(person: { emails: string[]; phones: string[] }, rows: CrmLinkRow[]): string | null {
  const emails = new Set(person.emails.map(emailKey).filter(Boolean));
  const phones = new Set(person.phones.map(phoneKey).filter(Boolean));
  if (emails.size === 0 && phones.size === 0) return null;
  const ids = new Set<string>();
  for (const r of rows) {
    const byEmail = (r.emails ?? []).some((e) => emails.has(emailKey(e)));
    const byPhone = phones.has(phoneKey(r.phone));
    if (byEmail || byPhone) ids.add(r.id);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

/** The one Guest list record holding one of these emails, or null. */
export function oneGuestListRecord(emails: string[], rows: GuestListLinkRow[]): string | null {
  const keys = new Set(emails.map(emailKey).filter(Boolean));
  if (keys.size === 0) return null;
  const ids = new Set(rows.filter((r) => keys.has(emailKey(r.email))).map((r) => r.id));
  return ids.size === 1 ? [...ids][0] : null;
}

/** Characters that would break a PostgREST filter value; an email carrying one is not looked up. */
const UNSAFE = /[,(){}"\\\s]/;

/** The spellings an exact email can be stored under, for an `in` / `ov` read. The match itself is checked in code. */
export function emailVariants(emails: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of emails) {
    const v = (raw || '').trim();
    if (!v.includes('@') || UNSAFE.test(v)) continue;
    out.add(v);
    out.add(v.toLowerCase());
  }
  return [...out];
}

/** An ilike pattern matching a number however it was typed: "(978) 865-2575", "+1 978...", "9788652575". */
export function phoneLikePattern(digits: string): string {
  return `%${digits.split('').join('%')}%`;
}

/**
 * The PostgREST `or` filter that reads every CRM contact that could hold one
 * of these emails or phones. Loose on purpose (a phone pattern can over-read);
 * oneCrmContact keeps only the exact matches. Null when there is nothing to ask.
 */
export function crmCandidateFilter(emails: string[], phones: string[]): string | null {
  const parts: string[] = [];
  const variants = emailVariants(emails);
  if (variants.length > 0) parts.push(`emails.ov.{${variants.join(',')}}`);
  for (const p of new Set(phones.map(phoneKey).filter(Boolean))) parts.push(`phone.ilike.${phoneLikePattern(p)}`);
  return parts.length > 0 ? parts.join(',') : null;
}

// ─── Guests in search ─────────────────────────────────────────────────

/** A Guest list row as search reads it. */
export type GuestListSearchRow = { id: string; email: string | null; first_name: string | null; last_name: string | null };
/** A Helm-native `guests` row as search reads it: the one guest table that keeps a phone. */
export type HelmGuestSearchRow = {
  email: string | null;
  phone: string | null;
  phone_e164: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
};

export type GuestMatch = {
  /** Where the row opens: the CRM contact when one matches, else the Guest list record. */
  href: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** Which record it opens. */
  record: 'crm' | 'guest_list';
};

/** The digits to look a phone up by, when the query reads as a phone; '' otherwise. */
export function phoneQueryDigits(q: string): string {
  const v = q.trim();
  if (!/^[\d\s()+.-]+$/.test(v)) return '';
  let digits = v.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length >= 4 ? digits : '';
}

function nameOf(first: string | null, last: string | null, full?: string | null): string {
  const joined = [first, last].map((s) => (s || '').trim()).filter(Boolean).join(' ');
  return joined || (full || '').trim();
}

type Person = { name: string; emails: string[]; phones: string[]; guestListId: string | null };

/** The people a search found, one per email (or per phone when there is no email). */
export function gatherPeople(listRows: GuestListSearchRow[], helmRows: HelmGuestSearchRow[]): Person[] {
  const byKey = new Map<string, Person>();
  for (const r of listRows) {
    const key = emailKey(r.email) || `list:${r.id}`;
    if (!byKey.has(key)) byKey.set(key, { name: nameOf(r.first_name, r.last_name), emails: r.email ? [r.email] : [], phones: [], guestListId: r.id });
  }
  for (const r of helmRows) {
    const phone = phoneKey(r.phone_e164) || phoneKey(r.phone);
    const key = emailKey(r.email) || (phone ? `phone:${phone}` : '');
    if (!key) continue;
    const found = byKey.get(key);
    if (found) {
      if (phone && !found.phones.includes(phone)) found.phones.push(phone);
      if (!found.name) found.name = nameOf(r.first_name, r.last_name, r.full_name);
      continue;
    }
    byKey.set(key, { name: nameOf(r.first_name, r.last_name, r.full_name), emails: r.email ? [r.email] : [], phones: phone ? [phone] : [], guestListId: null });
  }
  return [...byKey.values()];
}

/**
 * Each person's record: the CRM contact on an exact match, else their Guest
 * list record (found directly, or by email in `extraList`). A person with
 * neither has no page to open and is left out. One row per destination.
 */
export function resolveGuestMatches(people: Person[], extraList: GuestListLinkRow[], crmRows: CrmLinkRow[], limit: number): GuestMatch[] {
  const out: GuestMatch[] = [];
  const seen = new Set<string>();
  for (const p of people) {
    const crmId = oneCrmContact(p, crmRows);
    const listId = p.guestListId ?? oneGuestListRecord(p.emails, extraList);
    const href = crmId ? `/crm/${encodeURIComponent(crmId)}` : listId ? `/guests/${encodeURIComponent(listId)}` : null;
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const email = p.emails[0] ?? null;
    out.push({ href, name: p.name || email || p.phones[0] || 'Guest', email, phone: p.phones[0] ?? null, record: crmId ? 'crm' : 'guest_list' });
    if (out.length >= limit) break;
  }
  return out;
}

/** Guest rows that open a contact the Contacts group already lists say it once: the Contacts row stays. */
export function withoutListedContacts(guests: GuestMatch[], contactIds: string[]): GuestMatch[] {
  const listed = new Set(contactIds.map((id) => `/crm/${encodeURIComponent(id)}`));
  return guests.filter((g) => !listed.has(g.href));
}

/** A phone as people read it: (978) 865-2575. */
export function formatPhone(digits: string | null): string {
  const d = phoneKey(digits);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : digits || '';
}
