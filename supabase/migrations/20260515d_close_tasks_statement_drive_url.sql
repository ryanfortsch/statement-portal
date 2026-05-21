-- Drive archive link for monthly owner statements.
--
-- When the operator ticks "Statement sent" in the close-out panel, the
-- statement PDF is archived to the Rising Tide shared Drive under
-- Helm Records / Statements / <year> / <MM Month>/. This column stores
-- the resulting Drive webViewLink on the close_tasks row (which is
-- keyed period_id + property_id — exactly one statement's grain).
--
-- Null until the statement is marked sent AND the Drive upload
-- succeeds. A failed upload leaves this null but never blocks the
-- close-out checkbox — the archive is best-effort.

alter table public.close_tasks
  add column statement_drive_url text;
