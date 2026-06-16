-- Per-property inspection card layout (rebuild).
--
-- Replaces the zone model (property_zones / property_zone_items + the AI
-- prose-to-zones parser), which proved fiddly and ballooned the card count.
-- The new model is WYSIWYG: each property owns an explicit, ordered list of
-- inspection cards. What the operator lays out here is exactly what the
-- inspection runs, in that order, every visit. No rotation, no zone fan-out.
--
-- Why this stays cheap downstream: the inspection workflow already runs off
-- inspections.ordered_cards (a snapshot taken at Start), and every result /
-- note / work-slip keys on inspection_items.id. A card just points at a real
-- inspection_items row, so custom cards flow through the whole pipeline
-- (Stepper, results, summary, emailed report) with no further changes.
--
-- The zone tables are intentionally left in place (non-destructive) so any
-- historical zone-mapped inspection still renders. New inspections never
-- write a zone again.
--
-- Relies on update_updated_at_column() from the properties migration.

-- ─── Custom, property-scoped inspection items ──────────────────────────
-- property_id NULL  = a shared "standard" card, available to every property
--                     (the seeded Helm Core items keep property_id NULL).
-- property_id SET   = a custom card the operator wrote for that one property.
alter table public.inspection_items
  add column property_id text references public.properties(id) on delete cascade;

create index idx_inspection_items_property on public.inspection_items(property_id);

-- ─── property_inspection_cards: the per-property ordered deck ───────────
-- One row per card in this property's inspection. `position` is the walk
-- order. inspection_item_id references a real item (standard or custom).
create table public.property_inspection_cards (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  inspection_item_id uuid not null references public.inspection_items(id) on delete cascade,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, inspection_item_id)
);

create index idx_property_inspection_cards_property
  on public.property_inspection_cards(property_id, position);

alter table public.property_inspection_cards enable row level security;

create policy "anyone can read property_inspection_cards"
  on public.property_inspection_cards for select using (true);
create policy "anyone can insert property_inspection_cards"
  on public.property_inspection_cards for insert with check (true);
create policy "anyone can update property_inspection_cards"
  on public.property_inspection_cards for update using (true);
create policy "anyone can delete property_inspection_cards"
  on public.property_inspection_cards for delete using (true);

create trigger property_inspection_cards_updated_at
  before update on public.property_inspection_cards
  for each row
  execute function public.update_updated_at_column();
