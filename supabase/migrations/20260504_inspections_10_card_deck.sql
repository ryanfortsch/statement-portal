-- Inspections: 10-card dynamic deck.
--
-- Mirrors Perfection's deck-generation model so each inspection presents
-- exactly 10 items per visit:
--   * 7 EVERY_TIME items (the must-do every walkthrough)
--   * 3 NICE_TO_HAVE items (rotated by priority + last-completed)
--   * Optionally 1 INTERMITTENT item (replaces a NICE_TO_HAVE slot when
--     DUE based on `interval_days` AND spacing of >=4 inspections since
--     the last intermittent on this property AND season constraint met)
--
-- This migration:
--   1. Adds the three new enums
--   2. Adds new columns to inspection_items + properties
--   3. Creates property_inspection_item_history (per-property tracker for
--      intermittent items)
--   4. Adds inspections.ordered_item_ids so the deck for an in-progress
--      inspection is sticky across page refreshes
--   5. Deactivates the existing 50-item Standard template (data preserved
--      so historical inspection_results remain queryable) and seeds a new
--      "Helm Core 12" template with 7 EVERY_TIME + 5 NICE_TO_HAVE items
--
-- Relies on `update_updated_at_column()` from the properties migration.

-- ─── Enums ─────────────────────────────────────────────────────────────
create type public.inspection_item_category as enum ('EVERY_TIME', 'INTERMITTENT', 'NICE_TO_HAVE');
create type public.season_constraint as enum ('ANY', 'ACTIVE_ONLY');
create type public.season_mode as enum ('ACTIVE', 'INACTIVE');

-- ─── Columns on inspection_items ───────────────────────────────────────
alter table public.inspection_items
  add column item_category public.inspection_item_category not null default 'EVERY_TIME',
  add column interval_days integer,
  add column priority integer,
  add column season_constraint public.season_constraint not null default 'ANY';

create index idx_inspection_items_category on public.inspection_items(template_id, item_category);

-- ─── Columns on properties ─────────────────────────────────────────────
alter table public.properties
  add column season_mode public.season_mode not null default 'ACTIVE',
  add column inspections_since_last_intermittent integer not null default 999;

-- ─── Columns on inspections ────────────────────────────────────────────
-- The deck (10 selected item ids in display order). Snapshotted at
-- startInspection time so refreshes during the walkthrough don't re-shuffle.
alter table public.inspections
  add column ordered_item_ids uuid[];

-- ─── Per-property item history ─────────────────────────────────────────
create table public.property_inspection_item_history (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  inspection_item_id uuid not null references public.inspection_items(id) on delete cascade,
  last_completed_at timestamptz not null default now(),
  last_inspection_id uuid references public.inspections(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, inspection_item_id)
);

create index idx_property_inspection_item_history_lookup
  on public.property_inspection_item_history(property_id, inspection_item_id);

alter table public.property_inspection_item_history enable row level security;

create policy "anyone can read property_inspection_item_history"
  on public.property_inspection_item_history for select using (true);
create policy "anyone can insert property_inspection_item_history"
  on public.property_inspection_item_history for insert with check (true);
create policy "anyone can update property_inspection_item_history"
  on public.property_inspection_item_history for update using (true);

create trigger property_inspection_item_history_updated_at
  before update on public.property_inspection_item_history
  for each row
  execute function public.update_updated_at_column();

-- ─── Deactivate existing 50-item template ─────────────────────────────
-- Data is preserved (existing inspection_results FKs intact). The deck
-- generator queries only is_active=true templates, so new inspections
-- pick up Helm Core 12 below.
update public.inspection_templates
   set is_active = false
 where name = 'Standard Vacation Rental Inspection';

-- ─── Seed: Helm Core 12 (7 EVERY_TIME + 5 NICE_TO_HAVE) ───────────────
-- Categorization is editable via Admin later. For v1 we picked the 7
-- items most clearly safety / first-impression critical as EVERY_TIME,
-- and 5 supporting items as NICE_TO_HAVE that rotate through (3 per
-- inspection by default). Add INTERMITTENT items via Admin when ready
-- (e.g. "Smoke detector battery test - quarterly").

insert into public.inspection_templates (id, name, is_active)
values ('00000000-0000-0000-0000-000000000002', 'Helm Core 12', true);

do $$
declare
  tid uuid := '00000000-0000-0000-0000-000000000002';
begin
  -- 7 EVERY_TIME items (always picked)
  insert into public.inspection_items (template_id, category, title, description, sort_order, item_category) values
    (tid, 'Entry',    'Approach + Entry Readiness',    'Confirm the arrival path is clear and safe. Entry door, lock, and first impression are guest-ready.', 1, 'EVERY_TIME'),
    (tid, 'Kitchen',  'Kitchen Surfaces + Sink',        'Counters, sink, and visible surfaces are clean, odor-free, and guest-ready.',                          2, 'EVERY_TIME'),
    (tid, 'Bathroom', 'Bathroom Reset (All Baths)',     'Toilets, sinks, mirrors, showers, and tubs appear clean. Towels are present and staged.',              3, 'EVERY_TIME'),
    (tid, 'Bathroom', 'Toiletries + Toilet Paper',      'Soap, shampoo, conditioner, body wash (if provided), and toilet paper are stocked and accessible.',     4, 'EVERY_TIME'),
    (tid, 'Bedroom',  'Beds + Linens Presentation',     'Beds are neatly made with clean linens. Pillows are staged. No visible hair or stains.',                5, 'EVERY_TIME'),
    (tid, 'Floors',   'Floors + Hidden Areas Scan',     'Floors are reasonably clean. Quick scan under beds and sofas for debris or left-behind items.',         6, 'EVERY_TIME'),
    (tid, 'Safety',   'Safety Quick Confirm',           'Smoke / CO detectors are present and not alarming. Fire extinguisher present where expected. No obvious safety hazards.', 7, 'EVERY_TIME');

  -- 5 NICE_TO_HAVE items (3 picked per inspection, rotated)
  insert into public.inspection_items (template_id, category, title, description, sort_order, item_category) values
    (tid, 'Outdoor',  'Outdoor Areas Reset',            'Outdoor furniture is clean, staged, and usable. No obvious hazards or messes in exterior guest areas.',  8, 'NICE_TO_HAVE'),
    (tid, 'Kitchen',  'Dishwasher + Cabinets',          'Dishwasher is empty and usable. Spot-check key cabinets for cleanliness and organization.',              9, 'NICE_TO_HAVE'),
    (tid, 'Kitchen',  'Core Kitchen Supplies',          'Confirm presence of trash bags, sponges, dish soap or dishwasher detergent, and paper towels.',          10, 'NICE_TO_HAVE'),
    (tid, 'Living',   'Living Room Function Check',     'TV powers on. Remote is present. Main lights function. Space feels guest-ready.',                        11, 'NICE_TO_HAVE'),
    (tid, 'Utility',  'Laundry / Utility Readiness',    'Washer and dryer are empty. Lint trap checked. Detergent present if stocked.',                           12, 'NICE_TO_HAVE');
end $$;
