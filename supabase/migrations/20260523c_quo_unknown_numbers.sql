-- Triage queue for inbound Quo (OpenPhone) from numbers not yet in contacts.
--
-- The webhook only logs a contact_touch when the phone matches a known
-- contact (and a cleaning_completion when it matches a cleaner). Everyone
-- else -- prospects, owners-to-be, vendors texting in -- was dropped; only
-- the raw quo_events audit kept it, which no UI reads. This table
-- aggregates those unknown inbound numbers, one row per phone, so /crm can
-- show a "new numbers reaching out" queue with one-click add-as-contact /
-- dismiss (add backfills the conversation from quo_events).
create table if not exists quo_unknown_numbers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  last_message_at timestamptz,
  last_body text,
  last_direction text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'pending',     -- 'pending' | 'added' | 'dismissed'
  contact_id uuid references contacts(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists quo_unknown_numbers_status_idx
  on quo_unknown_numbers (status, last_message_at desc);

-- Reads come from the anon client (auth-gated app) and the triage server
-- actions also write via anon, same as the contacts table; the Quo ingest
-- writes via the service role. A permissive policy keeps all three working,
-- consistent with the rest of Helm's public tables.
alter table quo_unknown_numbers enable row level security;
drop policy if exists quo_unknown_numbers_all on quo_unknown_numbers;
create policy quo_unknown_numbers_all on quo_unknown_numbers for all using (true) with check (true);
