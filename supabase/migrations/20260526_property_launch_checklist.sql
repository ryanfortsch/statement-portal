-- Property launch checklist
--
-- When a prospect gets promoted into a property (projections.actions.ts >
-- promoteToProperty), the property row is created but every integration the
-- property needs to actually operate (Quo cleaner phone, Seam lock, Guesty
-- listing-match string, bank last4, listing copy, Airbnb live, etc.) is
-- still unwired. Until those land, statements ingest will miss the property,
-- turnover SMS won't attribute, and bank-side cleaning attribution breaks.
--
-- This table tracks the post-promotion launch checklist: one row per step
-- per property, with status + audit fields. The canonical step list lives in
-- src/lib/launch-checklist.ts (LAUNCH_STEPS) — the DB just persists state.
-- This mirrors the Quo / Seam pattern: code drives the schema of "what
-- counts," the table just stores facts and audit.

create table public.property_launch_steps (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  step_key text not null,
  status text not null default 'todo'
    check (status in ('todo','in_progress','done','skipped','n_a')),
  completed_at timestamptz,
  completed_by text,
  notes text,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, step_key)
);

create index idx_property_launch_steps_property_id
  on public.property_launch_steps(property_id);
create index idx_property_launch_steps_status
  on public.property_launch_steps(status);

alter table public.property_launch_steps enable row level security;
create policy "anyone can read property_launch_steps"
  on public.property_launch_steps for select using (true);
create policy "anyone can insert property_launch_steps"
  on public.property_launch_steps for insert with check (true);
create policy "anyone can update property_launch_steps"
  on public.property_launch_steps for update using (true);
create policy "anyone can delete property_launch_steps"
  on public.property_launch_steps for delete using (true);

create trigger property_launch_steps_updated_at
  before update on public.property_launch_steps
  for each row
  execute function public.update_updated_at_column();

-- Convenience view: per-property progress.
--
-- A step counts toward "done" if it's in any of done/skipped/n_a (the
-- operator made a decision about it). is_complete is true only when every
-- step has been resolved. The launch page uses this for the progress bar
-- and the /properties index uses it for the Launching badge.
create or replace view public.property_launch_progress as
select
  property_id,
  count(*) filter (where status in ('done','skipped','n_a')) as done_count,
  count(*) as total_count,
  bool_and(status in ('done','skipped','n_a')) as is_complete
from public.property_launch_steps
group by property_id;

comment on table public.property_launch_steps is
  'Per-property launch-checklist state. Canonical step list lives in src/lib/launch-checklist.ts; rows here are seeded on promoteToProperty.';
