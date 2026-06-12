-- Widen the market check to allow Beverly.
--
-- PR #584 added Beverly as a third option in the New Prospect form's
-- Market dropdown and as a third entry in AirDnaMarket / AIRDNA_MARKETS,
-- but I missed the corresponding DB-side CHECK constraint. Saving a
-- prospect with market = 'Beverly' on prod errors with:
--   new row for relation "projections" violates check constraint
--   "projections_market_check"
-- which Dotti hit after typing in a whole new prospect on 2026-06-12.
--
-- This drops the legacy two-value check and replaces it with one that
-- accepts the full AirDnaMarket union. If we ever extend the union
-- again (a real Beverly AirDNA dataset, or a new market), update the
-- form + AIRDNA + this constraint together.

alter table public.projections
  drop constraint if exists projections_market_check;

alter table public.projections
  add constraint projections_market_check
  check (market = any (array['Rockport'::text, 'Gloucester'::text, 'Beverly'::text]));
