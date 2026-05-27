import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { LLC_ENTITIES } from '@/lib/books';
import {
  categorizeTransactions,
  type CategorizableTransaction,
} from '@/lib/books-categorizer';

/**
 * Run the AI categorizer over uncategorized transactions for an entity.
 *
 * POST { entity_id, limit?, only_uncategorized? }
 *   - entity_id: required, one of LLC_ENTITIES
 *   - limit: max transactions to categorize this call (default 200, cap 500).
 *     Vercel function timeout is 300s; even with the parallel-batch path
 *     in books-categorizer.ts, going above ~500 in a single request risks
 *     a timeout. Multiple calls handle larger backlogs.
 *   - only_uncategorized: default true. When false, re-categorizes rows
 *     that already have ai_category_key but not category_key (useful for
 *     re-running after a chart-of-accounts edit).
 *
 * Writes the AI's proposal to ledger_transactions.ai_category_key /
 * ai_confidence. NEVER touches category_key (that's the operator's
 * confirmed value) or reviewed. The review endpoint handles confirmation.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

type LedgerRow = {
  id: string;
  txn_date: string;
  description: string;
  amount: number;
  account_id: string | null;
  raw: { raw_category?: string | null; raw_type?: string | null } | null;
};

type AccountRow = {
  id: string;
  kind: 'bank' | 'credit_card';
  label: string | null;
  last4: string | null;
  property_id: string | null;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const entityId: string = body.entity_id || '';
    const requestedLimit: number = typeof body.limit === 'number' ? body.limit : 200;
    const onlyUncategorized: boolean = body.only_uncategorized !== false;

    if (!entityId || !LLC_ENTITIES[entityId]) {
      return NextResponse.json({ error: `Unknown entity_id: ${entityId}` }, { status: 400 });
    }
    const limit = Math.max(1, Math.min(500, requestedLimit));

    // Pull the candidate transactions.
    let query = supabase
      .from('ledger_transactions')
      .select('id, txn_date, description, amount, account_id, raw')
      .eq('entity_id', entityId)
      .order('txn_date', { ascending: false })
      .limit(limit);
    if (onlyUncategorized) {
      query = query.is('ai_category_key', null).is('category_key', null);
    }
    const { data: txnsRaw, error: txnsErr } = await query;
    if (txnsErr) {
      return NextResponse.json({ error: `Failed to load transactions: ${txnsErr.message}` }, { status: 500 });
    }
    const txns = (txnsRaw || []) as LedgerRow[];
    if (txns.length === 0) {
      return NextResponse.json({
        success: true,
        entity_id: entityId,
        candidates: 0,
        categorized: 0,
        errors: [],
        message: 'No uncategorized transactions to categorize.',
      });
    }

    // Resolve account context for every distinct account_id.
    const acctIds = Array.from(new Set(txns.map((t) => t.account_id).filter((x): x is string => !!x)));
    const acctMap = new Map<string, AccountRow>();
    if (acctIds.length > 0) {
      const { data: accts } = await supabase
        .from('llc_accounts')
        .select('id, kind, label, last4, property_id')
        .in('id', acctIds);
      for (const a of (accts || []) as AccountRow[]) acctMap.set(a.id, a);
    }

    // Build the categorizable input.
    const candidates: CategorizableTransaction[] = txns.map((t) => {
      const acct = t.account_id ? acctMap.get(t.account_id) : null;
      const label = acct
        ? `${acct.label || acct.kind} ⋯${acct.last4 || '????'}`
        : '(unknown account)';
      return {
        id: t.id,
        txn_date: t.txn_date,
        description: t.description,
        amount: Number(t.amount),
        account_label: label,
        account_kind: acct?.kind || 'bank',
        property_id: acct?.property_id || null,
        raw_category: t.raw?.raw_category || null,
        raw_type: t.raw?.raw_type || null,
      };
    });

    // Run the categorizer.
    const { results, errors } = await categorizeTransactions(entityId, candidates);

    // Write the AI proposals back. One UPDATE per row (the column-by-row
    // shape doesn't lend itself to a bulk upsert; serial is fine at this
    // batch size). ai_reasoning is its own column so we never clobber
    // the JSONB raw (which carries posting_date, Chase's raw_category,
    // raw_type, and the original CSV row).
    let written = 0;
    for (const r of results) {
      const { error: updErr } = await supabase
        .from('ledger_transactions')
        .update({
          ai_category_key: r.category_key,
          ai_confidence: r.confidence,
          ai_reasoning: r.reasoning,
        })
        .eq('id', r.transaction_id);
      if (!updErr) written++;
    }

    return NextResponse.json({
      success: true,
      entity_id: entityId,
      candidates: candidates.length,
      categorized: written,
      batch_errors: errors,
      sample: results.slice(0, 5),
    });
  } catch (err) {
    console.error('books/categorize error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
