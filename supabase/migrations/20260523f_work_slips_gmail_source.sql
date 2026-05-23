-- Link a work_slip back to the email that spawned it, so a guest/owner
-- issue email can auto-open a maintenance slip idempotently (re-running the
-- triage cron never duplicates it). Mirrors work_slips.from_quo_message_id
-- and from_lock_device_id.
alter table work_slips add column if not exists from_gmail_message_id text;

create unique index if not exists work_slips_from_gmail_message_id_key
  on work_slips (from_gmail_message_id)
  where from_gmail_message_id is not null;
