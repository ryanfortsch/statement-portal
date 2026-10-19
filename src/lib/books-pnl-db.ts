import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { buildPnl, yearBounds, type DetailTxn, type PnlReport } from '@/lib/books-pnl';

/**
 * One entity's ledger for one year, read whole: a year of an LLC's bank and
 * card rows runs to thousands, past PostgREST's silent 1000-row cap, so it
 * pages (CLAUDE.md watch-out 1). The P&L page and the CPA export both read
 * through here, so the two can never disagree.
 */

type LedgerRow = {
  id: string;
  account_id: string | null;
  txn_date: string;
  description: string;
  amount: number | string;
  category_key: string | null;
  ai_category_key: string | null;
  reviewed: boolean;
};

export type PnlLoad =
  | { ready: true; report: PnlReport; txns: DetailTxn[] }
  | { ready: false; reason: 'tables_missing' | 'error'; message: string };

function tablesMissing(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST205' || /does not exist|relation|Could not find the table/i.test(e.message || ''));
}

export async function loadPnl(entityId: string, year: number): Promise<PnlLoad> {
  const { start, endExclusive } = yearBounds(year);
  const accounts = await supabase.from('llc_accounts').select('id, label, last4').eq('entity_id', entityId);
  if (accounts.error) {
    return { ready: false, reason: tablesMissing(accounts.error) ? 'tables_missing' : 'error', message: accounts.error.message };
  }
  const labels = new Map<string, string>();
  for (const a of (accounts.data || []) as { id: string; label: string | null; last4: string | null }[]) {
    labels.set(a.id, [a.label, a.last4 ? `x${a.last4}` : null].filter(Boolean).join(' '));
  }

  let rows: LedgerRow[];
  try {
    rows = await selectAllPaged<LedgerRow>(
      (from, to) =>
        supabase
          .from('ledger_transactions')
          .select('id, account_id, txn_date, description, amount, category_key, ai_category_key, reviewed')
          .eq('entity_id', entityId)
          .gte('txn_date', start)
          .lt('txn_date', endExclusive)
          .order('txn_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'books P&L' },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ready: false, reason: tablesMissing({ message }) ? 'tables_missing' : 'error', message };
  }

  const txns: DetailTxn[] = rows.map((r) => ({
    txn_date: r.txn_date,
    amount: r.amount,
    category_key: r.category_key,
    ai_category_key: r.ai_category_key,
    reviewed: r.reviewed,
    description: r.description,
    account_label: r.account_id ? labels.get(r.account_id) ?? null : null,
  }));
  return { ready: true, report: buildPnl(entityId, year, txns), txns };
}
