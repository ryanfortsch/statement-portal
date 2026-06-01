-- Cleaning event credit / duplicate-charge marker.
--
-- When the cleaning vendor (Cape Ann Elite, Nor'East) accidentally
-- double-charges -- as A1 did to 53 Rocky Neck on 2026-05-21 -- the
-- operator marks one of the events as credited so the owner statement
-- excludes it from cleaning_total. The duplicate row stays on file (audit
-- trail), and the offsetting refund deposit shows up later in its own
-- statement month (between RT and the vendor, never owner-facing).
--
-- Run in the Supabase SQL editor at:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new

ALTER TABLE cleaning_events
  ADD COLUMN IF NOT EXISTS credit_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_reason TEXT;
