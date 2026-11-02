-- Itemized cleaning on the owner statement, opt-in per home.
--
-- The statement prints one Cleaning line on purpose. Some owners want to see
-- what it was made of: Lisa and David Gruber (16 Waterman) asked for an
-- itemized list of October's cleanings at the November 2 close. Rather than
-- paste a table into one email, the home opts in once and every statement
-- after carries a "Cleaning, by turnover" block under the Financials column:
-- one row per checkout, housekeeping and the laundry delivery attributed to
-- it added together, with a total that ties to the Cleaning line.
--
-- The flag lives on the registry row because it is a standing preference of
-- the owner, not a fact about one month. It changes presentation only: no
-- money column reads it. Owners set it from the property page's Owner & money
-- tab (updateStatementCleaningDetail, owners only).
--
-- Re-runnable: add column if not exists; the seed is keyed on the one home
-- that asked. Applied by hand, as migrations here are.
alter table public.properties
  add column if not exists statement_cleaning_detail boolean not null default false;

comment on column public.properties.statement_cleaning_detail is
  'Owner opted in to an itemized cleaning block (one row per turnover) on each monthly statement. Presentation only; cleaning_total is unchanged.';

update public.properties
   set statement_cleaning_detail = true,
       updated_at = now()
 where id = '16_waterman'
   and statement_cleaning_detail = false;
