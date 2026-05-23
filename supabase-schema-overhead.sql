-- Rising Tide overhead expenses (Cost Analysis tab, phase 2).
--
-- Categorized business-overhead transactions pulled from the corporate
-- card (*3878) and operating account (*5130). Personal/gray spend and
-- internal transfers are dropped at ingest (see lib/overhead-categories.ts),
-- so every row here is a real business cost.
--
-- One row per transaction. dedupe_key makes re-uploads idempotent: the
-- monthly card/operating export overlaps prior months, and we don't want
-- to double-count. ON CONFLICT (dedupe_key) DO NOTHING on insert.
--
-- Run in the Supabase SQL editor at:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new

CREATE TABLE IF NOT EXISTS overhead_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account TEXT NOT NULL,          -- 'card' (*3878) or 'operating' (*5130)
  txn_date DATE,
  post_date DATE,
  month TEXT NOT NULL,            -- YYYY-MM derived from txn_date, for fast grouping
  description TEXT,
  category TEXT NOT NULL,         -- bucket from categorizeOverhead()
  raw_category TEXT,             -- Chase's own category column (card only)
  amount NUMERIC NOT NULL,        -- positive = cost (abs of the debit)
  dedupe_key TEXT NOT NULL UNIQUE,
  source TEXT,                    -- upload filename, for provenance
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overhead_month ON overhead_expenses(month);
CREATE INDEX IF NOT EXISTS idx_overhead_category ON overhead_expenses(category);
