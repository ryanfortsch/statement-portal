-- Market occupancy by bedroom count, monthly (AirDNA)
--
-- AirDNA's "occupancyBedrooms" export is one row per month with a
-- column per bedroom-bucket (1, 2, 3, 4, 5, 6+). That's a different
-- shape than market_metrics_monthly (which is one row per month with
-- the headline metrics). Storing them in a separate table keeps the
-- existing schema unchanged while letting Dotti upload the new export.
--
-- One row per (market_slug, month, bedrooms). bedrooms is a small
-- bucket label so we keep "6+" as a literal string instead of
-- collapsing to 6.
--
-- The current /marketing/airdna and the public market pages don't
-- render bedroom-level occupancy yet. The table is here so the data
-- is captured the first time the CSV comes in; rendering is follow-up
-- work that doesn't have to block the ingest.

create table public.market_occupancy_by_bedroom_monthly (
  id uuid primary key default gen_random_uuid(),
  market_slug text not null,
  month date not null,                -- always the first of the month
  bedrooms text not null,             -- '1', '2', '3', '4', '5', '6+'
  occupancy_rate numeric(5,2),        -- percent, e.g. 49.60
  source text not null default 'airdna',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_slug, month, bedrooms, source)
);

create index idx_market_occupancy_by_bedroom_monthly_lookup
  on public.market_occupancy_by_bedroom_monthly(market_slug, month desc, bedrooms);

alter table public.market_occupancy_by_bedroom_monthly enable row level security;

create policy "anyone can read market_occupancy_by_bedroom_monthly"
  on public.market_occupancy_by_bedroom_monthly for select using (true);

create policy "service role can write market_occupancy_by_bedroom_monthly"
  on public.market_occupancy_by_bedroom_monthly for all
  using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');

create or replace function public.touch_market_occupancy_by_bedroom_monthly_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger trg_market_occupancy_by_bedroom_monthly_updated_at
  before update on public.market_occupancy_by_bedroom_monthly
  for each row
  execute function public.touch_market_occupancy_by_bedroom_monthly_updated_at();
