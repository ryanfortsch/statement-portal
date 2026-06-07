-- Landing pages for GA4 sessions where source/medium is "(not set)".
--
-- Drives the "where does the unknown traffic actually land" answer in
-- the /marketing dashboard. Lets the team see if (not set) traffic is
-- concentrated on one page (likely a specific outbound link missing
-- UTM tags) or spread across the site (in-app browser noise).
--
-- Schema mirrors marketing_top_pages_daily: one row per
-- (site_id, date, landing_page). The cron deletes + reinserts the day's
-- rows on each run so reruns stay idempotent.

create table public.marketing_unknown_landings_daily (
  site_id text not null references public.marketing_sites(id) on delete cascade,
  date date not null,
  landing_page text not null,
  sessions integer not null default 0,
  users integer not null default 0,
  primary key (site_id, date, landing_page)
);

create index idx_marketing_unknown_landings_daily
  on public.marketing_unknown_landings_daily(site_id, date desc, sessions desc);

alter table public.marketing_unknown_landings_daily enable row level security;
create policy "anyone can read marketing_unknown_landings_daily"
  on public.marketing_unknown_landings_daily for select using (true);
create policy "anyone can write marketing_unknown_landings_daily"
  on public.marketing_unknown_landings_daily for all    using (true) with check (true);
