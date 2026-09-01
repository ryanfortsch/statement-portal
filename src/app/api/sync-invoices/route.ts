import { NextRequest, NextResponse } from 'next/server';
import { recordSyncSuccess, recordSyncFailure } from '@/lib/sync-status';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  loadInvoiceNeedles,
  parseInvoiceProperty,
  type InvoiceNeedles,
} from '@/lib/invoice-property-match';

// Service role: this route UPDATEs cleaning_events when an invoice matches
// an existing bank-sourced row. The anon key's RLS silently no-ops UPDATE
// (returns 200 with 0 rows changed), so before this fix the invoice-to-bank
// corroboration path was quietly doing nothing while the no-match path
// (insert as orphan) worked. Service role bypasses RLS.

// Gmail API config (optional -- if not set, route accepts pre-parsed invoices)
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || '';
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';

// Parse invoice number from subject: "Invoice 4.19.26CM318"
function parseInvoiceRef(subject: string): { invoice_no: string; invoice_date: string } | null {
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

// Parse amount from snippet: "Total $157.00"
function parseAmount(snippet: string): number | null {
  const match = snippet.match(/Total\s+\$?([\d,]+\.?\d*)/);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ''));
}

type ParsedInvoice = {
  invoice_no: string;
  invoice_date: string;
  property_id: string | null;
  amount: number | null;
};

