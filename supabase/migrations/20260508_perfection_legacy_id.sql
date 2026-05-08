-- Track which Perfection (Lovable) record a Helm work_slip / task was
-- imported from, so re-running the importer is idempotent (upsert by
-- legacy_perfection_id rather than re-inserting duplicates).
--
-- Nullable so brand-new Helm records (created natively, never lived in
-- Perfection) leave it blank. Unique-when-not-null so we never import
-- the same Perfection record twice.

alter table public.work_slips
  add column if not exists legacy_perfection_id uuid;

create unique index if not exists uniq_work_slips_legacy_perfection_id
  on public.work_slips(legacy_perfection_id)
  where legacy_perfection_id is not null;

alter table public.tasks
  add column if not exists legacy_perfection_id uuid;

create unique index if not exists uniq_tasks_legacy_perfection_id
  on public.tasks(legacy_perfection_id)
  where legacy_perfection_id is not null;

-- task_comments don't have their own Perfection-id since the importer
-- attaches them via the parent task's new uuid. They get re-imported
-- alongside the parent task on the second run.
