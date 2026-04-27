-- Tracks per-property maintenance / repair charges (Ian Drometer-style
-- handyman Zelle payments, eventually plumbing / electrical / landscaping
-- vendors). Mirrors cleaning_events but for non-cleaning property expenses.
--
-- Repairs are subtracted from owner payout AFTER cleaning and management
-- fees:
--   owner_payout = rental_revenue - mgmt_fee - cleaning_total - repairs_total
--
-- The repairs_total column already exists on property_statements; this
-- table just stores the per-charge audit trail so the statement can show
-- "$50 Apr 23 -- Ian Drometer (handyman)" line items.
--
-- Run in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS repair_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_statement_id UUID NOT NULL REFERENCES property_statements(id) ON DELETE CASCADE,
  vendor_name TEXT,
  description TEXT,
  bank_charge_date DATE,
  bank_charge_amount NUMERIC NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repair_events_psid ON repair_events(property_statement_id);
