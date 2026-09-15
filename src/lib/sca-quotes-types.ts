/**
 * Stay Cape Ann custom quotes: row type, pure money math, status derivation,
 * and the wire shape the hosted page on staycapeann.com reads.
 *
 * PURE MODULE. No server-only imports, no env access, no DB. Safe for the
 * composer (client), the operator pages (server), the bridge routes, and
 * the cron. staycapeann.com carries a byte-compatible copy of the wire
 * types in lib/helmQuotes.ts; change one, change both.
 *
 * Money is integer cents throughout. The formula (computeQuoteMoney) is the
 * ONE place the total is derived; the composer previews it, the server
 * action persists it, the bridge route re-derives it when serving the page,
 * and staycapeann.com re-checks that the stored total equals the derived
 * total before charging a card. A quote whose stored total disagrees with
 * its lines is refused at accept time, never silently charged.
 *
 * Tax: the OWED occupancy rate for the property on the compose date
 * (src/lib/occupancy-tax.ts owedOccupancyTaxRate, 11.7% base or 14.7% with
 * the Community Impact Fee). MA room occupancy excise applies to rent plus
 * mandatory fees, so the base is accommodation minus discount, plus
 * cleaning, plus every extra line flagged taxable. Stays of 32+ nights are
 * exempt (mirrors withAllInTotal on the SCA side, nights > 31 -> 0).
 */

export type ScaQuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'voided';
export type ScaQuotePaymentPlan = 'full' | 'split';
export type ScaQuoteLeg = 'full' | 'deposit' | 'balance';

export type ExtraLine = {
  label: string;
  /** Positive cents. */
  cents: number;
  taxable: boolean;
};

export type ScaQuoteRow = {
  id: string;
  token: string;
  status: ScaQuoteStatus;

  property_id: string | null;
  guesty_listing_id: string;
  property_title: string;
  property_internal_name: string | null;

  check_in: string;
  check_out: string;
  nights: number;
  guests: number;

  guest_first_name: string;
  guest_last_name: string;
  guest_email: string | null;
  guest_phone: string | null;

  currency: string;
  nightly_cents: number | null;
  accommodation_cents: number;
  cleaning_cents: number;
  extra_lines: ExtraLine[];
  discount_label: string | null;
  discount_cents: number;
  tax_exempt: boolean;
  tax_rate: number;
  tax_cents: number;
  total_cents: number;

  payment_plan: ScaQuotePaymentPlan;
  deposit_cents: number | null;
  balance_cents: number | null;
  balance_due_on: string | null;

  override_calendar: boolean;
  override_terms: boolean;

  message: string | null;
  cancellation_terms: string | null;
  terms_version: string | null;
  internal_notes: string | null;
  reference_quote: ReferenceQuote | null;
  expires_at: string | null;

  sent_at: string | null;
  last_sent_at: string | null;
  sent_via: string[];
  viewed_at: string | null;
  view_count: number;
  accepted_at: string | null;
  accept_ip: string | null;
  agreement_version: string | null;
  agreement_accepted_at: string | null;
  stripe_account_key: string | null;
  stripe_payment_intent_id: string | null;
  deposit_paid_at: string | null;
  balance_payment_intent_id: string | null;
  balance_paid_at: string | null;
  balance_reminder_sent_at: string | null;
  /** What the card was actually charged on the first leg (full or deposit), as staycapeann.com reported it. */
  amount_paid_cents: number | null;
  /** What the card was actually charged on the balance leg. */
  balance_paid_cents: number | null;
  guesty_reservation_id: string | null;
  guesty_confirmation_code: string | null;
  guesty_total_cents: number | null;
  accept_error: string | null;
  accept_error_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  voided_at: string | null;

  source_kind: string | null;
  source_ref: string | null;

  /**
   * Last composition save from the composer (price, dates, guest, copy).
   * Bridge events never move it, unlike updated_at, so "edited since the
   * last send" compares this to last_sent_at. Migration
   * 20260914120100_sca_quotes_edited_at.
   */
  edited_at: string | null;

  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Guesty's own answer at compose time, kept for the operator's reference
 * ("Guesty would have charged $X"). Never shown to the guest. Shape mirrors
 * staycapeann.com's QuoteResult in dollars, as returned by its public
 * GET /api/guesty/quote.
 */
export type ReferenceQuote = {
  fetched_at: string;
  estimated: boolean;
  nights: number;
  subtotal: number;
  cleaning_fee: number;
  extra_guest_fee: number;
  taxes: number;
  total: number;
  currency: string;
  /** Last year's achieved nightly for the same window, from the statements data, when it exists. */
  achieved_nightly: number | null;
  achieved_sample_nights: number | null;
};

export const SCA_QUOTE_STATUS_LABEL: Record<ScaQuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  voided: 'Voided',
};

