-- Convert the partial unique INDEX on legacy_perfection_id (added in
-- 20260508_perfection_legacy_id) to a proper unique CONSTRAINT, so
-- ON CONFLICT (legacy_perfection_id) can resolve it during importer
-- upserts. Standard SQL UNIQUE allows multiple NULLs out of the box,
-- so dropping the WHERE clause is safe; the only rows with a non-null
-- value are the ones imported from Perfection (idempotency target).

drop index if exists uniq_work_slips_legacy_perfection_id;
alter table public.work_slips
  add constraint work_slips_legacy_perfection_id_unique
  unique (legacy_perfection_id);

drop index if exists uniq_tasks_legacy_perfection_id;
alter table public.tasks
  add constraint tasks_legacy_perfection_id_unique
  unique (legacy_perfection_id);
