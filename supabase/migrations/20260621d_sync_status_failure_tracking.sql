-- Sync visibility: track failures alongside successes on public.sync_status so
-- the daily brief can surface a stuck or errored feed instead of letting it
-- silently drift.
--
-- Today every sync (Guesty, Stripe, Quo, Seam, iCal, Gmail, the CSV fallback)
-- only stamps last_synced_at on SUCCESS. A failure leaves the row unchanged
-- and nobody finds out. This migration adds the columns + a thin atomic RPC
-- the helper at src/lib/sync-status.ts uses to record failures.
--
-- Safe to apply ahead of the writer code: every existing writer only sets
-- {source, last_synced_at, last_result} and is unaffected by the new
-- NULL-tolerant columns and their defaults. Reversible (see Rollback below).

alter table public.sync_status
  add column if not exists last_attempted_at timestamptz,
  add column if not exists last_status       text       not null default 'ok',
  add column if not exists last_error        text,
  add column if not exists last_error_at     timestamptz,
  add column if not exists error_count       integer    not null default 0;

-- Constrain last_status to the two values the helper writes. Kept as a CHECK
-- (not an enum) so a future "stale"/"pending" state can be added by editing
-- the constraint in place.
alter table public.sync_status
  drop constraint if exists sync_status_last_status_check;
alter table public.sync_status
  add constraint sync_status_last_status_check
  check (last_status in ('ok', 'error'));

-- Backfill: existing rows are real successful syncs (csv-fallback,
-- gmail-replies, guesty-*, quo, stripe). Mirror last_synced_at into
-- last_attempted_at so the new "stale > maxAge" check returns the same answer
-- the existing freshness badges return. status defaulted to 'ok' on add.
update public.sync_status
set last_attempted_at = last_synced_at
where last_attempted_at is null;

-- The first failure on a brand-new source must be recordable. The legacy
-- table has last_synced_at NOT NULL; the failure path inserts NULL there
-- (we have not yet succeeded), so relax the constraint.
alter table public.sync_status alter column last_synced_at drop not null;

-- Atomic failure recorder. Keeps error_count increment race-free between a
-- cron run and a manual "Sync now" click landing at the same time -- a
-- read-modify-write from JS would lose increments. service_role only:
-- anon/authenticated should never bypass the helper to call this directly.
create or replace function public.record_sync_failure(
  p_source text,
  p_error  text,
  p_now    timestamptz default now()
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.sync_status as s
    (source, last_synced_at, last_attempted_at, last_status, last_error, last_error_at, error_count, updated_at)
  values
    (p_source, null, p_now, 'error', p_error, p_now, 1, p_now)
  on conflict (source) do update
    set last_attempted_at = excluded.last_attempted_at,
        last_status       = 'error',
        last_error        = excluded.last_error,
        last_error_at     = excluded.last_error_at,
        error_count       = s.error_count + 1,
        updated_at        = excluded.updated_at;
$$;

revoke all on function public.record_sync_failure(text, text, timestamptz) from public;
grant execute on function public.record_sync_failure(text, text, timestamptz) to service_role;

-- Rollback: every change above is reversible without data loss.
--   alter table public.sync_status
--     drop column if exists last_attempted_at,
--     drop column if exists last_status,
--     drop column if exists last_error,
--     drop column if exists last_error_at,
--     drop column if exists error_count;
--   drop function if exists public.record_sync_failure(text, text, timestamptz);
--   alter table public.sync_status alter column last_synced_at set not null;
