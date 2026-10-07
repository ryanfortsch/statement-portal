-- ============================================================================
-- Linked listings: one house sold whole AND as units on separate listings.
-- 17 Beach Road is the first group: the whole house ("Stay at Good Harbor
-- Beach", Guesty-run, every channel), the front unit ("Good Harbor Beach
-- House", Guesty-run, Airbnb only) and the back unit ("Good Harbor Beach -
-- Guest House", a plain Airbnb listing). A whole-house booking closes the
-- units; a unit booking closes the whole house (src/lib/listing-links-core.ts).
-- Additive; service-role only.
-- ============================================================================

create table if not exists public.listing_links (
  id uuid primary key default gen_random_uuid(),
  group_key text not null,
  member_key text not null,
  label text not null,
  role text not null check (role in ('whole','unit')),
  property_id text references public.properties(id) on delete set null,
  guesty_listing_id text,               -- set: Helm writes this member's blocks into Guesty
  ical_url text,                        -- the member's own export feed, read when Guesty does not run it
  export_token text unique,             -- that member imports /api/channels/ical/linked/<token> on its OTA
  active boolean not null default false, -- off until an operator has read a dry run (?dry=1) and switched it on
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_key, member_key)
);

create table if not exists public.listing_link_blocks (
  id uuid primary key default gen_random_uuid(),
  group_key text not null,
  target_member text not null,
  source_member text not null,
  source_key text not null,             -- 'guesty:<reservation id>' or 'ical:<uid>'
  check_in date not null,
  check_out date not null,              -- exclusive
  status text not null check (status in ('active','removed','failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_key, target_member, source_key)
);
create index if not exists idx_listing_link_blocks_group on public.listing_link_blocks(group_key, status);

-- Two linked listings booked for the same nights: one house sold twice.
-- Helm cannot undo a booking, so it says so, once per pair.
create table if not exists public.listing_link_alerts (
  id uuid primary key default gen_random_uuid(),
  group_key text not null,
  fingerprint text not null unique,
  message text not null,
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['listing_links','listing_link_blocks','listing_link_alerts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop; end $$;

insert into public.listing_links (group_key, member_key, label, role, property_id, guesty_listing_id, export_token) values
  ('17_beach', 'whole', 'Stay at Good Harbor Beach (whole house)', 'whole', '17_beach_rd', '695d5c8afb0a0500153d5d1c', null),
  ('17_beach', 'front', 'Good Harbor Beach House (front unit)', 'unit', '17_beach_rd', '696a76a01e0e260014e13054', null),
  ('17_beach', 'back', 'Good Harbor Beach - Guest House (back unit)', 'unit', '17_beach_rd', null, encode(gen_random_bytes(18), 'hex'))
on conflict (group_key, member_key) do nothing;

notify pgrst, 'reload schema';
