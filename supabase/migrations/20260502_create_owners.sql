-- Entity layer (3/3): owners as a first-class entity.
--
-- Today owner identity (name_full, name_greeting, name_last, emails) is
-- duplicated columns on public.properties. That's fine while one owner = one
-- property and CRM doesn't exist yet, but it falls apart the moment:
--   - one owner has multiple properties (will happen as the portfolio grows)
--   - CRM wants to attach notes / interactions / comms to the owner record
--   - we want to send a single email to an owner about all their statements
--
-- This adds a public.owners table and a nullable owner_id FK on properties.
-- The existing properties.owner_* columns STAY as denormalized read columns
-- so every page that currently reads p.owner_full / p.owner_emails keeps
-- working without a code change. Future code (CRM, owner-scoped statement
-- digest, etc.) joins via owner_id.
--
-- Backfill creates one owner per property using current values. When two
-- properties later belong to the same owner, the fix is a manual UPDATE in
-- the dashboard: set both properties.owner_id to the same uuid and delete
-- the duplicate owner row. No code change required.

create table public.owners (
  id uuid primary key default gen_random_uuid(),

  -- Naming. Mirrors the property columns so backfill is 1:1.
  name_full text not null,        -- "The Snyder Family" / "Marci & Paul Bailey"
  name_greeting text not null,    -- "Kathleen and Robert" — for "Hi __,"
  name_last text not null,        -- "Snyder" — short label for tables

  -- Comms. Array for now; if CRM eventually needs per-email metadata
  -- (primary, opt-out, bounces) we split into a child table.
  emails text[] not null default '{}',

  -- Optional CRM-style notes. Stays empty until CRM module lands.
  notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_owners_name_last on public.owners(name_last);

-- Reuses public.update_updated_at_column() from the properties migration.
create trigger owners_updated_at
  before update on public.owners
  for each row
  execute function public.update_updated_at_column();

alter table public.owners enable row level security;

create policy "anyone can read owners"
  on public.owners for select using (true);
create policy "anyone can insert owners"
  on public.owners for insert with check (true);
create policy "anyone can update owners"
  on public.owners for update using (true);
create policy "anyone can delete owners"
  on public.owners for delete using (true);

-- Nullable FK on properties. Existing owner_* columns stay (see header).
alter table public.properties
  add column if not exists owner_id uuid references public.owners(id);

create index if not exists idx_properties_owner_id on public.properties(owner_id);

-- ─── Backfill: one owner per property ─────────────────────────────────────
-- Idempotent: only acts on properties that don't already have owner_id.
do $$
declare
  prop record;
  new_owner_id uuid;
begin
  for prop in
    select id, owner_last, owner_full, owner_greeting, owner_emails
    from public.properties
    where owner_id is null
  loop
    insert into public.owners (name_full, name_greeting, name_last, emails)
    values (prop.owner_full, prop.owner_greeting, prop.owner_last, prop.owner_emails)
    returning id into new_owner_id;

    update public.properties set owner_id = new_owner_id where id = prop.id;
  end loop;
end $$;
