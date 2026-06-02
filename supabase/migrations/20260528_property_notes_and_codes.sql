-- "Property notes" infrastructure + four new access-code columns.
--
-- Two parts:
--
-- 1. Four new single-value text columns for access codes (parallel to the
--    existing smart_lock_brand / smart_lock_code pattern). Live in the
--    operational data sections — thermostat under Utilities, garage/gate
--    under Access & notes.
--
-- 2. New public.property_notes table — a structured per-entry replacement
--    for the existing freeform properties.property_notes text column.
--    Each row is one note: title + body, optional tag + photo, optional
--    resolved_at for one-shot todos. Renders as a new "Property Notes"
--    accordion on /properties/[id], slotted between Utilities and STR
--    setup.
--
-- The legacy properties.property_notes single-text column is migrated
-- into the new table as a single seed row per property where non-empty,
-- then dropped. Callers (edit form, projections promote, onboarding
-- pre-fill, property-page display) are updated in the same PR.

-- ─── New code columns ───────────────────────────────────────────────
alter table public.properties
  add column if not exists thermostat_brand text,
  add column if not exists thermostat_code text,
  add column if not exists garage_code text,
  add column if not exists gate_code text;

comment on column public.properties.thermostat_brand is 'Nest / ecobee / Honeywell etc. Surfaced in the Utilities subsection.';
comment on column public.properties.thermostat_code is 'PIN / app login for the smart thermostat. Owner-supplied during onboarding.';
comment on column public.properties.garage_code is 'Numeric keypad code for the garage door, if any.';
comment on column public.properties.gate_code is 'Driveway / community gate code, if any.';

-- ─── property_notes table ───────────────────────────────────────────
create table if not exists public.property_notes (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  title text not null,
  body text not null default '',
  tag text,                          -- free-form category label
  photo_urls text[] not null default '{}',
  author_email text,                 -- who added it; null for system seeds
  resolved_at timestamptz,           -- non-null = closed / no longer relevant
  resolved_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists property_notes_property_id_idx
  on public.property_notes(property_id, created_at desc);

create index if not exists property_notes_open_idx
  on public.property_notes(property_id) where resolved_at is null;

alter table public.property_notes enable row level security;

create policy "anyone can read property_notes" on public.property_notes
  for select using (true);
create policy "anyone can insert property_notes" on public.property_notes
  for insert with check (true);
create policy "anyone can update property_notes" on public.property_notes
  for update using (true);
create policy "anyone can delete property_notes" on public.property_notes
  for delete using (true);

create or replace function public.set_property_notes_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists property_notes_updated_at on public.property_notes;
create trigger property_notes_updated_at
  before update on public.property_notes
  for each row execute function public.set_property_notes_updated_at();

-- ─── Migrate the legacy single-text column ──────────────────────────
-- For every property that has a non-empty property_notes blob today,
-- create one corresponding row in the new table seeded from that text.
-- Title is generic ("Migrated from legacy notes") so the operator can
-- rename + split as they revisit each property.
insert into public.property_notes (property_id, title, body, tag, author_email, created_at)
select
  id,
  'Migrated from legacy notes',
  property_notes,
  'general',
  null,
  coalesce(created_at, now())
from public.properties
where property_notes is not null and trim(property_notes) <> '';

-- ─── Drop the legacy column ─────────────────────────────────────────
-- Callers are updated in the same PR so this won't break a live read.
alter table public.properties drop column if exists property_notes;
