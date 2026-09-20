/**
 * Pure core of the payments lookup: shapes, window maths, charge
 * normalization and filtering. No imports, no I/O, no secrets, so the test
 * runner can load it directly (Node strips the types but does not resolve
 * the `@/` alias, which is why every tested lib here is import-free).
 *
 * The I/O layer lives in stripe-payments-lookup.ts. Keep this file pure.
 */

/** Stripe's hard page size for a list call. */
export const PAGE_SIZE = 100;
/** Pages per property per lookup. 10 x 100 = 1,000 charges, then we stop and
 *  SAY we stopped rather than quietly returning a partial answer. */
export const MAX_PAGES = 10;
/** Default lookback when the caller names no window. */
export const DEFAULT_WINDOW_DAYS = 400;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type PaymentRow = {
  property_id: string;
  /** Stripe charge id. */
  id: string;
  payment_intent: string | null;
  /** Dollars, as Stripe reports them (amount / 100). */
  amount: number;
  /** Dollars actually refunded, 0 when none. */
  refunded: number;
  currency: string;
  status: string;
  /** True only when the money actually settled AND we still hold it: captured,
   *  not disputed, not refunded in full. An authorization hold and a
   *  charged-back payment both look "succeeded" in Stripe and are neither. */
  paid: boolean;
  /** False for an authorization that was never captured: no money moved. */
  captured: boolean;
  /** True when the cardholder has charged this back. */
  disputed: boolean;
  /** Plain-English reason a settled-looking charge is not money in hand. */
  not_paid_reason: string;
  created: string;
  description: string;
  email: string;
  name: string;
  last4: string;
  receipt_url: string | null;
};

export type PropertyLookup = {
  property_id: string;
  rows: PaymentRow[];
  /** Charges scanned before filtering, so a thin result is explicable. */
  scanned: number;
  /** True when MAX_PAGES was hit: there may be older charges we did not read. */
  truncated: boolean;
  /** Stripe's own message when this account could not be read. Never a key. */
  error: string | null;
};

export type LookupResult = {
  properties: PropertyLookup[];
  /** Roster properties with no configured Stripe key. These were NEVER
   *  searched, so an empty result for them means "we did not look", not
   *  "nothing was paid". Measured against the caller's roster, because
   *  deriving it from the key map can only ever return nothing. */
  unconfigured: string[];
  /** Every property id actually queried, so a result can state its own scope. */
  searched: string[];
  /** True when at least one account could not be read. The answer is partial. */
  degraded: boolean;
  window: { from: string; to: string };
  matched: number;
};

export type LookupInput = {
  /** Restrict to these property ids. Empty/omitted means every configured key. */
  propertyIds?: string[];
  /** The fleet the caller believes it is searching. Any roster id without a
   *  Stripe key is reported in `unconfigured` rather than silently skipped.
   *  Omit only when the caller genuinely has no roster. */
  rosterIds?: string[];
  /** Case-insensitive exact match on the payer's email. */
  email?: string;
  /** Case-insensitive substring across description, payer name and email. */
  text?: string;
  /** ISO day, inclusive. Defaults to DEFAULT_WINDOW_DAYS before `to`. */
  from?: string;
  /** ISO day, inclusive. Defaults to today. */
  to?: string;
  /** Include charges that failed or were fully refunded. Default false. */
  includeUnsuccessful?: boolean;
};


/** The business, its guests and its calendar all run on Cape Ann time.
 *  Bounding a day in UTC silently dropped every payment made after 8pm
 *  Eastern on the last day of a range and printed evening payments under
 *  tomorrow's date. */
export const BUSINESS_TZ = 'America/New_York';

/** Seconds a zone is ahead of UTC at a given instant. */
function zoneOffsetSeconds(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(new Date(utcMs))
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return (asIfUtc - utcMs) / 1000;
}

/** Epoch seconds for a wall-clock time on an ISO day in `timeZone`. Two
 *  passes so a DST boundary inside the day resolves correctly. */
function zonedEpoch(iso: string, clock: string, timeZone: string): number {
  const naive = Date.parse(`${iso}T${clock}Z`);
  if (Number.isNaN(naive)) return NaN;
  let guess = naive - zoneOffsetSeconds(naive, timeZone) * 1000;
  guess = naive - zoneOffsetSeconds(guess, timeZone) * 1000;
  return Math.floor(guess / 1000);
}

/** Seconds since epoch for the START of an ISO day, Cape Ann time. */
export function dayStartEpoch(iso: string, timeZone: string = BUSINESS_TZ): number {
  return zonedEpoch(iso, '00:00:00', timeZone);
}

/** Seconds since epoch for the END of an ISO day, Cape Ann time (inclusive). */
export function dayEndEpoch(iso: string, timeZone: string = BUSINESS_TZ): number {
  return zonedEpoch(iso, '23:59:59', timeZone);
}

/** Resolve the window, defaulting `to` to today and `from` to
 *  DEFAULT_WINDOW_DAYS earlier. Invalid input falls back to the default
 *  rather than throwing, so a typo narrows nothing silently. */
export function resolveWindow(
  from: string | undefined,
  to: string | undefined,
  today: string,
): { from: string; to: string } {
  const end = to && ISO_DAY.test(to) ? to : today;
  if (from && ISO_DAY.test(from) && from <= end) return { from, to: end };
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return { from: start.toISOString().slice(0, 10), to: end };
}

/** Normalize one raw Stripe charge. Pure. */
export function normalizeCharge(propertyId: string, c: Record<string, any>): PaymentRow {
  const billing = (c.billing_details || {}) as Record<string, any>;
  const card = ((c.payment_method_details || {}).card || {}) as Record<string, any>;
  const amount = Number(c.amount || 0) / 100;
  const refunded = Number(c.amount_refunded || 0) / 100;
  // `captured` is absent on older charge shapes; only an explicit false means
  // an uncaptured authorization.
  const captured = c.captured !== false;
  const disputed = c.disputed === true;
  const settled = c.status === 'succeeded' && c.paid === true;
  const paid = settled && captured && !disputed && refunded < amount;
  let reason = '';
  if (!paid) {
    if (!settled) reason = String(c.status || 'not settled');
    else if (!captured) reason = 'authorization only, never captured';
    else if (disputed) reason = 'charged back';
    else reason = 'refunded in full';
  }
  return {
    property_id: propertyId,
    id: String(c.id || ''),
    payment_intent: c.payment_intent ? String(c.payment_intent) : null,
    amount,
    refunded,
    currency: String(c.currency || 'usd').toUpperCase(),
    status: String(c.status || ''),
    paid,
    captured,
    disputed,
    not_paid_reason: reason,
    created: c.created ? new Date(Number(c.created) * 1000).toISOString() : '',
    description: String(c.description || ''),
    email: String(billing.email || c.receipt_email || '').trim(),
    name: String(billing.name || '').trim(),
    last4: String(card.last4 || ''),
    receipt_url: c.receipt_url ? String(c.receipt_url) : null,
  };
}

/** Does this row satisfy the caller's filters? Pure. */
export function matchesFilters(
  row: PaymentRow,
  filters: { email?: string; text?: string; includeUnsuccessful?: boolean },
): boolean {
  if (!filters.includeUnsuccessful && !row.paid) return false;
  const email = (filters.email || '').trim().toLowerCase();
  if (email && row.email.toLowerCase() !== email) return false;
  const text = (filters.text || '').trim().toLowerCase();
  if (text) {
    const hay = `${row.description} ${row.name} ${row.email}`.toLowerCase();
    if (!hay.includes(text)) return false;
  }
  return true;
}
