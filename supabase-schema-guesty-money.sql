-- Adds per-reservation money fields from the Guesty reservations CSV so the
-- monthly ingest can reconstruct adjusted_revenue from the guest gross
-- (TOTAL PAID) instead of applying Stripe fees to Guesty's already-net
-- rental income.
--
-- Run this in the Supabase SQL editor AFTER supabase-schema-guesty-reservations.sql.

ALTER TABLE guesty_reservations ADD COLUMN IF NOT EXISTS total_paid NUMERIC;
ALTER TABLE guesty_reservations ADD COLUMN IF NOT EXISTS total_taxes NUMERIC;
ALTER TABLE guesty_reservations ADD COLUMN IF NOT EXISTS channel_commission NUMERIC;
ALTER TABLE guesty_reservations ADD COLUMN IF NOT EXISTS owner_net_revenue_guesty NUMERIC;
