-- Patch: enable anon SELECT on bank_deposit_attributions.
--
-- The original migration created the table with Supabase's default RLS
-- (enabled, no policies). That silently blocks the client-side
-- BankDepositReview component on /statements -- it queries with the anon
-- key, gets back an empty array, and renders nothing. Result: the
-- pending review queue (e.g. Margaret Bucci's $200 Airbnb pet fee at
-- 17 Beach) never appears even though the rows exist.
--
-- Fix: add a permissive SELECT policy for anon, matching the posture of
-- property_statements / reservations / cleaning_events. Helm's auth
-- lives in the app middleware (not the DB layer). Writes still go
-- through server API routes using the service-role key, so this only
-- exposes read access.
--
-- Run in the Supabase SQL editor at:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new

ALTER TABLE bank_deposit_attributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_deposit_attributions_anon_select ON bank_deposit_attributions;
CREATE POLICY bank_deposit_attributions_anon_select
  ON bank_deposit_attributions
  FOR SELECT
  TO anon
  USING (true);

-- Also allow `authenticated` so SSR fetches with the user's session work.
DROP POLICY IF EXISTS bank_deposit_attributions_auth_select ON bank_deposit_attributions;
CREATE POLICY bank_deposit_attributions_auth_select
  ON bank_deposit_attributions
  FOR SELECT
  TO authenticated
  USING (true);
