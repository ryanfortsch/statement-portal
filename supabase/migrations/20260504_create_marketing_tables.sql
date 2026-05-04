-- Marketing dashboard: ingest GA4 daily metrics + Vercel Speed Insights
-- for both Rising Tide STR sites (Stay Cape Ann, Rising Tide). A daily
-- cron at 5am UTC pulls d-1 from GA4 and a trailing-7-day p75 from
-- Vercel Speed Insights, upserting into the *_daily tables here.
--
-- The two GSC tables (top_queries, top_pages_search) from the original
-- spec are deferred for v1: GSC's UI rejects service-account emails and
-- the API has no Permissions endpoint, so the SA can't be granted GSC
-- access without a personal-OAuth-refresh-token workaround. We'll add
-- those tables (and their sync code) in a follow-up.
--
-- Idempotency: every daily table is keyed on (site_id, date) plus any
-- additional dimensions (page_path, source/medium, event_name). The
-- cron and backfill script overwrite same-key rows safely.

-- ─── Sites (dim) ──────────────────────────────────────────────────────
create table public.marketing_sites (
  id text primary key,
  name text not null,
  domain text not null,
  ga4_property_id text not null,
  gsc_url text,
  vercel_project_id text,
  created_at timestamptz not null default now()
);

alter table public.marketing_sites enable row level security;
create policy "anyone can read marketing_sites"  on public.marketing_sites for select using (true);
create policy "anyone can write marketing_sites" on public.marketing_sites for all    using (true) with check (true);

insert into public.marketing_sites (id, name, domain, ga4_property_id, gsc_url, vercel_project_id) values
  ('stay_cape_ann', 'Stay Cape Ann', 'staycapeann.com',   '536010800', 'https://staycapeann.com/',   'prj_FUW7B2zJRqnM7fURGEdroPWLgHmd'),
  ('rising_tide',   'Rising Tide',   'risingtidestr.com', '536011823', 'https://risingtidestr.com/', null);

-- ─── Traffic (one row per site/date) ─────────────────────────────────
create table public.marketing_traffic_daily (
  site_id text not null references public.marketing_sites(id) on delete cascade,
  date date not null,
  sessions integer not null default 0,
  users integer not null default 0,
  new_users integer not null default 0,
  page_views integer not null default 0,
  engagement_rate numeric,
  avg_session_duration_seconds numeric,
  bounce_rate numeric,
  updated_at timestamptz not null default now(),
  primary key (site_id, date)
);

create index idx_marketing_traffic_daily_date on public.marketing_traffic_daily(date desc);

alter table public.marketing_traffic_daily enable row level security;
create policy "anyone can read marketing_traffic_daily"  on public.marketing_traffic_daily for select using (true);
create policy "anyone can write marketing_traffic_daily" on public.marketing_traffic_daily for all    using (true) with check (true);

-- ─── Top pages by traffic (GA4) ──────────────────────────────────────
create table public.marketing_top_pages_daily (
  site_id text not null references public.marketing_sites(id) on delete cascade,
  date date not null,
  page_path text not null,
  page_views integer not null default 0,
  sessions integer not null default 0,
  users integer not null default 0,
  primary key (site_id, date, page_path)
);

create index idx_marketing_top_pages_daily on public.marketing_top_pages_daily(site_id, date desc, page_views desc);

alter table public.marketing_top_pages_daily enable row level security;
create policy "anyone can read marketing_top_pages_daily"  on public.marketing_top_pages_daily for select using (true);
create policy "anyone can write marketing_top_pages_daily" on public.marketing_top_pages_daily for all    using (true) with check (true);

-- ─── Top sources/medium (GA4) ────────────────────────────────────────
create table public.marketing_top_sources_daily (
  site_id text not null references public.marketing_sites(id) on delete cascade,
  date date not null,
  source text not null default '(direct)',
  medium text not null default '(none)',
  sessions integer not null default 0,
  users integer not null default 0,
  primary key (site_id, date, source, medium)
);

create index idx_marketing_top_sources_daily on public.marketing_top_sources_daily(site_id, date desc, sessions desc);

alter table public.marketing_top_sources_daily enable row level security;
create policy "anyone can read marketing_top_sources_daily"  on public.marketing_top_sources_daily for select using (true);
create policy "anyone can write marketing_top_sources_daily" on public.marketing_top_sources_daily for all    using (true) with check (true);

-- ─── Conversions (GA4 key events) ────────────────────────────────────
create table public.marketing_conversions_daily (
  site_id text not null references public.marketing_sites(id) on delete cascade,
  date date not null,
  event_name text not null,
  count integer not null default 0,
  primary key (site_id, date, event_name)
);

create index idx_marketing_conversions_daily on public.marketing_conversions_daily(site_id, date desc);

alter table public.marketing_conversions_daily enable row level security;
create policy "anyone can read marketing_conversions_daily"  on public.marketing_conversions_daily for select using (true);
create policy "anyone can write marketing_conversions_daily" on public.marketing_conversions_daily for all    using (true) with check (true);

-- ─── Speed Insights (Vercel) ─────────────────────────────────────────
-- Trailing 7-day p75 of Core Web Vitals per site, refreshed daily.
create table public.marketing_speed_insights_daily (
  site_id text not null references public.marketing_sites(id) on delete cascade,
  date date not null,
  lcp_p75_ms numeric,
  inp_p75_ms numeric,
  cls_p75 numeric,
  fcp_p75_ms numeric,
  ttfb_p75_ms numeric,
  sample_count integer,
  updated_at timestamptz not null default now(),
  primary key (site_id, date)
);

create index idx_marketing_speed_insights_daily_date on public.marketing_speed_insights_daily(date desc);

alter table public.marketing_speed_insights_daily enable row level security;
create policy "anyone can read marketing_speed_insights_daily"  on public.marketing_speed_insights_daily for select using (true);
create policy "anyone can write marketing_speed_insights_daily" on public.marketing_speed_insights_daily for all    using (true) with check (true);
