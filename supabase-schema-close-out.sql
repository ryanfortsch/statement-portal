-- Rising Tide Owner Statement Portal -- Month-close execution checklist
-- Run this in the Supabase SQL editor AFTER the previous migrations.

-- Funds-sent date lives on the period (one per month).
ALTER TABLE statement_periods
  ADD COLUMN IF NOT EXISTS funds_sent_date DATE;

-- Per-property close-out task state.
--   email_template: 'monthly' | 'touch_base' | 'year_end'
--   Each *_at column is both the "done" flag and an audit timestamp.
CREATE TABLE IF NOT EXISTS close_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID REFERENCES statement_periods(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  email_template TEXT DEFAULT 'monthly',
  email_drafted_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,
  owner_transfer_done_at TIMESTAMPTZ,
  mgmt_sweep_done_at TIMESTAMPTZ,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (period_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_close_tasks_period
  ON close_tasks (period_id);

ALTER TABLE close_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access" ON close_tasks;
CREATE POLICY "Allow read access" ON close_tasks FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert" ON close_tasks;
CREATE POLICY "Allow insert" ON close_tasks FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update" ON close_tasks;
CREATE POLICY "Allow update" ON close_tasks FOR UPDATE USING (true);
