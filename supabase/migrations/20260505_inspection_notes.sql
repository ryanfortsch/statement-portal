-- Inspection notes (Phase 3 of the Inspections module).
--
-- Two flavors of note now exist in Helm:
--
-- 1. Per-card scratch notes -- still live in inspection_results.notes.
--    These are tied to a specific status (Pass/Issue/N/A) and only
--    surface in the inspection summary's quote line.
--
-- 2. Inspection notes (this table) -- intentional standalone notes
--    captured via the Add Note modal. They have a note_type:
--      INSPECTION_NOTE: tied to this one inspection only
--      PROPERTY_NOTE  : pinned to the property folder; persists across
--                       inspections so the next inspector sees it on
--                       arrival ("Owner prefers thermostat at 68 in winter")
--
-- inspection_id is nullable so a property note can be added outside an
-- inspection in the future (e.g. directly from the property folder).
-- inspection_item_id is also nullable so a note can be attached to the
-- whole walk rather than a specific card.

create type public.inspection_note_type as enum ('INSPECTION_NOTE', 'PROPERTY_NOTE');

create table public.inspection_notes (
  id uuid primary key default gen_random_uuid(),

  -- Provenance (inspection + item are nullable for property notes added
  -- outside an inspection later)
  inspection_id uuid references public.inspections(id) on delete set null,
  property_id text not null references public.properties(id) on delete cascade,
  inspection_item_id uuid references public.inspection_items(id) on delete set null,

  -- Author identity (Google SSO email)
  author_email text not null,

  -- Content
  note_text text not null,
  note_type public.inspection_note_type not null default 'INSPECTION_NOTE',

  -- Lifecycle
  resolved_at timestamptz,
  resolved_by_email text,

  -- Future: photos
  photo_urls text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_inspection_notes_property on public.inspection_notes(property_id);
create index idx_inspection_notes_property_pinned
  on public.inspection_notes(property_id)
  where note_type = 'PROPERTY_NOTE' and resolved_at is null;
create index idx_inspection_notes_inspection on public.inspection_notes(inspection_id);

alter table public.inspection_notes enable row level security;

create policy "anyone can read inspection_notes"
  on public.inspection_notes for select using (true);
create policy "anyone can insert inspection_notes"
  on public.inspection_notes for insert with check (true);
create policy "anyone can update inspection_notes"
  on public.inspection_notes for update using (true);
create policy "anyone can delete inspection_notes"
  on public.inspection_notes for delete using (true);

create trigger inspection_notes_updated_at
  before update on public.inspection_notes
  for each row
  execute function public.update_updated_at_column();
