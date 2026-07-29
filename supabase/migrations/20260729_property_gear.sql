-- Guest-gear inventory: which homes currently have which portable gear (pack
-- 'n play, high chair, ...) and where it lives. One row per (property, item);
-- presence = a row with a non-empty location. Same RLS posture as every Field
-- table: locked, service-role only.
create table if not exists public.property_gear (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  item_key text not null,
  location text not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (property_id, item_key)
);
alter table public.property_gear enable row level security;
