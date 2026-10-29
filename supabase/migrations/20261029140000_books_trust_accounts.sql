-- The eleven owner trust accounts opened since the Books seed, into Books.
--
-- Each home's Chase checking is held in trust for its owner; Books lists
-- them beside the company accounts so their statements can be uploaded and
-- the P&L shows owner money beside net income, never in it (books-pnl.ts).
-- The 10/19 seed carried the nine older homes only. The last4-to-home map
-- for these was proven in the 10/21 books review: each account's fee sweep
-- into 5130 equals the home's statement fee to the cent, and 4 Middle's
-- (1226) and 47 Atlantic's (1233) are on their property rows.
--
-- 16 Waterman and 79 Main had no bank last4 on their property rows, which
-- is why their sweeps never tied; filled here, empty rows only.
--
-- Idempotent through uniq_llc_accounts_last4 (entity, kind, last4). No new
-- table, so no grant is needed. LLC_ACCOUNTS in src/lib/books.ts carries the
-- same rows for the code side; books-pnl.test.ts holds the two in step.
update public.properties set bank_last4 = '0627' where id = '16_waterman' and bank_last4 is null;
update public.properties set bank_last4 = '0631' where id = '79_main' and bank_last4 is null;

insert into public.llc_accounts (entity_id, kind, institution, last4, label, property_id) values
  ('rising_tide', 'bank', 'Chase', '0626', '36 Granite', '36_granite'),
  ('rising_tide', 'bank', 'Chase', '0627', '16 Waterman', '16_waterman'),
  ('rising_tide', 'bank', 'Chase', '0628', '19 Rackliffe (Silverman)', '19_rackliffe'),
  ('rising_tide', 'bank', 'Chase', '0629', '84 Thatcher (Lopes)', '84_thatcher'),
  ('rising_tide', 'bank', 'Chase', '0631', '79 Main (Lambert-Vorais)', '79_main'),
  ('rising_tide', 'bank', 'Chase', '1226', '4 Middle (Rosenstein)', '4_middle'),
  ('rising_tide', 'bank', 'Chase', '1227', '7 Sumac (Montagnino)', '7_sumac'),
  ('rising_tide', 'bank', 'Chase', '1228', '53 Rocky Neck, Downstairs (Prudenzi)', '53_rocky_neck_2'),
  ('rising_tide', 'bank', 'Chase', '1229', '225 Washington (Babson)', '225_washington'),
  ('rising_tide', 'bank', 'Chase', '1232', '3 Windward (Moynahan)', '3_windward'),
  ('rising_tide', 'bank', 'Chase', '1233', '47 Atlantic (Erickson)', '47_atlantic')
on conflict (entity_id, kind, last4) where last4 is not null do nothing;
