-- ── tasks.priority: medium -> normal ────────────────────────────────
--
-- Second half of 20261018200000_task_priority_normal.sql (run that first,
-- in its own transaction). Every existing 'medium' task becomes 'normal'
-- and new rows default to 'normal'. Idempotent: run it again after the
-- code change merges to catch any task the old build wrote in between.

alter table public.tasks alter column priority set default 'normal';

update public.tasks set priority = 'normal' where priority = 'medium';
