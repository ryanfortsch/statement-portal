-- Market Context for property pages.
--
-- Owners (and Dotti, prepping for an owner call) sometimes need a quick
-- "did this property beat the market?" check. We have AirDNA monthly revenue
-- data by bedroom count for Gloucester, Rockport, and Beverly going back
-- to 2018. The Property page renders the trailing 3-year same-month average
-- as an "implied owner payout" alongside actual payouts, so the comparison
-- is glanceable without anyone running the math.
--
-- Two pieces:
--   1) properties.market — which AirDNA city to comp against
--   2) market_revenue_benchmarks — the AirDNA observations themselves
--
-- See 20260506d_seed_market_benchmarks.sql for the actual data load.

-- ---------------------------------------------------------------------------
-- 1) Add a `market` column to properties so a property declares which AirDNA
--    market it should be benchmarked against. Mostly mirrors the city, but
--    decoupled so we can override (e.g. comp a Magnolia property to
--    Gloucester) without parsing strings at read time.
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists market text;

comment on column public.properties.market is
  'AirDNA market key for revenue benchmarking. One of: gloucester, rockport, beverly. NULL means no benchmark available.';

-- Backfill bedroom counts for the existing hand-seeded properties. The
-- bedrooms column was added in 20260503_properties_operational.sql for
-- the onboarding pipeline but the legacy properties were never populated.
-- Source of truth: stay-cape-ann/data/guesty-snapshot.json cross-referenced
-- against ical-urls.json (verified 2026-05-06).
--
-- 73 Rocky Neck flagged: stay-cape-ann lists it as 2BR but sleeps 7. That
-- ratio is unusual for a 2BR — likely has pullouts/daybeds boosting the
-- sleep count. Holding the 2BR comp until Ryan/Allie confirm; if it's
-- closer to 3BR usage in practice, update here and the comp will shift
-- from $1,772 implied payout to $2,354 (Apr 3yr avg).
update public.properties set bedrooms = 3, market = 'rockport'
  where id = '3_south_st' and (bedrooms is null or market is null);
update public.properties set bedrooms = 3, market = 'gloucester'
  where id = '21_horton' and (bedrooms is null or market is null);
update public.properties set bedrooms = 3, market = 'gloucester'
  where id = '53_rocky_neck' and (bedrooms is null or market is null);
update public.properties set bedrooms = 5, market = 'gloucester'
  where id = '4_brier_neck' and (bedrooms is null or market is null);
update public.properties set bedrooms = 4, market = 'gloucester'
  where id = '30_woodward' and (bedrooms is null or market is null);
update public.properties set bedrooms = 4, market = 'gloucester'
  where id = '20_hammond' and (bedrooms is null or market is null);
update public.properties set bedrooms = 3, market = 'beverly'
  where id = '20_enon' and (bedrooms is null or market is null);
update public.properties set bedrooms = 2, market = 'gloucester'
  where id = '73_rocky_neck' and (bedrooms is null or market is null);
update public.properties set bedrooms = 6, market = 'gloucester'
  where id = '17_beach_rd' and (bedrooms is null or market is null);
update public.properties set bedrooms = 3, market = 'gloucester'
  where id = '3_locust' and (bedrooms is null or market is null);

-- ---------------------------------------------------------------------------
-- 2) The benchmarks table itself.
--
-- One row per (market, bedrooms, year, month, source). bedrooms = 6
-- represents the AirDNA "6+" bucket so 17 Beach (6BR) gets a comp instead
-- of a NULL. avg_revenue is the AirDNA-reported average gross rental
-- revenue for that bedroom-count cohort in that market that month.
--
-- NULL avg_revenue is allowed for absent observations (some months/buckets
-- in the source CSVs are empty when AirDNA had insufficient sample size).
-- The seed migration only inserts rows where avg_revenue is present.
-- ---------------------------------------------------------------------------
create table if not exists public.market_revenue_benchmarks (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('gloucester', 'rockport', 'beverly')),
  bedrooms integer not null check (bedrooms between 1 and 6),
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  avg_revenue numeric(10, 2) not null,
  source text not null default 'airdna',
  imported_at timestamptz not null default now(),
  unique (market, bedrooms, year, month, source)
);

comment on table public.market_revenue_benchmarks is
  'AirDNA monthly average revenue by bedroom count, used by the Property page Market Context tile to compare actual owner payouts against a comparable-market benchmark.';

comment on column public.market_revenue_benchmarks.bedrooms is
  '1-5 are exact bedroom counts. 6 represents the AirDNA "6+" bucket.';

create index if not exists market_benchmarks_lookup_idx
  on public.market_revenue_benchmarks (market, bedrooms, month, year desc);
