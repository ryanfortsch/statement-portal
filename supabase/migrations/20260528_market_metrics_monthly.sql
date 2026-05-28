-- Market metrics monthly (AirDNA)
--
-- One row per (market_slug, month) per source. Powers two surfaces:
--   1) Helm's /marketing/airdna entry UI (Dotti uploads AirDNA's monthly
--      "Market Metrics Monthly" CSV around the 15th of each month).
--   2) The public /api/markets/airdna/[slug] endpoint that rising-tide-str
--      hits to render the market snapshot cards + chart on
--      /markets/gloucester and /markets/rockport.
--
-- Until this table existed the data was hand-edited into
-- rising-tide-str/src/lib/townData.ts as flat arrays with hand-computed
-- KPI strings. Now the DB is the source of truth; the API computes
-- T3M, YoY, and the chart series on read.
--
-- AirDNA's export columns map 1:1 to the storage columns below. We accept
-- additional `source` values in the future (e.g. 'manual' for one-off
-- corrections), but today every row is source='airdna'.

create table public.market_metrics_monthly (
  id uuid primary key default gen_random_uuid(),
  market_slug text not null,
  month date not null,           -- always the first of the month
  active_listings int,
  occupancy_rate numeric(5,2),   -- percent, e.g. 49.60 means 49.6%
  avg_listing_revenue numeric(10,2), -- dollars, e.g. 2800.00
  source text not null default 'airdna',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_slug, month, source)
);

create index idx_market_metrics_monthly_market_month
  on public.market_metrics_monthly(market_slug, month desc);

alter table public.market_metrics_monthly enable row level security;

-- Public read so the marketing site (rising-tide-str) can fetch via the
-- public Helm API without a service-role key.
create policy "anyone can read market_metrics_monthly"
  on public.market_metrics_monthly for select using (true);

-- Writes go through service-role-only API routes in Helm.
create policy "service role can write market_metrics_monthly"
  on public.market_metrics_monthly for all
  using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');

-- Keep updated_at fresh on every modification.
create or replace function public.touch_market_metrics_monthly_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger trg_market_metrics_monthly_updated_at
  before update on public.market_metrics_monthly
  for each row execute function public.touch_market_metrics_monthly_updated_at();
