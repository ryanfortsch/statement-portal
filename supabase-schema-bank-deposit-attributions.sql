-- Bank deposit review queue + per-reservation add-on attribution.
--
-- Solves: when a guest pays for an add-on (pet fee, late checkout, etc.)
-- AFTER booking, it lands as a bank deposit but never makes it onto the
-- Guesty statement. /api/ingest parks each unmatched non-Stripe deposit
-- here as `status='pending'`; the operator attributes it to a specific
-- reservation (or dismisses it as not-revenue) from the Statements page.
-- Attributed add-ons feed back into the owner payout math.
--
-- Linkage is by stable keys (`property_id` + `month` + the reservation's
-- `confirmation_code`) -- NOT property_statements.id -- because /api/ingest
-- wholesale-deletes and re-inserts the statement row on every re-ingest.
-- UUIDs change; the operator's review survives.
--
-- `dedupe_key` makes the ingest idempotent: re-running /api/ingest
-- inserts the same deposit only once and never disturbs an existing
-- attribution.
--
-- Run in the Supabase SQL editor at:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new

CREATE TABLE IF NOT EXISTS bank_deposit_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id TEXT NOT NULL,
  month TEXT NOT NULL,                                       -- 'YYYY-MM'
  deposit_date DATE NOT NULL,
  amount NUMERIC NOT NULL,                                   -- positive; this is a credit
  description TEXT,
  source TEXT NOT NULL,                                      -- 'airbnb' | 'booking' | 'other'
  suggested_reservation_code TEXT,                           -- nearest stay by date, at ingest
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'attributed', 'dismissed')),
  attributed_reservation_code TEXT,                          -- set on attribute
  label TEXT,                                                -- "Pet fee", "Late checkout", default "Add-on"
  apply_mgmt_fee BOOLEAN NOT NULL DEFAULT TRUE,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bda_prop_month_idx ON bank_deposit_attributions(property_id, month);
CREATE INDEX IF NOT EXISTS bda_status_idx ON bank_deposit_attributions(status);

-- Add-on revenue tracked alongside rental_revenue on the statement header
-- so it survives /api/ingest re-uploads (the ingest re-derives
-- rental_revenue from reservations but reads add-on totals from the
-- bank_deposit_attributions rows above).
ALTER TABLE property_statements
  ADD COLUMN IF NOT EXISTS add_ons_revenue NUMERIC NOT NULL DEFAULT 0;
