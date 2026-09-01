/**
 * Trailing-12-month cleaning-cost detail for the Forecast page.
 *
 * Cape Ann Elite (the portfolio's cleaning vendor) invoices via QuickBooks,
 * which emails each invoice from quickbooks@notification.intuit.com to the
 * Rising Tide inbox. This module pulls those invoice emails directly from
 * Gmail, parses property + amount + date out of each, and aggregates a
 * property x month grid plus per-property and portfolio totals.
 *
 * This is ADDITIVE reporting only — it never feeds the forecast model.
 *
 * Property attribution comes from `src/lib/invoice-property-match.ts`, shared
 * with /api/sync-invoices. It used to be a copy of that route's map, which
 * had gone stale by eight properties and matched FIRST-hit rather than
 * longest, so a sub-unit invoice could bill to its parent. The remaining
 * Gmail pieces (parseInvoiceRef, parseAmount, the OAuth token refresh) are
 * still local so this lib does not import from an API route.
 *
 * Everything is wrapped so it can never throw: missing Gmail credentials or
 * a failed request logs via console.error and returns an empty-but-shaped
 * result. The Forecast page Suspense-streams this so a slow pull never
 * blocks the rest of the page.
 */

import { unstable_cache } from 'next/cache';

import {
  loadInvoiceNeedles,
  parseInvoiceProperty,
  type InvoiceNeedles,
} from '@/lib/invoice-property-match';

// ---------------------------------------------------------------- Gmail env

const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || '';
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';

// --------------------------------------------------------- Invoice parsers
// Kept local on purpose so this lib does not import from an API route.
// Property attribution is the exception: it lives in a shared lib now.

/** Parse invoice number + date from subject: "Invoice 4.19.26CM318". */
function parseInvoiceRef(
  subject: string
): { invoice_no: string; invoice_date: string } | null {
  const match = subject.match(/Invoice\s+(\d{1,2})\.(\d{1,2})\.(\d{2})(CM\d+)/i);
  if (!match) return null;
  const month = match[1].padStart(2, '0');
  const day = match[2].padStart(2, '0');
  const year = `20${match[3]}`;
  return {
    invoice_no: `${match[1]}.${match[2]}.${match[3]}${match[4]}`,
    invoice_date: `${year}-${month}-${day}`,
  };
}

/** Parse amount from snippet: "Total $157.00". */
function parseAmount(snippet: string): number | null {
  const match = snippet.match(/Total\s+\$?([\d,]+\.?\d*)/);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ''));
}

// ------------------------------------------------------------------- Types

type ParsedInvoice = {
  invoice_no: string;
  invoice_date: string; // YYYY-MM-DD
  property_id: string | null;
  amount: number | null;
};

/** Slug used for invoices whose property could not be parsed. */
export const UNATTRIBUTED_KEY = 'Unattributed';

export type CleaningPropertyRow = {
  /** property_id slug, or UNATTRIBUTED_KEY for the catch-all bucket. */
  propertyId: string;
  /** YYYY-MM → dollars spent that month for this property. */
  byMonth: Record<string, number>;
  /** Sum across all months in range. */
  total: number;
};

export type CleaningCosts = {
  /** YYYY-MM list, oldest → newest, the trailing 12 months. */
  months: string[];
  /** One row per property that had at least one invoice, + Unattributed. */
  properties: CleaningPropertyRow[];
  /** YYYY-MM → portfolio-wide dollars that month. */
  totalsByMonth: Record<string, number>;
  /** Sum across the whole range. */
  grandTotal: number;
  /** Count of invoices that parsed with an amount. */
  invoiceCount: number;
  /** True when Gmail was unavailable or returned nothing usable. */
  empty: boolean;
};

// ---------------------------------------------------------------- Gmail API

/** Refresh a short-lived Gmail access token from the stored refresh token. */
async function getAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to refresh Gmail token: ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

type GmailMessageRef = { id: string };

/**
 * Page through messages.list to collect every matching message ID. The
 * list endpoint returns only IDs + a nextPageToken, so the bodies are
 * fetched separately (and batched) afterwards.
 */
