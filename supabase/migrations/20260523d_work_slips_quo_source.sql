-- Link a work_slip back to the Quo message that spawned it, so a cleaner's
-- "X is broken" text can auto-open a maintenance slip idempotently:
-- replaying quo_events through the ingest (reprocess / cron) never
-- duplicates the slip. Mirrors cleaning_completions.source_message_id and
-- work_slips.from_lock_device_id (Seam) dedupe patterns.
alter table work_slips add column if not exists from_quo_message_id text;

create unique index if not exists work_slips_from_quo_message_id_key
  on work_slips (from_quo_message_id)
  where from_quo_message_id is not null;
