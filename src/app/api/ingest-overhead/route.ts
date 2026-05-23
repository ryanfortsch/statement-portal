import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { categorizeOverhead, type OverheadAccount, type OverheadCategory } from '@/lib/overhead-categories';

/**
 * Ingest Rising Tide overhead from a corporate-account CSV.
 *
 * Auto-detects the two formats by header:
 *   - Corporate card (*3878): Card, Transaction Date, Post Date,
 *     Description, Category, Type, Amount, Memo
 *   - Operating account (*5130): Details, Posting Date, Description,
 *     Amount, Type, Balance, Check or Slip #
 *
 * Each row is categorized (lib/overhead-categories). Personal/gray spend,
 * internal transfers, the card payoff, and all credits are dropped, so
 * only real business overhead is stored. Idempotent: rows upsert on a
 * dedupe_key so the overlapping monthly export never double-counts.
 *
 * POST multipart form: file=<csv>. Returns a summary (inserted, dropped,
 * by-category totals, date range, and a sample of unrecognized debits so
 * a real vendor that fell through can be added to the categorizer).
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function isoDate(mmddyyyy: string): string | null {
  const parts = (mmddyyyy || '').trim().split('/');
  if (parts.length !== 3) return null;
  const [mm, dd, yyyy] = parts;
  if (!yyyy || yyyy.length !== 4) return null;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

type ParsedTxn = {
  account: OverheadAccount;
  txn_date: string | null;
  post_date: string | null;
  description: string;
  amount: number;       // signed as in CSV (negative = cost)
  chaseCategory?: string;
  type?: string;
};

function detectAndParse(text: string): { account: OverheadAccount; rows: ParsedTxn[] } | null {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const fields = (parsed.meta.fields || []).map(f => f.trim());
  const has = (name: string) => fields.some(f => f.toLowerCase() === name.toLowerCase());

  // Card format
  if (has('Card') && has('Transaction Date') && has('Amount')) {
    const rows: ParsedTxn[] = (parsed.data || []).map(r => ({
      account: 'card' as const,
      txn_date: isoDate(r['Transaction Date'] || ''),
      post_date: isoDate(r['Post Date'] || ''),
      description: (r['Description'] || '').trim(),
      amount: parseFloat((r['Amount'] || '0').replace(/[,$]/g, '')) || 0,
      chaseCategory: (r['Category'] || '').trim(),
      type: (r['Type'] || '').trim(),
    }));
    return { account: 'card', rows };
  }

  // Operating (checking) format
  if (has('Details') && has('Posting Date') && has('Balance')) {
    const rows: ParsedTxn[] = (parsed.data || []).map(r => ({
      account: 'operating' as const,
      txn_date: isoDate(r['Posting Date'] || ''),
      post_date: isoDate(r['Posting Date'] || ''),
      description: (r['Description'] || '').trim(),
      amount: parseFloat((r['Amount'] || '0').replace(/[,$]/g, '')) || 0,
      type: (r['Type'] || '').trim(),
    }));
    return { account: 'operating', rows };
  }

  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    const text = await file.text();
    const detected = detectAndParse(text);
    if (!detected) {
      return NextResponse.json(
        { error: 'Unrecognized CSV. Expected a Chase corporate card (*3878) or operating-account (*5130) export.' },
        { status: 400 },
      );
    }

    const { account, rows } = detected;
    const byCategory: Record<string, number> = {};
    const unrecognized: { description: string; amount: number }[] = [];
    let dropped = 0;
    const inserts: Record<string, unknown>[] = [];

    for (const r of rows) {
      const category = categorizeOverhead({
        account: r.account,
        description: r.description,
        amount: r.amount,
        chaseCategory: r.chaseCategory,
        type: r.type,
      });
      if (!category) {
        // On the operating account, a dropped *debit* that isn't a transfer
        // or personal is an unrecognized vendor worth surfacing.
        if (r.account === 'operating' && r.amount < 0) {
          const t = (r.type || '').toUpperCase();
          const isTransfer = t === 'ACCT_XFER' || t === 'LOAN_PMT' || /ONLINE TRANSFER|TRANSACTION#|CHASE CARD|FIDELITY/i.test(r.description);
          if (!isTransfer && unrecognized.length < 25) unrecognized.push({ description: r.description.slice(0, 60), amount: Math.abs(r.amount) });
        }
        dropped++;
        continue;
      }
      const cost = Math.round(Math.abs(r.amount) * 100) / 100;
      const month = r.txn_date ? r.txn_date.slice(0, 7) : '';
      if (!month) { dropped++; continue; }
      const dedupe_key = `${r.account}|${r.txn_date}|${cost}|${r.description.slice(0, 60)}`;
      byCategory[category] = Math.round(((byCategory[category] || 0) + cost) * 100) / 100;
      inserts.push({
        account: r.account,
        txn_date: r.txn_date,
        post_date: r.post_date,
        month,
        description: r.description,
        category,
        raw_category: r.chaseCategory || null,
        amount: cost,
        dedupe_key,
        source: file.name || null,
      });
    }

    let inserted = 0;
    let updated = 0;
    if (inserts.length > 0) {
      // Figure out which keys already exist so we can report new-vs-updated
      // accurately. Then upsert with UPDATE-on-conflict so re-uploads
      // re-categorize existing rows when the categorizer improves (not just
      // skip them) -- the category column refreshes to the latest rules.
      const keys = inserts.map(i => i.dedupe_key as string);
      const existing = new Set<string>();
      for (let i = 0; i < keys.length; i += 200) {
        const slice = keys.slice(i, i + 200);
        const { data: ex } = await supabase
          .from('overhead_expenses')
          .select('dedupe_key')
          .in('dedupe_key', slice);
        (ex || []).forEach(r => existing.add(r.dedupe_key as string));
      }
      const { error } = await supabase
        .from('overhead_expenses')
        .upsert(inserts, { onConflict: 'dedupe_key', ignoreDuplicates: false });
      if (error) {
        return NextResponse.json({ error: `DB write failed: ${error.message}` }, { status: 500 });
      }
      updated = inserts.filter(i => existing.has(i.dedupe_key as string)).length;
      inserted = inserts.length - updated;
    }

    const months = inserts.map(i => i.month as string).filter(Boolean).sort();
    return NextResponse.json({
      success: true,
      account,
      rows_in_file: rows.length,
      categorized: inserts.length,
      inserted_new: inserted,
      already_present: updated,
      dropped,
      by_category: byCategory,
      date_range: months.length ? { from: months[0], to: months[months.length - 1] } : null,
      unrecognized_operating_debits: unrecognized,
    });
  } catch (err) {
    console.error('ingest-overhead error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
