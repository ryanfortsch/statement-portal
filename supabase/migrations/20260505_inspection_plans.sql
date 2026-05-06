-- Inspection plans: schedule a future inspection for a specific Guesty
-- reservation. Surfaces on Operations next to each upcoming check-in so the
-- operator can decide WHEN to inspect a turnover before the inspector
-- actually walks the property.
--
-- Helm-native simplification of Perfection's inspection_plans table:
--   * property_id is TEXT (Helm convention, e.g. "21_horton")
--   * No deadline math, no inspector_capacity table -- those felt like
--     premature optimization. Plan is just "we intend to inspect on date X"
--   * No plan_status enum -- the read side derives state ("upcoming" /
--     "today" / "overdue") from planned_for_date vs now
--   * inspection_id is nullable; set when the planned inspection actually
--     starts so we can link the plan to the result without losing it
--
-- One plan per Guesty reservation (unique constraint).

create table public.inspection_plans (
  id uuid primary key default gen_random_uuid(),

  -- What we're planning to inspect
  guesty_reservation_id text not null unique,
  property_id text not null references public.properties(id) on delete cascade,

  -- Reservation context (denormalized so the read side doesn't need to
  -- re-join guesty_reservations every render)
  checkin_date date not null,
  checkout_date date not null,

  -- The plan
  planned_for_date date,
  notes text,

  -- Audit
  planned_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Link to the actual inspection once it kicks off (nullable; set by
  -- startInspection when an inspection lands on a property/date that has
  -- a plan)
  inspection_id uuid references public.inspections(id) on delete set null
);

create index idx_inspection_plans_property on public.inspection_plans(property_id);
create index idx_inspection_plans_planned_for on public.inspection_plans(planned_for_date);
create index idx_inspection_plans_checkin on public.inspection_plans(checkin_date);

alter table public.inspection_plans enable row level security;

create policy "anyone can read inspection_plans"
  on public.inspection_plans for select using (true);
create policy "anyone can insert inspection_plans"
  on public.inspection_plans for insert with check (true);
create policy "anyone can update inspection_plans"
  on public.inspection_plans for update using (true);
create policy "anyone can delete inspection_plans"
  on public.inspection_plans for delete using (true);

create trigger inspection_plans_updated_at
  before update on public.inspection_plans
  for each row
  execute function public.update_updated_at_column();
