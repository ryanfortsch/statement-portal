-- Tag each cleaning_events row with the vendor that produced the charge.
--
-- Why: as of May 2026, linens moved off Cape Ann Elite (who used to bundle
-- cleaning + linens into one all-in invoice) onto a new vendor, Nor'East
-- Cleaners. Both costs still fold into the owner statement's single
-- "Cleaning" line (cleaning_total), but we tag the vendor so cleaning vs
-- linens stays decomposable for internal reporting and so the "N turns"
-- count on the statement counts cleaning turnovers only (not linen pickups).
--
-- Mirrors repair_events.vendor_name. Pre-existing rows were all Cape Ann
-- Elite, so backfill them accordingly.
--
-- Run in the Supabase SQL editor at:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new

ALTER TABLE cleaning_events ADD COLUMN IF NOT EXISTS vendor TEXT;

-- Backfill: every cleaning_events row that predates the Nor'East split was
-- a Cape Ann Elite charge.
UPDATE cleaning_events SET vendor = 'Cape Ann Elite' WHERE vendor IS NULL;
