import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import {
  parseChaseBankCsv,
  parseChaseCreditCardCsv,
  computeDedupeHash,
  type ParsedTransaction,
} from '@/lib/chase-csv';

/**
 * Books ingestion endpoint. Accepts one Chase CSV at a time, scoped to a
 * specific `llc_accounts` row (the operator picks the account from a
 * dropdown on the per-entity page). Parses based on the account kind
 * ('bank' vs 'credit_card'), dedupes via a stable hash, and inserts new
 * transactions into ledger_transactions.
 *
 * Why per-account and not per-entity: a single entity (especially Rising
 * Tide STR LLC with 13 banks) has many accounts and the operator will
 * download account-by-account from Chase. Tying each upload to one
 * account keeps the source-of-truth bank/card linkage clean and lets the
 * Phase 1b-ii categorizer use the bank context as a strong prior (e.g.
 * Amazon on Rising Tide Main = company supplies; on KITTREDGE 1323 =
 * property repair).
 *
 * Dedupe: hash over (entity_id, account_id, txn_date, amount, normalized
 * description). Re-uploads + overlapping CSVs (month-by-month covering
 * the same quarter) collapse into the same hash and silently skip.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

type LlcAccountRow = {
  id: string;
  entity_id: string;
  kind: 'bank' | 'credit_card';
  institution: string | null;
  last4: string | null;
  label: string | null;
};

export type BooksIngestResponse =
  | {
      success: true;
      account: { id: string; entity_id: string; label: string | null; last4: string | null; kind: string };
      parsed: number;
      inserted: number;
      skipped: number;
      date_range: { min: string; max: string } | null;
    }
  | { error: string };

export async function POST(request: NextRequest): Promise<NextResponse<BooksIngestResponse>> {
  try {
    const formData = await request.formData();
    const accountId = ((formData.get('account_id') as string) || '').trim();
    const file = formData.get('file') as File | null;

    if (!accountId) {
      return NextResponse.json({ error: 'account_id is required' }, { status: 400 });
    }
    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    // Look up the account so we know which parser to use + which entity
    // to scope the dedupe hash to.
    const { data: acctRow, error: acctErr } = await supabase
      .from('llc_accounts')
      .select('id, entity_id, kind, institution, last4, label')
      .eq('id', accountId)
      .single();
    if (acctErr || !acctRow) {
      return NextResponse.json({ error: `Unknown account_id: ${accountId}` }, { status: 400 });
    }
    const acct = acctRow as LlcAccountRow;
    if (acct.kind !== 'bank' && acct.kind !== 'credit_card') {
      return NextResponse.json({ error: `Unsupported account kind: ${acct.kind}` }, { status: 400 });
    }

    const text = await file.text();
    let parsed: ParsedTransaction[];
    try {
      parsed = acct.kind === 'bank' ? parseChaseBankCsv(text) : parseChaseCreditCardCsv(text);
    } catch (parseErr) {
      return NextResponse.json({
        error: `Failed to parse CSV: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      }, { status: 400 });
    }

    if (parsed.length === 0) {
      return NextResponse.json({ error: 'No transactions found in CSV (header-only or unrecognized format?)' }, { status: 400 });
    }

    // Build rows + dedupe hashes.
    const rowsToInsert = parsed.map((p) => {
      const dedupe_hash = computeDedupeHash({
        entity_id: acct.entity_id,
        account_id: acct.id,
        txn_date: p.txn_date,
        amount: p.amount,
        description: p.description,
      });
      return {
        entity_id: acct.entity_id,
        account_id: acct.id,
        txn_date: p.txn_date,
        description: p.description,
        amount: p.amount,
        source: p.source,
        // Store the raw row + supplementary fields in `raw` so the review
        // UI can show the original CSV cell + Chase's pre-category and
        // type. JSONB column.
        raw: {
          posting_date: p.posting_date,
          raw_category: p.raw_category,
          raw_type: p.raw_type,
          row: p.raw_row,
        },
        dedupe_hash,
      };
    });

    // Chunked upsert; PG handles ~1k rows per insert comfortably, but
    // we'll be defensive at 500.
    let inserted = 0;
    const CHUNK = 500;
    for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
      const slice = rowsToInsert.slice(i, i + CHUNK);
      // ON CONFLICT (dedupe_hash) DO NOTHING -- the unique constraint
      // on dedupe_hash makes re-uploads idempotent.
      const { data, error } = await supabase
        .from('ledger_transactions')
        .upsert(slice, { onConflict: 'dedupe_hash', ignoreDuplicates: true })
        .select('id');
      if (error) {
        return NextResponse.json({ error: `Insert failed: ${error.message}` }, { status: 500 });
      }
      // `data` contains only rows actually inserted (when ignoreDuplicates).
      inserted += (data || []).length;
    }

    const dates = parsed.map((p) => p.txn_date).sort();
    const dateRange = dates.length > 0
      ? { min: dates[0], max: dates[dates.length - 1] }
      : null;

    return NextResponse.json({
      success: true,
      account: {
        id: acct.id,
        entity_id: acct.entity_id,
        label: acct.label,
        last4: acct.last4,
        kind: acct.kind,
      },
      parsed: parsed.length,
      inserted,
      skipped: parsed.length - inserted,
      date_range: dateRange,
    });
  } catch (err) {
    console.error('books/ingest error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
