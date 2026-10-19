import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { loadJournal, tablesMissing, type JournalRow } from '@/lib/books-pnl-db';
import {
  DEFAULT_OPENING_DATE,
  buildBalanceSheet,
  chaseBalanceFromRaw,
  isIsoDate,
  type BalanceSheet,
  type BsAccountRow,
  type BsOpening,
  type BsTxn,
} from '@/lib/books-balance-sheet';

/**
 * One entity's balance sheet at December 31 of a year, read whole: its
 * accounts, the opening figures and date, every ledger row and journal
 * entry from the day after the opening date through December 31 (paged:
 * a year runs past PostgREST's silent 1000-row cap, CLAUDE.md watch-out 1).
 * The page and the CPA export both read through here.
 *
 * Until the opening date is saved, the sheet is built from
 * DEFAULT_OPENING_DATE with no opening figures, as a preview the page
 * marks as such; the export refuses it.
 */

type LedgerRow = {
  id: string;
  account_id: string | null;
  txn_date: string;
  amount: number | string;
  category_key: string | null;
  ai_category_key: string | null;
  reviewed: boolean;
  raw: unknown;
};

export type BalanceSheetLoad =
  | {
      ready: true;
      /** Null when December 31 of the year falls before the books open. */
      sheet: BalanceSheet | null;
      openingSaved: boolean;
      openingDate: string;
      accounts: BsAccountRow[];
      openings: BsOpening[];
      journal: JournalRow[];
    }
  | { ready: false; reason: 'tables_missing' | 'error'; message: string };

const fail = (e: { code?: string; message: string }): BalanceSheetLoad => ({
  ready: false,
  reason: tablesMissing(e) ? 'tables_missing' : 'error',
  message: e.message,
});

export async function loadBalanceSheet(entityId: string, year: number): Promise<BalanceSheetLoad> {
  const [entity, accounts, openings] = await Promise.all([
    supabase.from('llc_entities').select('opening_balance_date').eq('id', entityId).maybeSingle(),
    supabase.from('llc_accounts').select('id, kind, label, last4, property_id, inactive').eq('entity_id', entityId),
    supabase.from('llc_opening_balances').select('account_id, category_key, amount').eq('entity_id', entityId),
  ]);
  if (entity.error) return fail(entity.error);
  if (accounts.error) return fail(accounts.error);
  if (openings.error) return fail(openings.error);

  const saved = (entity.data as { opening_balance_date: string | null } | null)?.opening_balance_date ?? null;
  const openingDate = isIsoDate(saved) ? saved : DEFAULT_OPENING_DATE;
  const accountRows = (accounts.data || []) as BsAccountRow[];
  const openingRows = (openings.data || []) as BsOpening[];
  const yearEnd = `${year}-12-31`;
  const base = { ready: true as const, openingSaved: !!saved, openingDate, accounts: accountRows, openings: openingRows };
  if (yearEnd < openingDate) return { ...base, sheet: null, journal: [] };

  let rows: LedgerRow[];
  try {
    rows = await selectAllPaged<LedgerRow>(
      (from, to) =>
        supabase
          .from('ledger_transactions')
          .select('id, account_id, txn_date, amount, category_key, ai_category_key, reviewed, raw')
          .eq('entity_id', entityId)
          .gt('txn_date', openingDate)
          .lte('txn_date', yearEnd)
          .order('txn_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'books balance sheet' },
    );
  } catch (err) {
    return fail({ message: err instanceof Error ? err.message : String(err) });
  }

  const journal = await loadJournal(entityId, { after: openingDate, through: yearEnd });
  if (!journal.ok) return fail({ message: journal.message, code: journal.missing ? 'PGRST205' : undefined });

  const txns: BsTxn[] = rows.map((r) => ({
    txn_date: r.txn_date,
    amount: r.amount,
    category_key: r.category_key,
    ai_category_key: r.ai_category_key,
    reviewed: r.reviewed,
    account_id: r.account_id,
    chase_balance: chaseBalanceFromRaw(r.raw),
  }));
  const sheet = buildBalanceSheet({
    entityId,
    year,
    openingDate,
    accounts: accountRows,
    openings: openingRows,
    txns,
    journal: journal.rows,
  });
  return { ...base, sheet, journal: journal.rows };
}
