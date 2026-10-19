-- LLC Accounting ("Books"): what each LLC's year-end balance sheet needs.
--
-- The CPA asked for a P&L and a balance sheet per LLC (2026-10-19). The
-- P&L reads ledger_transactions alone (20261019180000_books_ledger_tables,
-- brought to its shape by 20261019190000_books_ledger_for_pnl).
-- A balance sheet also needs where each account stood on the day Helm's
-- books open, and the few year-end entries that move money between two
-- chart accounts without cash (the 1098's interest out of a mortgage the
-- payments were filed to, a loan a partner paid personally, the CPA's
-- depreciation). src/lib/books-balance-sheet.ts holds the rules.
--
-- Runs after 20261019190000: it alters the tables those two create, and
-- it replaces that migration's chart_of_accounts_type_check with one that
-- also admits 'asset'. It only upserts its own chart rows; nothing here
-- rebuilds the chart (books-pnl.test.ts holds that).
--
-- Additive:
--   - llc_entities.opening_balance_date, null until the operator sets it.
--   - llc_opening_balances: one figure per bank or card account, or per
--     asset or liability chart account, as of that date.
--   - ledger_journal_entries: one debit, one credit, one positive amount,
--     so an entry is balanced by construction.
--   - chart_of_accounts.type also admits 'asset' (the check is widened,
--     never narrowed), and the new asset and liability accounts are seeded.
--     The seed rows are generated from src/lib/books.ts, which stays the
--     authority the app reads; books-balance-sheet.test.ts fails if the two
--     drift.
-- Nothing existing is rewritten or removed.

alter table public.llc_entities
  add column if not exists opening_balance_date date;
comment on column public.llc_entities.opening_balance_date is
  'The day llc_opening_balances are as of. The balance sheet counts ledger rows and journal entries from the day after.';

-- One opening figure: a bank or card account (llc_accounts), or an asset
-- or liability on the chart (by key). Positive as the statement shows it:
-- cash in a bank account, owed on a card or a loan, an asset's cost,
-- depreciation taken so far.
create table if not exists public.llc_opening_balances (
  id            uuid primary key default gen_random_uuid(),
  entity_id     text not null references public.llc_entities(id),
  account_id    uuid references public.llc_accounts(id),
  category_key  text,
  amount        numeric(14,2) not null,
  updated_by    text,
  updated_at    timestamptz not null default now(),
  constraint llc_opening_balances_one_line check (num_nonnulls(account_id, category_key) = 1)
);
create unique index if not exists uniq_llc_opening_account
  on public.llc_opening_balances(entity_id, account_id) where account_id is not null;
create unique index if not exists uniq_llc_opening_category
  on public.llc_opening_balances(entity_id, category_key) where category_key is not null;

-- A year-end journal entry: debit one chart account, credit another.
create table if not exists public.ledger_journal_entries (
  id          uuid primary key default gen_random_uuid(),
  entity_id   text not null references public.llc_entities(id),
  entry_date  date not null,
  debit_key   text not null,
  credit_key  text not null,
  amount      numeric(14,2) not null check (amount > 0),
  memo        text not null,
  created_by  text,
  created_at  timestamptz not null default now(),
  constraint ledger_journal_entries_two_sides check (debit_key <> credit_key)
);
create index if not exists idx_journal_entity_date on public.ledger_journal_entries(entity_id, entry_date);

alter table public.llc_opening_balances enable row level security;
alter table public.ledger_journal_entries enable row level security;
revoke all on public.llc_opening_balances, public.ledger_journal_entries from anon, authenticated;
grant all on public.llc_opening_balances, public.ledger_journal_entries to service_role;

comment on table public.llc_opening_balances is
  'LLC Accounting: each bank, card, asset and liability figure as of llc_entities.opening_balance_date. Written by the balance sheet page; read by it and its CPA export.';
comment on table public.ledger_journal_entries is
  'LLC Accounting: year-end journal entries (debit one chart key, credit another). Read by the P&L and the balance sheet, so both report the same books.';

-- Assets join the chart: the same named check 20261019190000 adds, widened.
alter table public.chart_of_accounts
  drop constraint if exists chart_of_accounts_type_check,
  add constraint chart_of_accounts_type_check
    check (type in ('income', 'cogs', 'expense', 'other_income', 'other_expense', 'equity', 'liability', 'asset'));

-- ── Seed (generated from src/lib/books.ts) ───────────────────────────

insert into public.chart_of_accounts (entity_id, key, parent_key, name, type, tax_hint, pass_through, sort) values
  (null, 'fixed_assets', null, 'Fixed Assets', 'asset', 'At cost; the CPA posts the year''s depreciation', false, 750),
  (null, 'land', 'fixed_assets', 'Land', 'asset', 'Not depreciated', false, 751),
  (null, 'buildings_improvements', 'fixed_assets', 'Buildings & Improvements', 'asset', 'A capital improvement (new roof, new system) files here, not Repairs', false, 752),
  (null, 'furniture_equipment', 'fixed_assets', 'Furniture & Equipment', 'asset', 'Items over $2,500 each; smaller buys stay an expense', false, 753),
  (null, 'accumulated_depreciation', 'fixed_assets', 'Accumulated Depreciation', 'asset', 'Contra-asset from the CPA''s depreciation schedule', false, 754),
  (null, 'other_assets', null, 'Other Assets', 'asset', 'Deposits, escrow, money lent', false, 760),
  ('goose_astoria', 'mortgage_3_locust', null, 'Mortgage, 3 Locust', 'liability', 'Principal owed. The Florida house mortgage is not here: it files to Due from Florida Property', false, 873),
  ('goose_calderwood', 'mortgage_65_calderwood', null, 'Mortgage, 65 Calderwood', 'liability', 'Principal owed', false, 874),
  (null, 'loans_payable', null, 'Other Loans Payable', 'liability', 'Principal owed on any other loan', false, 875),
  ('rising_tide', 'owner_funds_held_in_trust', null, 'Owner Funds Held in Trust', 'liability', 'The owners'' money in the per-property accounts; pass-through rows move it', false, 876)
on conflict ((coalesce(entity_id, '')), key) do update set
  parent_key = excluded.parent_key, name = excluded.name, type = excluded.type,
  tax_hint = excluded.tax_hint, pass_through = excluded.pass_through, sort = excluded.sort;
