-- ============================================================================
-- 65 Calderwood: clear the activation stamp so Revenue shows its whole year.
--
-- One-shot data, no DDL. 20260926210000_calderwood_registry.sql inserted the
-- row with activated_at = now() (2026-09-28 when applied). Revenue drops every
-- checkout before a home's activation date, so the page read "No bookings in
-- range" for April through September 2026 while guesty_reservations held
-- 27 confirmed stays and about $57.5k across those months; only October on
-- showed. The home has been Rising Tide's and live on Guesty all along, so
-- there is no go-live date to respect. Null is what every pre-registry home
-- carries, and Revenue then counts back to the data horizon.
--
-- The launch checklist's activate gate still reads true (a first stay has
-- started), and the forecast excludes Rising Tide-owned homes, so nothing
-- else moves. Dotti asked for it on 2026-11-08.
-- ============================================================================

update public.properties
   set activated_at = null
 where id = '65_calderwood'
   and activated_at is not null;
