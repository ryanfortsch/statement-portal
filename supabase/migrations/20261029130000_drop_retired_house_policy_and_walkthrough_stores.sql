-- Drop the stores retired on 2026-10-18, one release later.
--
-- House policy is one store (src/lib/house-policy.ts): the nine House policy
-- columns on properties. The rate plan, the listing record and the climate
-- profile each carried a copy; 20261018160000_house_policy_one_store.sql
-- backfilled properties from them and nothing has read or written them since
-- (every loader overlays properties, every form edits properties). The
-- outfitting walkthrough is one table, home_walkthroughs
-- (20261018210000_home_walkthroughs.sql carried the rows over); its two old
-- stores were read only as a fallback for a home with no row. Launch rows
-- have had three statuses since 20261018220000_launch_status_three.sql; the
-- check constraint kept all five for the skew window.
--
-- Apply after the companion code is live: the previous deployment still
-- selects the plan and listing columns by name.
-- No new table, so no grant is needed.
begin;
set local lock_timeout = '5s';

alter table public.property_rate_plans
  drop column if exists checkout_time,
  drop column if exists max_occupancy,
  drop column if exists pets_allowed,
  drop column if exists quiet_hours,
  drop column if exists cancellation_policy_key,
  drop column if exists cancellation_terms,
  drop column if exists house_rules;

alter table public.property_listing_content
  drop column if exists house_rules,
  drop column if exists accommodates;

alter table public.property_climate_profiles
  drop column if exists checkin_hour,
  drop column if exists checkout_hour;

alter table public.projections drop column if exists readiness_state;
drop table if exists public.property_order_checklist;

-- Any row a stale tab wrote in the skew window reads the way the 10/18
-- migration read it, then the constraint allows only the three.
update public.property_launch_steps set status = 'todo' where status = 'in_progress';
update public.property_launch_steps set status = 'n_a' where status = 'skipped';
alter table public.property_launch_steps drop constraint if exists property_launch_steps_status_check;
alter table public.property_launch_steps
  add constraint property_launch_steps_status_check check (status in ('todo', 'done', 'n_a'));

commit;