async function getAccessToken(): Promise<string> {
  if (!GMAIL_REFRESH_TOKEN || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    throw new Error('Gmail API credentials not configured');
  }

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
    const err = await res.text();
    throw new Error(`Failed to refresh Gmail token: ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function fetchInvoicesFromGmail(
  month: string,
  needles: InvoiceNeedles
): Promise<ParsedInvoice[]> {
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr);
  const mo = parseInt(monthStr);
  const startDate = `${year}/${monthStr}/01`;
  const nextMo = mo === 12 ? 1 : mo + 1;
  const nextYear = mo === 12 ? year + 1 : year;
  const endDate = `${nextYear}/${String(nextMo).padStart(2, '0')}/01`;

  const accessToken = await getAccessToken();

  const baseSearchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
    `from:quickbooks@notification.intuit.com subject:"Cape Ann Elite" after:${startDate} before:${endDate}`
  )}&maxResults=100`;

  // Follow nextPageToken until the month is exhausted. A busy month runs
  // well past one page (July 2026 hit exactly 50 under the old single-page
  // fetch, silently dropping the rest). Hard cap as a runaway guard.
  const MAX_MESSAGES = 500;
  const messages: { id: string }[] = [];
  let pageToken: string | undefined;
  do {
    const searchUrl = pageToken ? `${baseSearchUrl}&pageToken=${encodeURIComponent(pageToken)}` : baseSearchUrl;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!searchRes.ok) throw new Error(`Gmail search failed: ${await searchRes.text()}`);
    const searchData = await searchRes.json();
    messages.push(...(searchData.messages ?? []));
    pageToken = searchData.nextPageToken;
  } while (pageToken && messages.length < MAX_MESSAGES);

  if (messages.length === 0) return [];

  const invoices: ParsedInvoice[] = [];

  for (const msg of messages) {
    const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject`;
    const msgRes = await fetch(msgUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!msgRes.ok) continue;

    const msgData = await msgRes.json();
    const subject = msgData.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || '';
    const snippet = msgData.snippet || '';

    const invoiceRef = parseInvoiceRef(subject);
    if (invoiceRef) {
      invoices.push({
        invoice_no: invoiceRef.invoice_no,
        invoice_date: invoiceRef.invoice_date,
        property_id: parseInvoiceProperty(snippet, needles),
        amount: parseAmount(snippet),
      });
    }
  }

  return invoices;
}

// Core logic: match invoices to cleaning_events in Supabase
async function processInvoices(month: string, invoices: ParsedInvoice[]) {
  let matched = 0;
  let inserted = 0;
  let skipped = 0;
  const results: { invoice_no: string; property_id: string | null; amount: number | null; action: string }[] = [];

  // Get or verify period exists
  const { data: period } = await supabase
    .from('statement_periods')
    .select('id')
    .eq('month', month)
    .single();

  if (!period) {
    return { matched: 0, inserted: 0, skipped: invoices.length, results: invoices.map(i => ({ ...i, action: 'skipped_no_period' })) };
  }

  for (const inv of invoices) {
    if (!inv.property_id || !inv.amount) {
      skipped++;
      results.push({ invoice_no: inv.invoice_no, property_id: inv.property_id, amount: inv.amount, action: 'skipped_no_property_or_amount' });
      continue;
    }

    const { data: stmt } = await supabase
      .from('property_statements')
      .select('id')
      .eq('period_id', period.id)
      .eq('property_id', inv.property_id)
      .single();

    if (!stmt) {
      skipped++;
      results.push({ invoice_no: inv.invoice_no, property_id: inv.property_id, amount: inv.amount, action: 'skipped_no_statement' });
      continue;
    }

    // Check for existing invoice
    const { data: existing } = await supabase
      .from('cleaning_events')
      .select('id')
      .eq('property_statement_id', stmt.id)
      .eq('invoice_no', inv.invoice_no)
      .single();

    if (existing) {
      skipped++;
      results.push({ invoice_no: inv.invoice_no, property_id: inv.property_id, amount: inv.amount, action: 'already_exists' });
      continue;
    }

    // Try to match to an existing Cape Ann Elite bank cleaning_event by
    // amount (within $2). CRITICAL: restrict the candidate pool to
    // cleaning-source rows only. If we didn't, a Cape Ann Elite invoice
    // could false-match to a Laundry Plus row (or Nor'East linen row) that
    // happens to have a similar amount -- overwriting its source and
    // stamping the wrong invoice number onto laundry/linen accounting.
    const { data: unmatchedEvents } = await supabase
      .from('cleaning_events')
      .select('id, bank_charge_amount, bank_charge_date, source')
      .eq('property_statement_id', stmt.id)
      .is('invoice_no', null)
      .in('source', ['matched', 'bank']);

    let matchedEvent = null;
    if (unmatchedEvents && unmatchedEvents.length > 0) {
      matchedEvent = unmatchedEvents.find(e =>
        e.bank_charge_amount && Math.abs(e.bank_charge_amount - inv.amount!) < 2
      );
    }

    if (matchedEvent) {
      await supabase
        .from('cleaning_events')
        .update({
          invoice_no: inv.invoice_no,
          invoice_amount: inv.amount,
          source: 'corroborated',
        })
        .eq('id', matchedEvent.id);
      matched++;
      results.push({ invoice_no: inv.invoice_no, property_id: inv.property_id, amount: inv.amount, action: 'matched_to_bank' });
    } else {
      await supabase
        .from('cleaning_events')
        .insert({
          property_statement_id: stmt.id,
          invoice_no: inv.invoice_no,
          invoice_amount: inv.amount,
          amount: inv.amount,
          source: 'invoice',
          checkout_date: inv.invoice_date,
        });
      inserted++;
      results.push({ invoice_no: inv.invoice_no, property_id: inv.property_id, amount: inv.amount, action: 'inserted_new' });
    }
  }

  return { matched, inserted, skipped, results };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { month, invoices: providedInvoices } = body;

    if (!month) {
      return NextResponse.json({ error: 'month is required (YYYY-MM)' }, { status: 400 });
    }

    let invoices: ParsedInvoice[];

    if (providedInvoices && Array.isArray(providedInvoices) && providedInvoices.length > 0) {
      // Mode 1: Pre-parsed invoices provided directly
      invoices = providedInvoices;
    } else if (GMAIL_REFRESH_TOKEN && GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET) {
      // Mode 2: Fetch from Gmail API
      invoices = await fetchInvoicesFromGmail(month, await loadInvoiceNeedles());
    } else {
      return NextResponse.json({
        error: 'No invoices provided and Gmail API not configured. Either pass invoices array in body or set GMAIL_REFRESH_TOKEN, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET env vars.',
      }, { status: 400 });
    }

    const { matched, inserted, skipped, results } = await processInvoices(month, invoices);

    // Stamp sync_status so the dashboard's "last synced" indicator updates.
    // Empty Gmail for the month counts as success (it's a valid outcome,
    // not a failure).
    await recordSyncSuccess('gmail-invoices', {
      month,
      total_invoices_found: invoices.length,
      matched,
      inserted,
      skipped,
    });

    return NextResponse.json({
      success: true,
      month,
      total_invoices_found: invoices.length,
      matched,
      inserted,
      skipped,
      results,
    });
  } catch (err) {
    console.error('Sync invoices error:', err);
    await recordSyncFailure('gmail-invoices', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : JSON.stringify(err) },
      { status: 500 }
    );
  }
}
