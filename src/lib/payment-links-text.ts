/**
 * Pure helpers for guest payment links: the SMS wording, resolving the
 * concierge's property slug to a Helm property id, reading a reservation id
 * back out of a request key, and the status a ledger row is in.
 *
 * No imports on purpose. The Send-lens panel (a client component) previews
 * the text with these, the server builds the real one with the same code,
 * and `npm test` pins the wording without a database.
 */

/** Concierge slugs that differ from Helm's property id. Mirrors
 *  `_HELM_PROPERTY_ALIASES` in stay-concierge/src/gear_requests.py. */
export const CONCIERGE_SLUG_ALIASES: Record<string, string> = {
  '3_south_street': '3_south_st',
  // Unified to 3_windward on 2026-08-24; a stale stored slug still maps.
  '3_windward_pt': '3_windward',
};

const STREET_SUFFIXES = new Set([
  'st', 'street', 'rd', 'road', 'ave', 'avenue', 'ln', 'lane', 'dr', 'drive',
  'ct', 'court', 'pl', 'place', 'way', 'ter', 'terrace', 'pt', 'point', 'blvd',
]);

/** "3_south_street" and "3_south_st" both stem to "3_south". Only trailing
 *  suffix words are dropped, so "53_rocky_neck_2" keeps its sub-unit tag. */
