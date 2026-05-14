-- Property-specific inspection zones (Increment 1 of the property-aware
-- inspection rebuild).
--
-- Models each property as a sequence of physical zones (rooms / areas) in
-- walking order, plus a many-to-many mapping of which template items get
-- checked in each zone. This lets a property like 30 Woodward expand a
-- single template item ("Bathroom Reset") into N cards for the N bathrooms,
-- and lets the inspector walk a sensible path (living room → main bedroom →
-- downstairs kitchen → upstairs) instead of running up and down stairs.
--
-- This migration only adds the data model. Deck generation continues to use
-- the template-wide sort_order until Increment 2 (which will plumb zones
-- through inspections.ordered_item_ids / inspection_results).
--
-- Relies on `update_updated_at_column()` from the properties migration.

-- ─── property_zones ───────────────────────────────────────────────────
create table public.property_zones (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  name text not null,
  floor_label text,
  walk_order integer not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- (property_id, walk_order) covers all zone-list queries
create index idx_property_zones_property
  on public.property_zones(property_id, walk_order);

alter table public.property_zones enable row level security;

create policy "anyone can read property_zones"
  on public.property_zones for select using (true);
create policy "anyone can insert property_zones"
  on public.property_zones for insert with check (true);
create policy "anyone can update property_zones"
  on public.property_zones for update using (true);
create policy "anyone can delete property_zones"
  on public.property_zones for delete using (true);

create trigger property_zones_updated_at
  before update on public.property_zones
  for each row
  execute function public.update_updated_at_column();

-- ─── property_zone_items ──────────────────────────────────────────────
-- Many-to-many: which template inspection_items get checked in each
-- zone. One template item can be assigned to multiple zones (e.g.
-- "Bathroom Reset" lives on upstairs bath + main bath + downstairs bath).
create table public.property_zone_items (
  id uuid primary key default gen_random_uuid(),
  property_zone_id uuid not null references public.property_zones(id) on delete cascade,
  inspection_item_id uuid not null references public.inspection_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (property_zone_id, inspection_item_id)
);

create index idx_property_zone_items_zone
  on public.property_zone_items(property_zone_id);
create index idx_property_zone_items_item
  on public.property_zone_items(inspection_item_id);

alter table public.property_zone_items enable row level security;

create policy "anyone can read property_zone_items"
  on public.property_zone_items for select using (true);
create policy "anyone can insert property_zone_items"
  on public.property_zone_items for insert with check (true);
create policy "anyone can delete property_zone_items"
  on public.property_zone_items for delete using (true);
