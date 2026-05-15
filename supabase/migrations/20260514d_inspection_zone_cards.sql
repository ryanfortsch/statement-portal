-- Zone-aware inspection cards (Increment 2 of the property-aware inspection
-- rebuild). Builds on 20260514c_property_inspection_zones.sql by plumbing
-- zones through inspections and inspection_results so the deck for a fully
-- mapped property is a sequence of (zone, item) cards in walking order.
--
-- For unmapped properties everything continues to work via the legacy
-- ordered_item_ids column and the (inspection_id, item_id) shape of
-- inspection_results — the new column / constraint accommodate both.

-- ─── inspections: deck-of-cards column ─────────────────────────────────
-- An array of { itemId, zoneId? } objects in walking order. zoneId is
-- null for fallback decks generated from the template-wide sort_order
-- (i.e. properties without a zone mapping). ordered_item_ids is kept
-- for backward compatibility with any in-progress inspections that
-- started before this migration.
alter table public.inspections
  add column ordered_cards jsonb not null default '[]'::jsonb;

-- ─── inspection_results: per-zone scope ────────────────────────────────
alter table public.inspection_results
  add column property_zone_id uuid references public.property_zones(id) on delete set null;

create index idx_inspection_results_zone
  on public.inspection_results(property_zone_id);

-- The old constraint enforced one result per (inspection_id, item_id),
-- which collapses zone-expanded cards (e.g. three bathrooms reusing the
-- same template item). Replace it with a constraint that includes zone
-- so a single template item can record one result per zone in a single
-- inspection. NULLS NOT DISTINCT (PG 15+) lets NULL zones still trigger
-- conflicts, preserving the old semantics for unmapped inspections.
alter table public.inspection_results
  drop constraint inspection_results_inspection_id_item_id_key;

alter table public.inspection_results
  add constraint inspection_results_inspection_item_zone_unique
  unique nulls not distinct (inspection_id, item_id, property_zone_id);
