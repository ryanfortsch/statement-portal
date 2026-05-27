-- Enable Row-Level Security on the seven public tables that were created
-- without it. The Supabase advisor flagged them: with RLS disabled, the
-- PostgREST endpoint serves the table to any caller holding a valid project
-- URL even without a JWT, regardless of grants.
--
-- These tables hold the same kind of internal Helm data every other table
-- holds (competitor research, email triage, market benchmarks, property
-- notices, reservation notes), so the project's existing pattern applies
-- here too: enable RLS, add the four permissive "anyone can {action}
-- {table}" policies, and continue to gate access at the Auth.js / NextAuth
-- layer inside the app. Service-role writes from API routes bypass these
-- policies as they do everywhere else.
--
-- Idempotent: drop-then-create on the policies so re-running this file is
-- safe if a tooling retry replays it.

-- Helper-free: just repeat the pattern per table. Tables alphabetised
-- inside their feature group.

------------------------------------------------------------------------
-- Competitors module: market research on other Cape Ann managers.
------------------------------------------------------------------------

alter table public.competitor_listing_events enable row level security;
drop policy if exists "anyone can read competitor_listing_events" on public.competitor_listing_events;
drop policy if exists "anyone can insert competitor_listing_events" on public.competitor_listing_events;
drop policy if exists "anyone can update competitor_listing_events" on public.competitor_listing_events;
drop policy if exists "anyone can delete competitor_listing_events" on public.competitor_listing_events;
create policy "anyone can read competitor_listing_events"   on public.competitor_listing_events for select using (true);
create policy "anyone can insert competitor_listing_events" on public.competitor_listing_events for insert with check (true);
create policy "anyone can update competitor_listing_events" on public.competitor_listing_events for update using (true);
create policy "anyone can delete competitor_listing_events" on public.competitor_listing_events for delete using (true);

alter table public.competitor_listing_overrides enable row level security;
drop policy if exists "anyone can read competitor_listing_overrides" on public.competitor_listing_overrides;
drop policy if exists "anyone can insert competitor_listing_overrides" on public.competitor_listing_overrides;
drop policy if exists "anyone can update competitor_listing_overrides" on public.competitor_listing_overrides;
drop policy if exists "anyone can delete competitor_listing_overrides" on public.competitor_listing_overrides;
create policy "anyone can read competitor_listing_overrides"   on public.competitor_listing_overrides for select using (true);
create policy "anyone can insert competitor_listing_overrides" on public.competitor_listing_overrides for insert with check (true);
create policy "anyone can update competitor_listing_overrides" on public.competitor_listing_overrides for update using (true);
create policy "anyone can delete competitor_listing_overrides" on public.competitor_listing_overrides for delete using (true);

alter table public.competitor_listings_current enable row level security;
drop policy if exists "anyone can read competitor_listings_current" on public.competitor_listings_current;
drop policy if exists "anyone can insert competitor_listings_current" on public.competitor_listings_current;
drop policy if exists "anyone can update competitor_listings_current" on public.competitor_listings_current;
drop policy if exists "anyone can delete competitor_listings_current" on public.competitor_listings_current;
create policy "anyone can read competitor_listings_current"   on public.competitor_listings_current for select using (true);
create policy "anyone can insert competitor_listings_current" on public.competitor_listings_current for insert with check (true);
create policy "anyone can update competitor_listings_current" on public.competitor_listings_current for update using (true);
create policy "anyone can delete competitor_listings_current" on public.competitor_listings_current for delete using (true);

------------------------------------------------------------------------
-- Inbox / triage: AI-classified email inbox for the team.
------------------------------------------------------------------------

alter table public.email_triage enable row level security;
drop policy if exists "anyone can read email_triage" on public.email_triage;
drop policy if exists "anyone can insert email_triage" on public.email_triage;
drop policy if exists "anyone can update email_triage" on public.email_triage;
drop policy if exists "anyone can delete email_triage" on public.email_triage;
create policy "anyone can read email_triage"   on public.email_triage for select using (true);
create policy "anyone can insert email_triage" on public.email_triage for insert with check (true);
create policy "anyone can update email_triage" on public.email_triage for update using (true);
create policy "anyone can delete email_triage" on public.email_triage for delete using (true);

------------------------------------------------------------------------
-- Market data: benchmark revenue figures used by Forecast / Revenue.
------------------------------------------------------------------------

alter table public.market_revenue_benchmarks enable row level security;
drop policy if exists "anyone can read market_revenue_benchmarks" on public.market_revenue_benchmarks;
drop policy if exists "anyone can insert market_revenue_benchmarks" on public.market_revenue_benchmarks;
drop policy if exists "anyone can update market_revenue_benchmarks" on public.market_revenue_benchmarks;
drop policy if exists "anyone can delete market_revenue_benchmarks" on public.market_revenue_benchmarks;
create policy "anyone can read market_revenue_benchmarks"   on public.market_revenue_benchmarks for select using (true);
create policy "anyone can insert market_revenue_benchmarks" on public.market_revenue_benchmarks for insert with check (true);
create policy "anyone can update market_revenue_benchmarks" on public.market_revenue_benchmarks for update using (true);
create policy "anyone can delete market_revenue_benchmarks" on public.market_revenue_benchmarks for delete using (true);

------------------------------------------------------------------------
-- Property surfaces: notices on the property page + per-reservation notes.
------------------------------------------------------------------------

alter table public.property_notices enable row level security;
drop policy if exists "anyone can read property_notices" on public.property_notices;
drop policy if exists "anyone can insert property_notices" on public.property_notices;
drop policy if exists "anyone can update property_notices" on public.property_notices;
drop policy if exists "anyone can delete property_notices" on public.property_notices;
create policy "anyone can read property_notices"   on public.property_notices for select using (true);
create policy "anyone can insert property_notices" on public.property_notices for insert with check (true);
create policy "anyone can update property_notices" on public.property_notices for update using (true);
create policy "anyone can delete property_notices" on public.property_notices for delete using (true);

alter table public.reservation_notes enable row level security;
drop policy if exists "anyone can read reservation_notes" on public.reservation_notes;
drop policy if exists "anyone can insert reservation_notes" on public.reservation_notes;
drop policy if exists "anyone can update reservation_notes" on public.reservation_notes;
drop policy if exists "anyone can delete reservation_notes" on public.reservation_notes;
create policy "anyone can read reservation_notes"   on public.reservation_notes for select using (true);
create policy "anyone can insert reservation_notes" on public.reservation_notes for insert with check (true);
create policy "anyone can update reservation_notes" on public.reservation_notes for update using (true);
create policy "anyone can delete reservation_notes" on public.reservation_notes for delete using (true);
