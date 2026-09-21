import {
  deriveQuoteStatus,
  legDue,
  type ScaQuoteLeg,
  type ScaQuoteStatus,
} from './sca-quotes-types.ts';

/**
 * Pure half of the messaging-card quote lookup: the filter it sends and the
 * matching it does with what comes back. No I/O and no secrets, so
 * `node --test` can load it (the runner cannot resolve the `@/` alias, which
 * is why every tested lib here keeps its imports relative and shallow).
 *
 * The join is the guest's EMAIL first, not the quote's `source_ref`. A ref
 * only matches the single card that spawned the quote; the guest writes again
 * next week, gets a new card under a new message id, and the ref is useless
 * exactly when the context is wanted. The ref stays as a second key so a
 * quote still binds to its origin card when one side has no address, but a
 * ref can never overrule a DISAGREEING address: see attachesTo below.
 */

/** One quote as a card shows it. Deliberately small: enough to decide whether
 *  to open it, never enough to re-do the composer's job inline. */
export type CardQuote = {
  id: string;
  status: ScaQuoteStatus;
  /** The quote's OWN address, which is not always the card's. A quote made
   *  from this card and then re-addressed in the composer keeps its
   *  source_ref, so the card must label the row rather than assume. */
  guest_email: string;
  property_internal_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  total_cents: number;
  payment_plan: string;
  /** What the guest owes RIGHT NOW, and how much. 'accepted' on a split plan
   *  means the deposit landed, not that the stay is paid for, so a card that
   *  showed only the total read as settled when a balance was outstanding. */
  leg_due: ScaQuoteLeg | null;
  amount_due_cents: number;
  deposit_cents: number | null;
  balance_cents: number | null;
  balance_due_on: string;
  /** '' when never sent. A draft is the operator's to finish, a sent quote is
   *  the guest's to answer. */
  sent_at: string;
  expires_at: string;
};

/** A card's quotes plus how many exist, so a truncated block can say so. */
export type CardQuoteBlock = {
  quotes: CardQuote[];
  /** Every quote matched for this guest, including any beyond PER_CARD_LIMIT. */
  total: number;
};

/** approval id -> that guest's quotes. Cards with none are absent rather than
 *  empty, so the client can test presence directly. */
export type GuestQuoteContext = Record<string, CardQuoteBlock>;

/** What a card has to carry for its quotes to be findable. */
export type QuoteKeyed = {
  id: string;
  guest_email?: string;
  guesty_message_id?: string;
};

/** The columns the card needs, as they come off the table. */
export type QuoteRow = {
  id: string;
  status: string;
  property_internal_name: string | null;
  check_in: string;
  check_out: string;
  nights: number | null;
  total_cents: number | null;
  payment_plan: string | null;
  deposit_cents: number | null;
  balance_cents: number | null;
  balance_due_on: string | null;
  deposit_paid_at: string | null;
  balance_paid_at: string | null;
  sent_at: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  voided_at: string | null;
  guest_email: string | null;
  source_ref: string | null;
};

/** Hard ceiling on one lookup. A guest with more quotes than this has a bigger
 *  problem than a truncated card. */
export const MAX_QUOTES = 200;

/** Never more than this per card: the block is a pointer to the Quotes
 *  module, not a replacement for it. The block prints the true count beside
 *  it, so a cap is never mistaken for a complete history. */
export const PER_CARD_LIMIT = 4;

export const QUOTE_COLUMNS =
  'id, status, property_internal_name, check_in, check_out, nights, total_cents, ' +
  'payment_plan, deposit_cents, balance_cents, balance_due_on, deposit_paid_at, ' +
  'balance_paid_at, sent_at, expires_at, accepted_at, declined_at, voided_at, ' +
  'guest_email, source_ref';

export function toCardQuote(row: QuoteRow, now: Date = new Date()): CardQuote {
  // The stored column lags: a draft whose expiry has passed still reads
  // 'draft' until the cron or the bridge stamps it. deriveQuoteStatus and
  // legDue are what every other quote surface trusts, so the card agrees with
  // the detail page it links to.
  const judged = {
    status: row.status as ScaQuoteStatus,
    accepted_at: row.accepted_at,
    declined_at: row.declined_at,
    voided_at: row.voided_at,
    expires_at: row.expires_at,
    payment_plan: row.payment_plan as 'full' | 'split',
    deposit_paid_at: row.deposit_paid_at,
    balance_paid_at: row.balance_paid_at,
    balance_cents: row.balance_cents,
  };
  const leg = legDue(judged, now);
  const total = row.total_cents ?? 0;
  const amountDue =
    leg === 'full' ? total : leg === 'deposit' ? (row.deposit_cents ?? 0) : leg === 'balance' ? (row.balance_cents ?? 0) : 0;
  return {
    id: row.id,
    status: deriveQuoteStatus(judged, now),
    guest_email: normalizeEmail(row.guest_email),
    property_internal_name: row.property_internal_name || '',
    check_in: row.check_in,
    check_out: row.check_out,
    nights: row.nights ?? 0,
    total_cents: total,
    payment_plan: row.payment_plan || 'full',
    leg_due: leg,
    amount_due_cents: amountDue,
    deposit_cents: row.deposit_cents,
    balance_cents: row.balance_cents,
    balance_due_on: row.balance_due_on || '',
    sent_at: row.sent_at || '',
    expires_at: row.expires_at || '',
  };
}

