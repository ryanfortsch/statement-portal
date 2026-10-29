-- Rising Tide's second Chase credit card, ending 6250.
--
-- Ryan (2026-10-20): the 5130, 3878 and 6250 statements are Rising Tide's.
-- The 10/21 books review found 5130 paying this card ($11,088.12 Jul-Aug)
-- with no account to upload its charges to, so they were never in the
-- ledger. This lists it beside 3878 in the Books picker; LLC_ACCOUNTS in
-- src/lib/books.ts carries the same row for the code side, and
-- books-pnl.test.ts holds the two in step.
--
-- Idempotent through uniq_llc_accounts_last4 (entity, kind, last4).
-- No new table, so no grant is needed.
insert into public.llc_accounts (entity_id, kind, institution, last4, label, property_id) values
  ('rising_tide', 'credit_card', 'Chase', '6250', 'Rising Tide Credit Card', null)
on conflict (entity_id, kind, last4) where last4 is not null do nothing;
