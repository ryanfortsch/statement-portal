-- Patch: add `direction` to bank_deposit_attributions so the same review
-- queue can also park unmatched DEBITS (e.g. an Online Transfer from the
-- 17 Beach account to RT operating that reimbursed RT for a trash can
-- bought on the corporate card -- belongs in repairs/maintenance, not the
-- credit side).
--
-- Existing rows are all credits, so they default to 'deposit'. The
-- /api/ingest route will start inserting unmatched negative amounts as
-- direction='debit'. The /api/bank-deposits/[id] route branches on this
-- column: attribute on a 'deposit' row flows to property_statements.
-- add_ons_revenue; attribute on a 'debit' row flows to repairs_total.
--
-- Run in the Supabase SQL editor.

ALTER TABLE bank_deposit_attributions
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'deposit'
  CHECK (direction IN ('deposit', 'debit'));

CREATE INDEX IF NOT EXISTS bda_direction_idx ON bank_deposit_attributions(direction);

-- Mirrors add_ons_revenue: sum of attributed direction='debit' rows for
-- the (property, month). Renders under "Repairs" on the owner statement
-- alongside the vendor-derived repairs_total. owner_payout includes
-- both as a deduction.
ALTER TABLE property_statements
  ADD COLUMN IF NOT EXISTS attributed_debits_total NUMERIC NOT NULL DEFAULT 0;