async function listAllMessageIds(accessToken: string): Promise<string[]> {
  // Explicit after: date (YYYY/MM/DD). `newer_than:13m` proved unreliable
  // through the API — it returned only a couple weeks of mail — so we
  // filter on an explicit date: the first of the month 13 months back,
  // matching how the sync-invoices route scopes its Gmail search.
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - 13, 1);
  const after = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, '0')}/01`;
  const query = `from:quickbooks@notification.intuit.com subject:"Cape Ann Elite" after:${after}`;
  const ids: string[] = [];
  let pageToken: string | undefined;

  // Hard page cap so a runaway token loop can't hang the request.
  for (let page = 0; page < 40; page++) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Gmail search failed: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      messages?: GmailMessageRef[];
      nextPageToken?: string;
    };
    for (const m of data.messages ?? []) ids.push(m.id);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return ids;
}

/** Fetch one message's Subject header + snippet, parsed into an invoice. */
async function fetchInvoice(
  accessToken: string,
  id: string,
  needles: InvoiceNeedles
): Promise<ParsedInvoice | null> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;

  const msg = (await res.json()) as {
    snippet?: string;
    payload?: { headers?: Array<{ name: string; value: string }> };
  };
  const subject =
    msg.payload?.headers?.find((h) => h.name === 'Subject')?.value || '';
  const snippet = msg.snippet || '';

  const ref = parseInvoiceRef(subject);
  if (!ref) return null;
  return {
    invoice_no: ref.invoice_no,
    invoice_date: ref.invoice_date,
    property_id: parseInvoiceProperty(snippet, needles),
    amount: parseAmount(snippet),
  };
}

/** Fetch message bodies in chunks of ~25 so ~400 resolve in seconds. */
async function fetchInvoicesBatched(
  accessToken: string,
  ids: string[],
  needles: InvoiceNeedles
): Promise<ParsedInvoice[]> {
  const CHUNK = 25;
  const out: ParsedInvoice[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const settled = await Promise.all(
      chunk.map((id) => fetchInvoice(accessToken, id, needles))
    );
    for (const inv of settled) {
      if (inv) out.push(inv);
    }
  }
  return out;
}

// --------------------------------------------------------------- Aggregate

/** Empty-but-shaped result with the correct trailing-12-month columns. */
function emptyResult(): CleaningCosts {
  return {
    months: trailing12Months(),
    properties: [],
    totalsByMonth: {},
    grandTotal: 0,
    invoiceCount: 0,
    empty: true,
  };
}

/**
 * The 12 trailing months (most recent COMPLETE month last). The current,
 * in-progress month is excluded so the rightmost column is always a full
 * month of invoices.
 */
function trailing12Months(): string[] {
  const now = new Date();
  // Anchor on the first of last month → 12 columns ending last month.
  const anchor = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  }
  return months;
}

/** Roll a flat invoice list into the property x month grid + totals. */
function aggregate(invoices: ParsedInvoice[]): CleaningCosts {
  const months = trailing12Months();
  const inRange = new Set(months);

  const rowByProp = new Map<string, CleaningPropertyRow>();
  const totalsByMonth: Record<string, number> = {};
  let grandTotal = 0;
  let invoiceCount = 0;

  for (const inv of invoices) {
    if (!inv.amount || inv.amount <= 0) continue;
    const ym = inv.invoice_date.slice(0, 7);
    if (!inRange.has(ym)) continue;

    const key = inv.property_id ?? UNATTRIBUTED_KEY;
    let row = rowByProp.get(key);
    if (!row) {
      row = { propertyId: key, byMonth: {}, total: 0 };
      rowByProp.set(key, row);
    }
    row.byMonth[ym] = (row.byMonth[ym] ?? 0) + inv.amount;
    row.total += inv.amount;
    totalsByMonth[ym] = (totalsByMonth[ym] ?? 0) + inv.amount;
    grandTotal += inv.amount;
    invoiceCount++;
  }

  // Sort: attributed properties by total desc, Unattributed always last.
  const properties = [...rowByProp.values()].sort((a, b) => {
    if (a.propertyId === UNATTRIBUTED_KEY) return 1;
    if (b.propertyId === UNATTRIBUTED_KEY) return -1;
    return b.total - a.total;
  });

  return {
    months,
    properties,
    totalsByMonth,
    grandTotal,
    invoiceCount,
    empty: properties.length === 0,
  };
}

// ------------------------------------------------------------------ Public

/**
 * Uncached Gmail pull. Returns an empty-but-shaped result on any failure —
 * never throws.
 */
async function pullCleaningCosts(
  needles: InvoiceNeedles
): Promise<CleaningCosts> {
  if (!GMAIL_REFRESH_TOKEN || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    console.error(
      '[forecast-cleaning] Gmail credentials not configured — returning empty result.'
    );
    return emptyResult();
  }
  try {
    const accessToken = await getAccessToken();
    const ids = await listAllMessageIds(accessToken);
    if (ids.length === 0) return aggregate([]);
    const invoices = await fetchInvoicesBatched(accessToken, ids, needles);
    return aggregate(invoices);
  } catch (err) {
    console.error('[forecast-cleaning] Gmail pull failed:', err);
    return emptyResult();
  }
}

/**
 * The Gmail pull, cached for 6 hours so the section isn't re-pulled on every
 * render. The forecast page is force-dynamic, but unstable_cache still
 * applies per-key with its own TTL.
 *
 * The needle map is an ARGUMENT rather than a read inside the cached body,
 * for two reasons: the cached body stays pure Gmail I/O, and unstable_cache
 * folds arguments into the key, so editing a property's invoice_match
 * re-pulls instead of serving a stale attribution for up to six hours.
 * loadInvoiceNeedles returns a key-sorted map so that key is byte-stable.
 */
const pullCleaningCostsCached = unstable_cache(
  pullCleaningCosts,
  ['forecast-cleaning-costs-v3'],
  { revalidate: 60 * 60 * 6 } // 6 hours
);

/** Cached entry point for the Forecast page. */
export async function getCleaningCosts(): Promise<CleaningCosts> {
  return pullCleaningCostsCached(await loadInvoiceNeedles());
}
