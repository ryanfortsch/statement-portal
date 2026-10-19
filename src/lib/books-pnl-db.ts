import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { buildPnl, yearBounds, type DetailTxn, type JournalEntry, type PnlReport } from '@/lib/books-pnl';

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
  | { ready: true; report: PnlReport; txns: DetailTxn[]; journal: JournalEntry[] }
  | { ready: false; reason: 'tables_missing' | 'error'; message: string };

export function tablesMissing(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST205' || /does not exist|relation|Could not find the table/i.test(e.message || ''));
}

export type JournalRow = JournalEntry & { id: string; created_by: string | null };

/**
 * One entity's year-end journal entries in a date window. The table comes
 * with the balance sheet migration; until it is applied there are none,
 * and the P&L reads exactly as before.
 */
export async function loadJournal(
  entityId: string,
  window: { after?: string; from?: string; through?: string; before?: string },
): Promise<{ ok: true; rows: JournalRow[] } | { ok: false; missing: boolean; message: string }> {
  let q = supabase
    .from('ledger_journal_entries')
    .select('id, entry_date, debit_key, credit_key, amount, memo, created_by')
    .eq('entity_id', entityId);
  if (window.after) q = q.gt('entry_date', window.after);
  if (window.from) q = q.gte('entry_date', window.from);
  if (window.through) q = q.lte('entry_date', window.through);
  if (window.before) q = q.lt('entry_date', window.before);
  // A handful a year; the cap is never near.
  const { data, error } = await q.order('entry_date', { ascending: true }).order('id', { ascending: true }).limit(1000);
  if (error) return { ok: false, missing: tablesMissing(error), message: error.message };
  return { ok: true, rows: (data || []) as JournalRow[] };
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

  const journalLoad = await loadJournal(entityId, { from: start, before: endExclusive });
  if (!journalLoad.ok && !journalLoad.missing) return { ready: false, reason: 'error', message: journalLoad.message };
  const journal = journalLoad.ok ? journalLoad.rows : [];

  const txns: DetailTxn[] = rows.map((r) => ({
    txn_date: r.txn_date,
    amount: r.amount,
    category_key: r.category_key,
    ai_category_key: r.ai_category_key,
    reviewed: r.reviewed,
    description: r.description,
    account_label: r.account_id ? labels.get(r.account_id) ?? null : null,
  }));
  return { ready: true, report: buildPnl(entityId, year, txns, journal), txns, journal };
}
