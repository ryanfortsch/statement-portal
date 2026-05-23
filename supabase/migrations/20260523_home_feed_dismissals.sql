-- Per-user dismissals for the home "For Me" feed.
--
-- Clearing an item (work slip, task, needs-reply email, or inbound message)
-- records a row here so it stays cleared across reloads. The feed excludes
-- these rows and backfills the next item from the pool. This is view-only:
-- it never changes the underlying slip/task/email status.
create table if not exists home_feed_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  item_type text not null,            -- 'slip' | 'task' | 'email' | 'inbound'
  item_id text not null,
  dismissed_at timestamptz not null default now(),
  unique (user_email, item_type, item_id)
);

create index if not exists home_feed_dismissals_user_idx
  on home_feed_dismissals (user_email);

-- Reads go through the anon client (auth-gated app); writes go through the
-- service role (server action), which bypasses RLS. Permissive select keeps
-- the read path consistent with the other Helm tables.
alter table home_feed_dismissals enable row level security;
drop policy if exists home_feed_dismissals_read on home_feed_dismissals;
create policy home_feed_dismissals_read on home_feed_dismissals for select using (true);
