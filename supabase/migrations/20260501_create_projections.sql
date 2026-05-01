-- Helm-native projections schema.
--
-- The Projections module (Helm 06) lets us produce a prospect-facing revenue
-- estimate deck. Each row stores the inputs of one prospect's analysis; the
-- compute layer (src/lib/projections-model.ts) derives every number on the
-- deliverable from those inputs at render time, so a stored projection is
-- always rerunnable as we tune the model. AirDNA market history lives in
-- src/lib/projections-airdna.ts, not the DB.
--
-- Independent of public.properties: a projection is for a *prospect*, not a
-- property we already manage. Prospects are stored as text fields (address,
-- name) directly on the projection.
--
-- Reuses public.update_updated_at_column() from the properties migration.

create table public.projections (
  id uuid primary key default gen_random_uuid(),

  -- Author (sourced from Google SSO session)
  created_by_email text not null,
  created_by_name text not null,

  -- Prospect + property
  prospect_name text not null,           -- "John Gavin, Bethany Giblin"
  prospect_first_name text,              -- "John" — used in the hero "...NET PAYOUTS TO JOHN"
  property_address text not null,        -- "36 Granite St"
  property_city text,                    -- "Rockport, MA"
  market text not null check (market in ('Rockport', 'Gloucester')),
  bedrooms integer not null check (bedrooms between 1 and 6),
  home_value numeric not null,           -- Zillow-equivalent
  neighborhood text,                     -- e.g. "Back Beach"
  interior_grade text,                   -- A / B / C, free text

  -- Expense + growth assumptions (defaults match Rising Tide STR's standard model)
  mgmt_fee_pct numeric not null default 0.25,
  base_cleaning numeric not null default 200,
  addl_cleaning_per_br numeric not null default 50,
  turnovers_per_year integer not null default 45,
  year2_growth_pct numeric not null default 0.15,

  -- Optional gross-revenue overrides (Inputs!C15/C16): bypass the blended model
  revenue_override_low numeric,
  revenue_override_high numeric,

  -- Optional cover-page hero range overrides (when the analyst wants to tell a
  -- specific Year 1 → Year 2 story rather than the model's Low/High)
  hero_low_override numeric,
  hero_high_override numeric,

  -- Year 1 ramp: month (1-12) the property goes live. Months before this = $0;
  -- ramp curve is +0.2x, +0.5x, then full from then on (matches the existing
  -- spreadsheet's manual ramp).
  start_month integer not null default 5 check (start_month between 1 and 12),

  -- Cover-page "month year" (e.g. 2026-03 → "MARCH 2026")
  presentation_month text not null,

  -- Lifecycle
  status text not null default 'draft' check (status in ('draft', 'sent')),
  sent_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_projections_created on public.projections(created_at desc);
create index idx_projections_status on public.projections(status);

create trigger projections_updated_at
  before update on public.projections
  for each row
  execute function public.update_updated_at_column();

-- ─── RLS: permissive for now (matches inspections/properties pattern) ─────
alter table public.projections enable row level security;

create policy "anyone can read projections"
  on public.projections for select using (true);
create policy "anyone can insert projections"
  on public.projections for insert with check (true);
create policy "anyone can update projections"
  on public.projections for update using (true);
create policy "anyone can delete projections"
  on public.projections for delete using (true);
