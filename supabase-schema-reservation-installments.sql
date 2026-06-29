-- Cross-month booking installments.
--
-- Some long bookings span 3+ calendar months (e.g. Hancock at 3 South,
-- Jun 22 -> Aug 6, $32,000). The existing statement logic recognizes a
-- reservation's revenue entirely in its check-out month, so the owner
-- doesn't see any of that money until August. This table lets the
-- operator opt-in to splitting one reservation's revenue across the
-- months it spans, so the owner gets a partial payout each month.
--
-- Keyed by (confirmation_code, month) -- NOT by reservations.id -- because
-- /api/ingest wipes and re-inserts the reservations table on every
-- re-upload. The confirmation code is the only stable join key across
-- re-ingests. Same pattern that already works for bank_deposit_attributions.
--
-- A reservation with no rows here behaves byte-for-byte identical to
-- today (single-month flow). A reservation with rows here folds in the
-- per-month installment_revenue instead of the whole adjusted_revenue.
--
-- Constraint: SUM(installment_revenue) over confirmation_code must equal
-- the reservation's full adjusted_revenue to the penny. Enforced by the
-- UI editor; the application layer also re-validates on every save.
--
-- `is_final_month` flags the checkout-month installment. Cleaning,
-- repairs, num_stays, and nights_booked attach ONLY to that month -- the
-- non-final months are revenue-only. This avoids double-counting
-- cleaning fees across the booking's months in dashboards / forecast /
-- cost analysis rollups.
--
-- Stripe fee allocation is computed at recognition time (not stored
-- here) as: stripe_fee * (installment_revenue / sum of installment
-- revenue for this confirmation code). Owners with multi-month stays
-- see a clean per-month net.
--
-- Run in the Supabase SQL editor at:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new

CREATE TABLE IF NOT EXISTS reservation_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confirmation_code TEXT NOT NULL,
  property_id TEXT NOT NULL,
  month TEXT NOT NULL,                          -- 'YYYY-MM'
  installment_revenue NUMERIC(12,2) NOT NULL,   -- pre-mgmt-fee, post-Stripe-fee net for this month
  installment_nights INT,                       -- nights of this booking that fall in `month` (operator-editable)
  is_final_month BOOLEAN NOT NULL DEFAULT FALSE,-- true ONLY on the checkout-month installment; cleaning/repairs/num_stays attach here
  note TEXT,                                    -- operator-only audit trail ("split confirmed with owner 2026-06-12")
  dedupe_key TEXT NOT NULL,                     -- {confirmation_code}|{month}, makes re-saves idempotent
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (confirmation_code, month),
  UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS reservation_installments_property_month_idx
  ON reservation_installments(property_id, month);
CREATE INDEX IF NOT EXISTS reservation_installments_code_idx
  ON reservation_installments(confirmation_code);

-- RLS: anon + authenticated SELECT, matching the rest of the app
-- (property_statements, reservations, bank_deposit_attributions).
-- Writes go through server API routes using the service-role key.
ALTER TABLE reservation_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reservation_installments_anon_select ON reservation_installments;
CREATE POLICY reservation_installments_anon_select
  ON reservation_installments FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS reservation_installments_auth_select ON reservation_installments;
CREATE POLICY reservation_installments_auth_select
  ON reservation_installments FOR SELECT TO authenticated USING (true);
