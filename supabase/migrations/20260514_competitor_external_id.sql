-- Stable external id per competitor listing.
--
-- Listing slugs and URLs change whenever a manager edits a title — Hospitable
-- rebuilds the URL slug from the new marketing copy, and AVH occasionally
-- renames units too. URL-based diff sees those as drop+add of the same
-- physical property, churning the events feed and losing history.
--
-- Both competitors expose a stable underlying ID per listing in their
-- public HTML:
--   AVH       — the numeric segment between underscores and "-15" in
--               /vrp/unit/<Title>-<id>-15 (this is AVH's unit id in their
--               PMS account 15, stable across title changes).
--   Shoreway  — the numeric id in property_images/<id>/... on each card
--               (this is Hospitable's internal listing id, stable across
--               slug renames).
--
-- We add external_id alongside listing_slug so the sync diff can prefer it.
-- Slug + url are still captured so the events feed can show the human-
-- readable rename history.

alter table public.competitor_listings_current
  add column if not exists external_id text;

create index if not exists clc_competitor_external_id_idx
  on public.competitor_listings_current(competitor_id, external_id)
  where external_id is not null;

alter table public.competitor_listing_events
  add column if not exists external_id text;

-- Allow a new 'renamed' event for the case where external_id matches an
-- existing row but slug or url changed.
alter table public.competitor_listing_events
  drop constraint if exists competitor_listing_events_event_type_check;
alter table public.competitor_listing_events
  add constraint competitor_listing_events_event_type_check
  check (event_type in ('added', 'dropped', 'returned', 'changed', 'renamed'));
