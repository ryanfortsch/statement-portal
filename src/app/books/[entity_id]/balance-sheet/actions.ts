'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { LLC_ENTITIES } from '@/lib/books';
import { toCents } from '@/lib/books-pnl';
import {
  isIsoDate,
  openingLinesFor,
  parseMoneyInput,
  validateJournalEntry,
  type BsAccountRow,
} from '@/lib/books-balance-sheet';

/**
 * The balance sheet's writers: the opening figures with the date they are
 * as of, and the year-end journal entries. Owners only: these are the
 * companies' own books, and a server action posts to whatever page
 * rendered it. Each one sends the operator back to the sheet with what
 * happened in the URL (?saved= or ?error=), so the page keeps no client
 * state.
 */

function back(entityId: string, year: string, q: Record<string, string>): string {
  const sp = new URLSearchParams(/^\d{4}$/.test(year) ? { year, ...q } : q);
  return `/books/${entityId}/balance-sheet?${sp.toString()}`;
}

function read(formData: FormData) {
  const str = (k: string) => String(formData.get(k) ?? '').trim();
  const entityId = str('entity_id');
  if (!LLC_ENTITIES[entityId]) throw new Error(`Unknown entity: ${entityId}`);
  return { str, entityId, year: str('year') };
}

type OpeningRow = { id: string; account_id: string | null; category_key: string | null; amount: number | string };

/**
 * Save every opening figure on the form, and the date they are as of. A
 * blank field removes that figure (no figure is different from zero: the
 * sheet asks for a missing one). Every field is read before anything is
 * written, so a typo saves nothing.
 */
export async function saveOpeningBalances(formData: FormData): Promise<void> {
  const email = await requireOwnerEmail();
  const { str, entityId, year } = read(formData);
  const date = str('opening_date');
  if (!isIsoDate(date)) redirect(back(entityId, year, { error: 'Give the opening date as a date.' }));

  const [accounts, existing] = await Promise.all([
    supabase.from('llc_accounts').select('id, kind, label, last4, property_id, inactive').eq('entity_id', entityId),
    supabase.from('llc_opening_balances').select('id, account_id, category_key, amount').eq('entity_id', entityId),
  ]);
  if (accounts.error || existing.error) redirect(back(entityId, year, { error: 'Could not read the books. Nothing was saved; try again.' }));

  const lines = openingLinesFor(entityId, (accounts.data || []) as BsAccountRow[]);
  const figures: { line: (typeof lines)[number]; cents: number | null }[] = [];
  for (const line of lines) {
    const p = parseMoneyInput(String(formData.get(line.id) ?? ''));
    if (!p.ok) redirect(back(entityId, year, { error: `${line.name}: that is not an amount. Nothing was saved.` }));
    figures.push({ line, cents: p.cents });
  }

  const dated = await supabase.from('llc_entities').update({ opening_balance_date: date }).eq('id', entityId);
  if (dated.error) redirect(back(entityId, year, { error: 'Could not save the opening date. Nothing was saved; try again.' }));

  const rows = (existing.data || []) as OpeningRow[];
  const now = new Date().toISOString();
  const failures: string[] = [];
  for (const { line, cents } of figures) {
    const row = rows.find((r) => (line.account_id ? r.account_id === line.account_id : r.category_key === line.category_key));
    if (cents == null) {
      if (!row) continue;
      const del = await supabase.from('llc_opening_balances').delete().eq('id', row.id).eq('entity_id', entityId);
      if (del.error) failures.push(line.name);
    } else if (row) {
      if (toCents(row.amount) === cents) continue;
      const upd = await supabase
        .from('llc_opening_balances')
        .update({ amount: cents / 100, updated_by: email, updated_at: now })
        .eq('id', row.id)
        .eq('entity_id', entityId);
      if (upd.error) failures.push(line.name);
    } else {
      const ins = await supabase.from('llc_opening_balances').insert({
        entity_id: entityId,
        account_id: line.account_id,
        category_key: line.category_key,
        amount: cents / 100,
        updated_by: email,
      });
      if (ins.error) failures.push(line.name);
    }
  }

  revalidatePath(`/books/${entityId}/balance-sheet`);
  if (failures.length > 0) {
    redirect(back(entityId, year, { error: `Saved the rest, but not: ${failures.join(', ')}. Try again.` }));
  }
  redirect(back(entityId, year, { saved: 'opening' }));
}

/** Add one year-end journal entry: debit one chart account, credit another. */
export async function addJournalEntry(formData: FormData): Promise<void> {
  const email = await requireOwnerEmail();
  const { str, entityId, year } = read(formData);
  const entity = await supabase.from('llc_entities').select('opening_balance_date').eq('id', entityId).maybeSingle();
  if (entity.error) redirect(back(entityId, year, { error: 'Could not read the books. Nothing was saved; try again.' }));
  const openingDate = (entity.data as { opening_balance_date: string | null } | null)?.opening_balance_date ?? null;

  const draft = {
    entry_date: str('entry_date'),
    debit_key: str('debit_key'),
    credit_key: str('credit_key'),
    amount: str('amount'),
    memo: str('memo'),
  };
  const v = validateJournalEntry(entityId, draft, openingDate);
  if (!v.ok) redirect(back(entityId, year, { error: v.error }));

  const ins = await supabase.from('ledger_journal_entries').insert({
    entity_id: entityId,
    entry_date: draft.entry_date,
    debit_key: draft.debit_key,
    credit_key: draft.credit_key,
    amount: v.cents / 100,
    memo: draft.memo,
    created_by: email,
  });
  if (ins.error) redirect(back(entityId, year, { error: 'Could not save the entry; try again.' }));
  revalidatePath(`/books/${entityId}/balance-sheet`);
  revalidatePath(`/books/${entityId}/pnl`);
  redirect(back(entityId, year, { saved: 'entry' }));
}

export async function deleteJournalEntry(formData: FormData): Promise<void> {
  await requireOwnerEmail();
  const { str, entityId, year } = read(formData);
  const id = str('id');
  const del = await supabase.from('ledger_journal_entries').delete().eq('id', id).eq('entity_id', entityId);
  if (del.error) redirect(back(entityId, year, { error: 'Could not delete the entry; try again.' }));
  revalidatePath(`/books/${entityId}/balance-sheet`);
  revalidatePath(`/books/${entityId}/pnl`);
  redirect(back(entityId, year, { saved: 'deleted' }));
}
