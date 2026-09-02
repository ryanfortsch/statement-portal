-- Overhead: the categorizer matched SHAWS (the grocery store) against the
-- bare 'AWS' software needle, so two July 2026 operating-account grocery
-- debits ($166.35 together) were stored as Software and surfaced on the
-- /forecast Software row. The needle is gone from src/lib/overhead-categories.ts;
-- this removes the rows it already stored. Re-uploading the export cannot do
-- it: the upload skips rows it no longer recognizes and never deletes them.
-- On the operating account, unrecognized debits are dropped by policy, so
-- these rows go rather than move to another category.
delete from public.overhead_expenses
where category = 'Software'
  and upper(description) like '%SHAWS%'
returning month, account, amount, description;
