-- Owner Reserve Holdback: per-statement opt-in deduction that keeps a
-- $2,000 minimum owner balance with Rising Tide. Operator ticks a
-- checkbox on the statement card, a default $2,000 (editable) is held
-- back from that month's payout, and the amount appears on the owner
-- PDF as an "Owner Reserve" line item between Cleaning and Owner Payout.
--
-- Not a running-balance system for MVP. Each statement is independent:
-- checking the box on June has no effect on July. Future work could add
-- properties.reserve_target and a reserve_ledger for auto-topup once
-- Dotti has more properties opted in.
--
-- Idempotency: reserve_holdback is stored on property_statements but
-- /api/ingest preserves the value across its DELETE+INSERT wipe (see
-- ingest/route.ts around the property_statements SELECT-before-delete).

ALTER TABLE property_statements
  ADD COLUMN IF NOT EXISTS reserve_holdback numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN property_statements.reserve_holdback IS
  'Owner reserve amount withheld from owner_payout on this specific statement. Set via the "Withhold owner reserve" checkbox on the statement card. Default $0 (feature off); operator-editable, typically $2,000 when active. Survives re-ingest via SELECT-before-delete in /api/ingest.';