export function slugStem(slug: string): string {
  const parts = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .split('_')
    .filter(Boolean);
  while (parts.length > 1 && STREET_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join('_');
}

/**
 * The Helm property id for a concierge listing slug: exact id first, then
 * the alias table, then a unique suffix-stripped stem match. Null when
 * nothing matches or two ids could, so the caller asks instead of guessing
 * (a wrong property here means the money lands in the wrong owner's Stripe).
 */
export function resolvePropertyIdFromSlug(slug: string, knownIds: string[]): string | null {
  const s = (slug || '').trim().toLowerCase();
  if (!s) return null;
  if (knownIds.includes(s)) return s;
  const alias = CONCIERGE_SLUG_ALIASES[s];
  if (alias && knownIds.includes(alias)) return alias;
  const stem = slugStem(s);
  const hits = knownIds.filter((id) => slugStem(id) === stem);
  return hits.length === 1 ? hits[0] : null;
}

/** "$200" / "$223.40": whole dollars drop the cents, like the concierge SMS. */
export function money(cents: number): string {
  const amount = cents / 100;
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** The guest's first name from a full name; "there" when we have none. */
export function firstName(full: string | null | undefined): string {
  const first = (full || '').trim().split(/\s+/)[0] || '';
  return first || 'there';
}

/** "your host from Stay at X" scans; "your host at Stay at X" stutters. */
function whereClause(propertyTitle: string): string {
  const t = (propertyTitle || '').trim();
  if (!t) return '';
  return t.toLowerCase().startsWith('stay at') ? ` from ${t}` : ` at ${t}`;
}

/** "$223.40 - $200 plus $23.40 MA occupancy tax", or just "$200" untaxed.
 *  Stated in the text because the number in the text must match the number
 *  on the Stripe page or the guest decides something is wrong. */
export function amountClause(a: { baseCents: number; taxCents: number; totalCents: number }): string {
  if (a.taxCents > 0) {
    return `${money(a.totalCents)} - ${money(a.baseCents)} plus ${money(a.taxCents)} MA occupancy tax`;
  }
  return money(a.totalCents || a.baseCents);
}

/** Placeholder the panel shows while no link exists yet; the server swaps
 *  the real URL in on create. */
export const LINK_PLACEHOLDER = '[link]';

/**
 * The proactive text. Same voice and shape as the concierge's reactive
 * add-on SMS (Allie, external title, amount with the tax split, reply-here
 * closer), minus "as promised", since nobody promised anything yet.
 */
export function buildPaymentLinkSms(a: {
  guestFirst: string;
  label: string;
  baseCents: number;
  taxCents: number;
  totalCents: number;
  propertyTitle: string;
  url: string;
}): string {
  const first = (a.guestFirst || '').trim() || 'there';
  const label = (a.label || '').trim() || 'charge';
  return (
    `Hi ${first}, it's Allie, your host${whereClause(a.propertyTitle)}. Here's the secure ` +
    `payment link for the ${label} (${amountClause(a)}): ${a.url} ` +
    `Thanks so much, and just reply here if you have any trouble with it!`
  );
}

/** The reminder text for a link that is still open. */
export function buildPaymentLinkNudgeSms(a: {
  guestFirst: string;
  label: string;
  totalCents: number;
  propertyTitle: string;
  url: string;
}): string {
  const first = (a.guestFirst || '').trim() || 'there';
  const label = (a.label || '').trim() || 'charge';
  const t = (a.propertyTitle || '').trim();
  const where = t ? (t.toLowerCase().startsWith('stay at') ? ` from ${t}` : ` at ${t}`) : '';
  return (
    `Hi ${first}, it's Allie${where}. A quick reminder that the secure payment link for the ` +
    `${label} (${money(a.totalCents)}) is still open whenever you have a minute: ${a.url} ` +
    `Reply here if you have any trouble with it. Thank you!`
  );
}

/** Put the real URL where the preview had the placeholder. A hand-edited
 *  text that lost the placeholder gets the URL appended, so a link can never
 *  go out without its link. */
export function fillLinkPlaceholder(body: string, url: string): string {
  const trimmed = (body || '').trim();
  if (!trimmed) return url;
  if (trimmed.includes(LINK_PLACEHOLDER)) return trimmed.split(LINK_PLACEHOLDER).join(url);
  if (trimmed.includes(url)) return trimmed;
  return `${trimmed} ${url}`;
}

/** Digits to E.164 for US/CA numbers; '' when it is not a usable number. */
export function toE164(raw: string | null | undefined): string {
  const s = (raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (s.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return '';
}

/** "+19785551234" -> "(978) 555-1234" for the panel and the ledger. */
export function prettyPhone(e164: string): string {
  const d = (e164 || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) {
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return e164 || '';
}

/** Idempotency key for an operator-minted link. Reservation-keyed so a
 *  double click reuses one link; the label slug and cents keep two different
 *  charges on the same stay apart. */
export function helmRequestKey(a: {
  reservationId: string;
  conversationId: string;
  propertyId: string;
  label: string;
  amountCents: number;
  suffix?: number;
}): string {
  const anchor = a.reservationId || a.conversationId || a.propertyId;
  const slug = a.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const base = `helm:${anchor}:${slug}:${a.amountCents}`;
  return a.suffix && a.suffix > 1 ? `${base}:${a.suffix}` : base;
}

/**
 * The Guesty reservation id a concierge or Helm key was minted against.
 * Concierge keys read `addon:<reservation>:<slug>:<cents>` and fall back to
 * an approval uuid when the card had no reservation; only a Guesty-shaped
 * 24-hex id is returned. Deposit keys (`ffdeposit:`) carry no reservation.
 */
export function reservationIdFromRequestKey(key: string): string {
  const parts = (key || '').split(':');
  if (parts.length < 2) return '';
  if (parts[0] !== 'addon' && parts[0] !== 'helm') return '';
  return /^[0-9a-f]{24}$/i.test(parts[1]) ? parts[1] : '';
}

/** How long an unpaid link waits before the home feed calls it out. */
export const UNPAID_AFTER_HOURS = 24;
/** Links older than this are dead deals: not polled, not shown. Matches the
 *  concierge sweep's lookback. */
export const LINK_LOOKBACK_DAYS = 45;

export type PaymentLinkStatus = 'paid' | 'cancelled' | 'unsent' | 'waiting' | 'overdue';

export type PaymentLinkStatusInput = {
  source: string;
  created_at: string;
  sent_at: string | null;
  sent_via: string;
  paid_at: string | null;
  deactivated_at: string | null;
};

/** One word for where a link stands. `unsent` is a Helm-minted link nobody
 *  texted or copied yet; concierge links are assumed delivered (the
 *  concierge texts them itself). */
export function paymentLinkStatus(row: PaymentLinkStatusInput, nowMs = Date.now()): PaymentLinkStatus {
  if (row.paid_at) return 'paid';
  if (row.deactivated_at) return 'cancelled';
  if (row.source === 'helm' && !row.sent_via) return 'unsent';
  const since = new Date(row.sent_at || row.created_at).getTime();
  const hours = (nowMs - since) / 3_600_000;
  return hours >= UNPAID_AFTER_HOURS ? 'overdue' : 'waiting';
}

/** "just now" / "3h ago" / "2d ago". */
export function ageLabel(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return '';
  const mins = Math.round((nowMs - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
