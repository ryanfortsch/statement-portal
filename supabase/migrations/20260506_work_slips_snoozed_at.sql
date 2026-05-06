-- Stamp WHEN a snooze was set, so activity feeds can render
-- "Allie snoozed kitchen leak until June 1" with the right
-- timestamp (we already have snoozed_until = expires + snoozed_by_email
-- = who, but not when the snooze decision was made).
--
-- Cleared (set to null) on un-snooze, same as snoozed_until.

alter table public.work_slips
  add column if not exists snoozed_at timestamptz;

create index if not exists idx_work_slips_snoozed_at
  on public.work_slips(snoozed_at);