export const SCA_QUOTE_TERMS_VERSION = '2026-09-14';

/** Days a quote stays open by default when the operator does not pick a date. */
export const DEFAULT_QUOTE_EXPIRY_DAYS = 7;

/** Occupancy tax exemption threshold: stays longer than this many nights owe none. */
export const TAX_EXEMPT_OVER_NIGHTS = 31;

/** Default split: half now, half 60 days before check-in (CONSENT-WORDING block A). */
export const SPLIT_DEPOSIT_PCT = 50;
export const SPLIT_BALANCE_LEAD_DAYS = 60;

// ─── Dates ──────────────────────────────────────────────────────────────────

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(s: unknown): s is string {
  return typeof s === 'string' && ISO_DAY_RE.test(s);
}

/** Nights between two YYYY-MM-DD dates; UTC math so DST never miscounts. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!isIsoDay(checkIn) || !isIsoDay(checkOut)) return 0;
  const [y1, m1, d1] = checkIn.split('-').map(Number);
  const [y2, m2, d2] = checkOut.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}

/** YYYY-MM-DD shifted by `days` (negative allowed), UTC math. */
export function shiftIsoDay(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Today in the listing's local time (every Stay Cape Ann home is US Eastern). */
export function todayInEastern(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// ─── Money ──────────────────────────────────────────────────────────────────

export type QuoteMoneyInput = {
  accommodation_cents: number;
  cleaning_cents: number;
  extra_lines: ExtraLine[];
  discount_cents: number;
  tax_rate: number;
  tax_exempt: boolean;
  payment_plan: ScaQuotePaymentPlan;
  /** Deposit share as a percentage (1..99) when payment_plan is 'split'. */
  deposit_pct?: number;
  /** Explicit deposit in cents; wins over deposit_pct when set. */
  deposit_cents?: number | null;
};

export type QuoteMoney = {
  extras_cents: number;
  taxable_base_cents: number;
  tax_cents: number;
  subtotal_cents: number; // everything before tax
  total_cents: number;
  deposit_cents: number | null;
  balance_cents: number | null;
};

const clampCents = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/**
 * The one formula. Deterministic integer arithmetic; the same inputs give
 * the same total on the composer, in Helm, and on staycapeann.com.
 */
export function computeQuoteMoney(input: QuoteMoneyInput): QuoteMoney {
  const accommodation = clampCents(input.accommodation_cents);
  const cleaning = clampCents(input.cleaning_cents);
  const discount = Math.min(clampCents(input.discount_cents), accommodation);
  const extras = (input.extra_lines ?? []).map((l) => ({ ...l, cents: clampCents(l.cents) }));
  const extrasCents = extras.reduce((sum, l) => sum + l.cents, 0);
  const taxableExtras = extras.filter((l) => l.taxable).reduce((sum, l) => sum + l.cents, 0);

  const taxableBase = Math.max(0, accommodation - discount) + cleaning + taxableExtras;
  const rate = input.tax_exempt ? 0 : Math.max(0, Number(input.tax_rate) || 0);
  const taxCents = Math.round(taxableBase * rate);

  const subtotal = Math.max(0, accommodation - discount) + cleaning + extrasCents;
  const total = subtotal + taxCents;

  let deposit: number | null = null;
  let balance: number | null = null;
  if (input.payment_plan === 'split' && total > 0) {
    const explicit = input.deposit_cents != null ? clampCents(input.deposit_cents) : 0;
    const pct = Math.min(99, Math.max(1, Math.round(Number(input.deposit_pct) || SPLIT_DEPOSIT_PCT)));
    deposit = explicit > 0 ? Math.min(explicit, total - 1) : Math.round((total * pct) / 100);
    if (deposit < 1) deposit = 1;
    balance = total - deposit;
  }

  return {
    extras_cents: extrasCents,
    taxable_base_cents: taxableBase,
    tax_cents: taxCents,
    subtotal_cents: subtotal,
    total_cents: total,
    deposit_cents: deposit,
    balance_cents: balance,
  };
}

/** Re-derive the money from a stored row and report whether it still adds up. */
export function quoteMoneyConsistent(row: Pick<
  ScaQuoteRow,
  | 'accommodation_cents'
  | 'cleaning_cents'
  | 'extra_lines'
  | 'discount_cents'
  | 'tax_rate'
  | 'tax_exempt'
  | 'payment_plan'
  | 'deposit_cents'
  | 'balance_cents'
  | 'tax_cents'
  | 'total_cents'
>): boolean {
  const m = computeQuoteMoney({
    accommodation_cents: row.accommodation_cents,
    cleaning_cents: row.cleaning_cents,
    extra_lines: row.extra_lines ?? [],
    discount_cents: row.discount_cents,
    tax_rate: Number(row.tax_rate),
    tax_exempt: row.tax_exempt,
    payment_plan: row.payment_plan,
    deposit_cents: row.deposit_cents,
  });
  if (m.total_cents !== row.total_cents || m.tax_cents !== row.tax_cents) return false;
  if (row.payment_plan === 'split') {
    if (row.deposit_cents == null || row.balance_cents == null) return false;
    if (row.deposit_cents + row.balance_cents !== row.total_cents) return false;
    if (row.deposit_cents < 1 || row.balance_cents < 1) return false;
  }
  return true;
}

export function fmtCents(cents: number, currency = 'USD'): string {
  const dollars = cents / 100;
  const hasCents = Math.round(cents) % 100 !== 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(dollars);
}

// ─── Status ─────────────────────────────────────────────────────────────────

/**
 * Effective status. The column carries the operator-side state; expiry is
 * derived at read time so a quote never has to wait for the cron to read
 * as expired.
 */
export function deriveQuoteStatus(
  row: Pick<ScaQuoteRow, 'status' | 'expires_at' | 'accepted_at' | 'voided_at' | 'declined_at'>,
  now: Date = new Date(),
): ScaQuoteStatus {
  if (row.voided_at || row.status === 'voided') return 'voided';
  if (row.accepted_at || row.status === 'accepted') return 'accepted';
  if (row.declined_at || row.status === 'declined') return 'declined';
  if (row.status === 'expired') return 'expired';
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return 'expired';
  return row.status === 'sent' ? 'sent' : 'draft';
}

/** Which payment leg the guest owes right now, if any. */
export function legDue(
  row: Pick<
    ScaQuoteRow,
    | 'status'
    | 'expires_at'
    | 'accepted_at'
    | 'voided_at'
    | 'declined_at'
    | 'payment_plan'
    | 'deposit_paid_at'
    | 'balance_paid_at'
    | 'balance_cents'
  >,
  now: Date = new Date(),
): ScaQuoteLeg | null {
  const status = deriveQuoteStatus(row, now);
  if (status === 'accepted') {
    if (row.payment_plan === 'split' && !row.balance_paid_at && (row.balance_cents ?? 0) > 0) return 'balance';
    return null;
  }
  if (status !== 'sent') return null;
  return row.payment_plan === 'split' ? 'deposit' : 'full';
}

export function amountDueCents(row: ScaQuoteRow, now: Date = new Date()): number {
  const leg = legDue(row, now);
  if (leg === 'full') return row.total_cents;
  if (leg === 'deposit') return row.deposit_cents ?? 0;
  if (leg === 'balance') return row.balance_cents ?? 0;
  return 0;
}

// ─── Wire shape (Helm -> staycapeann.com) ───────────────────────────────────

/**
 * What the hosted page reads through GET /api/sca-quotes/<token>. Nothing
 * internal rides on it: no internal name, no notes, no reference quote, no
 * Stripe ids. staycapeann.com re-derives the money from the lines before
 * charging (see quoteMoneyConsistent on both sides).
 */
export type PublicQuote = {
  id: string;
  token: string;
  status: ScaQuoteStatus;
  guesty_listing_id: string;
  property_title: string;
  property_id: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  guests: number;
  guest: { first_name: string; last_name: string; email: string; phone: string };
  currency: string;
  nightly_cents: number | null;
  accommodation_cents: number;
  cleaning_cents: number;
  extra_lines: ExtraLine[];
  discount_label: string | null;
  discount_cents: number;
  tax_rate: number;
  tax_exempt: boolean;
  tax_cents: number;
  total_cents: number;
  payment_plan: ScaQuotePaymentPlan;
  deposit_cents: number | null;
  balance_cents: number | null;
  balance_due_on: string | null;
  override_calendar: boolean;
  override_terms: boolean;
  message: string | null;
  cancellation_terms: string | null;
  terms_version: string | null;
  expires_at: string | null;
  /**
   * Last composer save. The hosted page echoes it back on accept so a quote
   * edited after the guest opened the page is refused, never charged at a
   * number the guest did not see.
   */
  edited_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  deposit_paid_at: string | null;
  balance_paid_at: string | null;
  guesty_reservation_id: string | null;
  guesty_confirmation_code: string | null;
  /** Computed by Helm at read time. */
  leg_due: ScaQuoteLeg | null;
  amount_due_cents: number;
};

export function toPublicQuote(row: ScaQuoteRow, now: Date = new Date()): PublicQuote {
  return {
    id: row.id,
    token: row.token,
    status: deriveQuoteStatus(row, now),
    guesty_listing_id: row.guesty_listing_id,
    property_title: row.property_title,
    property_id: row.property_id,
    check_in: row.check_in,
    check_out: row.check_out,
    nights: row.nights,
    guests: row.guests,
    guest: {
      first_name: row.guest_first_name ?? '',
      last_name: row.guest_last_name ?? '',
      email: row.guest_email ?? '',
      phone: row.guest_phone ?? '',
    },
    currency: row.currency || 'USD',
    nightly_cents: row.nightly_cents,
    accommodation_cents: row.accommodation_cents,
    cleaning_cents: row.cleaning_cents,
    extra_lines: Array.isArray(row.extra_lines) ? row.extra_lines : [],
    discount_label: row.discount_label,
    discount_cents: row.discount_cents,
    tax_rate: Number(row.tax_rate) || 0,
    tax_exempt: row.tax_exempt,
    tax_cents: row.tax_cents,
    total_cents: row.total_cents,
    payment_plan: row.payment_plan,
    deposit_cents: row.deposit_cents,
    balance_cents: row.balance_cents,
    balance_due_on: row.balance_due_on,
    override_calendar: row.override_calendar,
    override_terms: row.override_terms,
    message: row.message,
    cancellation_terms: row.cancellation_terms,
    terms_version: row.terms_version,
    expires_at: row.expires_at,
    edited_at: row.edited_at ?? null,
    sent_at: row.sent_at,
    accepted_at: row.accepted_at,
    deposit_paid_at: row.deposit_paid_at,
    balance_paid_at: row.balance_paid_at,
    guesty_reservation_id: row.guesty_reservation_id,
    guesty_confirmation_code: row.guesty_confirmation_code,
    leg_due: legDue(row, now),
    amount_due_cents: amountDueCents(row, now),
  };
}

// ─── Events (staycapeann.com -> Helm) ───────────────────────────────────────

export type QuoteGuest = { first_name: string; last_name: string; email: string; phone: string };

export type QuoteEvent =
  | { event: 'viewed' }
  | { event: 'declined'; reason?: string }
  | {
      event: 'accept_failed';
      leg: ScaQuoteLeg;
      stage: 'stripe' | 'guesty' | 'capture' | 'other';
      error: string;
    }
  | {
      event: 'accepted';
      leg: 'full' | 'deposit';
      stripe_payment_intent_id: string;
      stripe_account_key: string;
      amount_cents: number;
      guesty_reservation_id: string;
      guesty_confirmation_code: string;
      guesty_total_cents: number | null;
      guest: QuoteGuest;
      agreement_version: string;
      agreement_accepted_at: string | null;
      accept_ip: string;
    }
  | {
      event: 'balance_paid';
      stripe_payment_intent_id: string;
      amount_cents: number;
    };

// ─── Terms copy defaults ────────────────────────────────────────────────────

/**
 * Default cancellation wording by plan. 'full' mirrors the standard Stay
 * Cape Ann checkout (lib/cancellation.ts on the SCA side: 50% refund more
 * than 30 days before check-in, nothing after). 'split' mirrors the
 * Ryan-approved quoted-rail wording (stay-concierge CONSENT-WORDING.md,
 * block C): the first payment is non-refundable, and the balance is due
 * 60 days before check-in. Editable per quote before sending.
 */
export function defaultCancellationTerms(args: {
  payment_plan: ScaQuotePaymentPlan;
  check_in: string;
  balance_due_on?: string | null;
}): string {
  if (args.payment_plan === 'split') {
    const due = args.balance_due_on ? fmtLongDate(args.balance_due_on) : '60 days before check-in';
    return (
      `The first payment locks in your dates and is non-refundable. The balance is due by ${due}, ` +
      `and once it is paid the reservation is non-refundable in full. If the balance is not paid by ` +
      `that date we may release the dates and keep the first payment.`
    );
  }
  const cutoff = isIsoDay(args.check_in) ? shiftIsoDay(args.check_in, -30) : null;
  const closed = cutoff ? todayInEastern() >= cutoff : false;
  if (closed) {
    return (
      'This reservation is non-refundable from the moment you book. The 50% refund window for these ' +
      'dates has already closed. We recommend travel insurance.'
    );
  }
  return (
    `50% refund if you cancel before ${cutoff ? fmtLongDate(cutoff) : '30 days before check-in'}. ` +
    'After that, non-refundable. No-shows are not eligible for a refund.'
  );
}

/** "2026-06-22" -> "June 22, 2026" without timezone rollback. */
export function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** "2026-06-22" -> "Jun 22" */
export function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Strip the "Stay at" / "Stay in" prefix for on-page headings, matching the SCA site. */
export function displayTitle(title: string | null | undefined): string {
  if (!title) return '';
  const stripped = title.replace(/^Stay (?:at|in) /, '');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}
