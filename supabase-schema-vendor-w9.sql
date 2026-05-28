-- Tracks which vendors have a W9 on file (in QuickBooks -- this table is just
-- the signal). Used by the 1099 candidates section on the Cost Analysis page
-- to surface "vendor X is over $600 YTD but no W9 collected yet" so nothing
-- slips through year-end now that the bookkeeper relationship is ending.
--
-- The W9 document itself stays in QuickBooks; Helm just stores whether we
-- have one, plus when the operator last confirmed it.
--
-- vendor_key is a lowercased + trimmed name so spelling variants across the
-- three source tables (cleaning_events.vendor, repair_events.vendor_name,
-- overhead_expenses canonical merchant) merge to one row.
--
-- Run in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new

CREATE TABLE IF NOT EXISTS vendor_w9 (
  vendor_key   TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  on_file      BOOLEAN NOT NULL DEFAULT false,
  notes        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
