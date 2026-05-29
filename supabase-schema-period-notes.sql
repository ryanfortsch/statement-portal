-- Per-month operator notes for the monthly close-out (Statements module).
--
-- Free-text notes the operator drops in throughout the month so they're
-- right there when it's time to close the books: "VRBO cancellation on
-- this date, refunded the guest", "weird maintenance charge for 30
-- Woodward, follow up with vendor", etc. Keyed by month (YYYY-MM) so
-- notes can be added before the month's statements are uploaded.
--
-- Run in the Supabase SQL editor at:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new

CREATE TABLE IF NOT EXISTS period_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month TEXT NOT NULL,                -- 'YYYY-MM', matches statement_periods.month
  property_id TEXT,                   -- optional, tags the note to a property
  body TEXT NOT NULL,
  created_by TEXT,                    -- email of the user who created it
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ             -- null = open, non-null = marked done
);

CREATE INDEX IF NOT EXISTS period_notes_month_idx ON period_notes(month);
CREATE INDEX IF NOT EXISTS period_notes_created_at_idx ON period_notes(created_at DESC);
