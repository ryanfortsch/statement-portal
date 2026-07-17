-- Property onboarding hub: the deep intake that takes a home from "house on
-- a lot" to "live, smooth-running listing".
--
-- Two stores:
--   property_rooms            one row per physical space (bedroom 2, main
--                             bath, kitchen, deck...) with structured details
--                             + quirks. Fed by the walkthrough dictation
--                             flow and hand edits; read by the Onboarding
--                             tab and (guest_facing summaries) the guest KB.
--   property_onboarding_items per-property status for each catalog item
--                             (the catalog itself lives in code:
--                             src/lib/onboarding-catalog.ts, same pattern as
--                             launch-checklist.ts / property_launch_steps).
--                             Only items an operator has touched get a row;
--                             auto-derived items compute live from property
--                             data and need no row at all.
--
-- Both are RLS-locked to the service role (house pattern from
-- property_access, #668): no anon or authenticated access, reads and writes
-- go through server-only helpers.

create table if not exists property_rooms (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  room_type text not null check (room_type in (
    'bedroom', 'bathroom', 'kitchen', 'living', 'dining', 'laundry',
    'office', 'basement', 'garage', 'outdoor', 'entry', 'storage', 'other'
  )),
  name text not null,
  sort_order int not null default 0,
  -- Structured details, shape owned by the app:
  --   beds: [{ size: 'queen', count: 1 }], tv: '55in Roku',
  --   amenities: ['ceiling fan'], quirks: ['window sticks'], notes: '...'
  details jsonb not null default '{}'::jsonb,
  -- One-liner a guest could be told about this room (feeds the guest KB
  -- alongside guest_facing property notes).
  guest_summary text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists property_rooms_property_idx
  on property_rooms (property_id, sort_order);

create table if not exists property_onboarding_items (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  -- Join key into ONBOARDING_ITEMS in src/lib/onboarding-catalog.ts.
  -- Never rename catalog keys once shipped.
  item_key text not null,
  status text not null default 'todo' check (status in ('todo', 'done', 'n_a')),
  note text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  unique (property_id, item_key)
);

create index if not exists property_onboarding_items_property_idx
  on property_onboarding_items (property_id);

alter table property_rooms enable row level security;
alter table property_onboarding_items enable row level security;

revoke all on property_rooms from anon, authenticated;
revoke all on property_onboarding_items from anon, authenticated;

grant all on property_rooms to service_role;
grant all on property_onboarding_items to service_role;