/** The keys a queue can join on, deduped and normalized the same way both
 *  sides of the match normalize them. */
export function collectQuoteKeys(approvals: QuoteKeyed[]): { emails: string[]; refs: string[] } {
  const emails = new Set<string>();
  const refs = new Set<string>();
  for (const a of approvals ?? []) {
    const email = normalizeEmail(a?.guest_email);
    if (email) emails.add(email);
    const ref = (a?.guesty_message_id || '').trim();
    if (ref) refs.add(ref);
  }
  return { emails: [...emails], refs: [...refs] };
}

/**
 * The PostgREST `or=` expression, or '' when there is nothing to ask for.
 *
 * `in.(...)` is comma-delimited, so a value carrying a comma, a double quote
 * or a paren would split the list and silently WIDEN the filter into rows
 * belonging to someone else. Double quoting with backslash escapes is what
 * the wire format expects, and an address is attacker-shaped input: it is
 * whatever the guest typed in their From header.
 */
export function buildQuoteFilter(emails: string[], refs: string[]): string {
  const parts: string[] = [];
  if (emails.length > 0) parts.push(`guest_email.in.(${emails.map(quoteForFilter).join(',')})`);
  if (refs.length > 0) parts.push(`source_ref.in.(${refs.map(quoteForFilter).join(',')})`);
  return parts.join(',');
}

export function quoteForFilter(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Does this quote belong on this card?
 *
 * The address wins whenever both sides have one. A quote made FROM a card
 * keeps that card's `source_ref` forever, and the composer lets the operator
 * change the address afterwards (and `duplicateQuote` copies the ref onto the
 * new row), so a stale ref can point a stranger's quote at this thread. The
 * ref is a fallback for the case it was meant for, one side having no address
 * at all, and never a way to overrule a disagreeing one.
 */
export function attachesTo(row: QuoteRow, cardEmail: string, cardRef: string): boolean {
  const rowEmail = normalizeEmail(row.guest_email);
  if (cardEmail && rowEmail) return rowEmail === cardEmail;
  const rowRef = (row.source_ref || '').trim();
  return !!cardRef && !!rowRef && rowRef === cardRef;
}

/** Live work outranks settled history. A card shows at most four rows, and the
 *  one the thread is about is the one still needing something. */
function isLive(q: CardQuote): boolean {
  if (q.status === 'draft' || q.status === 'sent') return true;
  return q.status === 'accepted' && q.leg_due !== null;
}

/**
 * Hand each card the quotes that belong to its guest.
 *
 * Matching is done here rather than in the query because one round trip has
 * to serve a whole queue: a per-card query would be a dozen round trips on
 * every 15-second poll.
 */
export function groupQuotesByApproval(
  rows: QuoteRow[],
  approvals: QuoteKeyed[],
  now: Date = new Date(),
): GuestQuoteContext {
  const byEmail = new Map<string, QuoteRow[]>();
  const byRef = new Map<string, QuoteRow[]>();
  for (const row of rows ?? []) {
    if (!row?.id) continue;
    // A voided quote is gone. The column and the timestamp can disagree while
    // a write is in flight, so neither alone is trusted.
    if (row.voided_at || row.status === 'voided') continue;
    const email = normalizeEmail(row.guest_email);
    if (email) push(byEmail, email, row);
    const ref = (row.source_ref || '').trim();
    if (ref) push(byRef, ref, row);
  }

  const out: GuestQuoteContext = {};
  for (const a of approvals ?? []) {
    if (!a?.id) continue;
    const email = normalizeEmail(a.guest_email);
    const ref = (a.guesty_message_id || '').trim();
    const seen = new Set<string>();
    const mine: CardQuote[] = [];
    const candidates = [
      ...(email ? (byEmail.get(email) ?? []) : []),
      ...(ref ? (byRef.get(ref) ?? []) : []),
    ];
    for (const row of candidates) {
      // The two keys overlap whenever a quote was made from this very card.
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if (!attachesTo(row, email, ref)) continue;
      mine.push(toCardQuote(row, now));
    }
    if (mine.length === 0) continue;
    // Live first, then soonest stay. The query orders too, but a card must not
    // depend on that: the two key maps interleave, and a repeat guest's
    // settled 2026 rows would otherwise fill all four slots and push the live
    // 2027 quote off the card entirely.
    mine.sort((x, y) => {
      const live = Number(isLive(y)) - Number(isLive(x));
      if (live !== 0) return live;
      return (x.check_in || '').localeCompare(y.check_in || '');
    });
    out[a.id] = { quotes: mine.slice(0, PER_CARD_LIMIT), total: mine.length };
  }
  return out;
}

function push(map: Map<string, QuoteRow[]>, key: string, row: QuoteRow): void {
  const existing = map.get(key);
  if (existing) existing.push(row);
  else map.set(key, [row]);
}

/** Addresses are compared case-insensitively: Helm lowercases on save, the
 *  concierge hands back whatever the From header said. */
function normalizeEmail(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}
