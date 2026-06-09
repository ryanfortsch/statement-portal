import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { categorizeOverhead, type OverheadAccount } from '@/lib/overhead-categories';

/**
 * Ingest Rising Tide overhead from a corporate-account CSV or XLSX export.
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
 * POST multipart form: file=<csv | xlsx>. Returns a summary (inserted, dropped,
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
    // xlsx/xls → convert the first sheet to CSV via SheetJS, then run
    // through the existing detector. Plain CSV reads as text directly.
    const lowerName = (file.name || '').toLowerCase();
    let text: string;
    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const workbook = XLSX.read(buf, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        if (!firstSheet) {
          return NextResponse.json({ error: 'Workbook has no sheets' }, { status: 400 });
        }
        text = XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheet]);
      } catch (err) {
        return NextResponse.json(
          { error: `Failed to parse Excel file: ${err instanceof Error ? err.message : String(err)}` },
          { status: 400 },
        );
      }
    } else {
      text = await file.text();
    }
    const detected = detectAndParse(text);
    if (!detected) {
      return NextResponse.json(
        { error: 'Unrecognized file. Expected a Chase corporate card (*3878) or operating-account (*5130) export (.csv or .xlsx).' },
        { status: 400 },
      );
    }

    const { account, rows } = detected;
    const byCategory: Record<string, number> = {};
    const unrecognized: { description: string; amount: number }[] = [];
    let dropped = 0;
    const inserts: Record<string, unknown>[] = [];
    // Merge rows that collapse to the same dedupe_key (e.g. two identical
    // same-day charges to one vendor). Postgres' ON CONFLICT DO UPDATE can't
    // touch the same row twice in one batch, so the upsert would throw if the
    // batch had internal dupes. We sum their amounts into a single row, which
    // both fixes that and keeps the category total honest.
    const byKey = new Map<string, Record<string, unknown>>();

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
      const existing = byKey.get(dedupe_key);
      if (existing) {
        // Same-key collision within this file: fold the amount in so we don't
        // ask the upsert to update one row twice (and don't lose the charge).
        existing.amount = Math.round((((existing.amount as number) || 0) + cost) * 100) / 100;
        continue;
      }
      const row = {
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
      };
      byKey.set(dedupe_key, row);
      inserts.push(row);
    }

    // The file's covered txn_date window, taken from ALL parsed rows (not just
    // the categorized ones) so a stale row at the edge that now drops is still
    // inside the reconcile range.
    const fileDates = rows.map(r => r.txn_date).filter((d): d is string => !!d).sort();
    const minDate = fileDates[0];
    const maxDate = fileDates[fileDates.length - 1];

    let inserted = 0;
    let updated = 0;
    let pruned = 0;
    if (inserts.length > 0) {
      const currentKeys = new Set(inserts.map(i => i.dedupe_key as string));

      // Snapshot the covered window for this account BEFORE writing, so we can
      // (a) report new-vs-updated accurately and (b) find rows that used to be
      // here but aren't in the file anymore.
      const preExisting: string[] = [];
      if (minDate && maxDate) {
        for (let from = 0; ; from += 1000) {
          const { data: ex } = await supabase
            .from('overhead_expenses')
            .select('dedupe_key')
            .eq('account', account)
            .gte('txn_date', minDate)
            .lte('txn_date', maxDate)
            .range(from, from + 999);
          if (!ex || ex.length === 0) break;
          ex.forEach(r => preExisting.push(r.dedupe_key as string));
          if (ex.length < 1000) break;
        }
      }
      const preSet = new Set(preExisting);
      updated = inserts.filter(i => preSet.has(i.dedupe_key as string)).length;
      inserted = inserts.length - updated;

      // Upsert with UPDATE-on-conflict so re-uploads re-categorize existing
      // rows when the categorizer improves (not just skip them).
      const { error } = await supabase
        .from('overhead_expenses')
        .upsert(inserts, { onConflict: 'dedupe_key', ignoreDuplicates: false });
      if (error) {
        return NextResponse.json({ error: `DB write failed: ${error.message}` }, { status: 500 });
      }

      // Prune stale rows: previously stored in this window but no longer in the
      // file -- e.g. a charge that now categorizes to "dropped" because its
      // vendor was newly flagged personal. Without this, re-ingest can only
      // re-label rows, never remove them, so the totals would stay inflated.
      const stale = preExisting.filter(k => !currentKeys.has(k));
      for (let i = 0; i < stale.length; i += 100) {
        const slice = stale.slice(i, i + 100);
        const { error: delErr } = await supabase.from('overhead_expenses').delete().in('dedupe_key', slice);
        if (!delErr) pruned += slice.length;
      }
    }

    const months = inserts.map(i => i.month as string).filter(Boolean).sort();
    return NextResponse.json({
      success: true,
      account,
      rows_in_file: rows.length,
      categorized: inserts.length,
      inserted_new: inserted,
      already_present: updated,
      pruned,
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
