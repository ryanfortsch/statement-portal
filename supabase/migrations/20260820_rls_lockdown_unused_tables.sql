-- Lock down 13 tables whose permissive anon policies serve NO code path:
-- the 2026-08-20 sweep of all 65 anon-reachable tables found these are
-- either never referenced anywhere in src/ (comms, inspection_templates,
-- market_revenue_benchmarks, owners, property_zone_items,
-- statement_uploads) or referenced exclusively through the service-role
-- client (inspection_notes, inspection_results, lock_battery_status,
-- lock_devices, market_occupancy_by_bedroom_monthly,
-- property_inspection_item_history, property_zones). Sibling repos
-- (stay-cape-ann, rising-tide-str, stay-concierge) re-confirmed to have
-- zero Supabase dependency, and no PostgREST embedded-join (`table(...)`
-- inside a .select string) reaches any of these, so revoking anon cannot
-- break anything -- there is no Stage 1 code move to do.
--
-- Highest-value closures in this batch: `owners` (owner names/contact
-- rows, full anon read/write/delete), `statement_uploads` (statement
-- ingest bookkeeping, anon-deletable), and the smart-lock registry
-- (`lock_devices` / `lock_battery_status`, anon-writable device-to-
-- property mapping that feeds the turnover "bring batteries" pipeline).
--
-- Note: "service role can write market_occupancy_by_bedroom_monthly" is
-- dropped too -- despite its name it was bound to the public role set,
-- and service_role bypasses RLS entirely, so the only thing it ever
-- granted was anon write access.
--
-- Same idiom as 20260710_properties_rls_lockdown.sql /
-- 20260710b_projections_rls_lockdown.sql: drop every anon-facing policy,
-- revoke table grants from anon + authenticated (authenticated is
-- confirmed unused -- Helm never calls supabase.auth.*), keep
-- service_role whole. Remaining anon-reachable tables (52) each need a
-- Stage-1 code migration off the anon client before their revoke.

drop policy if exists "anyone can read comms" on public.comms;
drop policy if exists "anyone can insert comms" on public.comms;
drop policy if exists "anyone can update comms" on public.comms;
drop policy if exists "anyone can delete comms" on public.comms;

drop policy if exists "anyone can read inspection_templates" on public.inspection_templates;

drop policy if exists "anyone can read market_revenue_benchmarks" on public.market_revenue_benchmarks;
drop policy if exists "anyone can insert market_revenue_benchmarks" on public.market_revenue_benchmarks;
drop policy if exists "anyone can update market_revenue_benchmarks" on public.market_revenue_benchmarks;
drop policy if exists "anyone can delete market_revenue_benchmarks" on public.market_revenue_benchmarks;

drop policy if exists "anyone can read owners" on public.owners;
drop policy if exists "anyone can insert owners" on public.owners;
drop policy if exists "anyone can update owners" on public.owners;
drop policy if exists "anyone can delete owners" on public.owners;

drop policy if exists "anyone can read property_zone_items" on public.property_zone_items;
drop policy if exists "anyone can insert property_zone_items" on public.property_zone_items;
drop policy if exists "anyone can delete property_zone_items" on public.property_zone_items;

drop policy if exists "Allow read access" on public.statement_uploads;
drop policy if exists "Allow insert" on public.statement_uploads;
drop policy if exists "Allow delete" on public.statement_uploads;

drop policy if exists "anyone can read inspection_notes" on public.inspection_notes;
drop policy if exists "anyone can insert inspection_notes" on public.inspection_notes;
drop policy if exists "anyone can update inspection_notes" on public.inspection_notes;
drop policy if exists "anyone can delete inspection_notes" on public.inspection_notes;

drop policy if exists "anyone can read inspection_results" on public.inspection_results;
drop policy if exists "anyone can insert inspection_results" on public.inspection_results;
drop policy if exists "anyone can update inspection_results" on public.inspection_results;

drop policy if exists "anyone can read lock_battery_status" on public.lock_battery_status;
drop policy if exists "anyone can insert lock_battery_status" on public.lock_battery_status;
drop policy if exists "anyone can update lock_battery_status" on public.lock_battery_status;
drop policy if exists "anyone can delete lock_battery_status" on public.lock_battery_status;

drop policy if exists "anyone can read lock_devices" on public.lock_devices;
drop policy if exists "anyone can insert lock_devices" on public.lock_devices;
drop policy if exists "anyone can update lock_devices" on public.lock_devices;
drop policy if exists "anyone can delete lock_devices" on public.lock_devices;

drop policy if exists "anyone can read market_occupancy_by_bedroom_monthly" on public.market_occupancy_by_bedroom_monthly;
drop policy if exists "service role can write market_occupancy_by_bedroom_monthly" on public.market_occupancy_by_bedroom_monthly;

drop policy if exists "anyone can read property_inspection_item_history" on public.property_inspection_item_history;
drop policy if exists "anyone can insert property_inspection_item_history" on public.property_inspection_item_history;
drop policy if exists "anyone can update property_inspection_item_history" on public.property_inspection_item_history;

drop policy if exists "anyone can read property_zones" on public.property_zones;
drop policy if exists "anyone can insert property_zones" on public.property_zones;
drop policy if exists "anyone can update property_zones" on public.property_zones;
drop policy if exists "anyone can delete property_zones" on public.property_zones;

revoke all on public.comms from anon, authenticated;
revoke all on public.inspection_templates from anon, authenticated;
revoke all on public.market_revenue_benchmarks from anon, authenticated;
revoke all on public.owners from anon, authenticated;
revoke all on public.property_zone_items from anon, authenticated;
revoke all on public.statement_uploads from anon, authenticated;
revoke all on public.inspection_notes from anon, authenticated;
revoke all on public.inspection_results from anon, authenticated;
revoke all on public.lock_battery_status from anon, authenticated;
revoke all on public.lock_devices from anon, authenticated;
revoke all on public.market_occupancy_by_bedroom_monthly from anon, authenticated;
revoke all on public.property_inspection_item_history from anon, authenticated;
revoke all on public.property_zones from anon, authenticated;

grant all on public.comms to service_role;
grant all on public.inspection_templates to service_role;
grant all on public.market_revenue_benchmarks to service_role;
grant all on public.owners to service_role;
grant all on public.property_zone_items to service_role;
grant all on public.statement_uploads to service_role;
grant all on public.inspection_notes to service_role;
grant all on public.inspection_results to service_role;
grant all on public.lock_battery_status to service_role;
grant all on public.lock_devices to service_role;
grant all on public.market_occupancy_by_bedroom_monthly to service_role;
grant all on public.property_inspection_item_history to service_role;
grant all on public.property_zones to service_role;
