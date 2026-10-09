-- "Does this owner block need a cleaning after it?" The operator's answer.
--
-- An owner's stay reaches the cleaner schedule from the Guesty calendar
-- hold (#1762) and lists by default, because a redundant stop costs less
-- than a missed turnover. But nothing told the operator a block had
-- appeared or asked the question, and she wants to see it and answer it
-- (Dotti, 2026-10-08). Every upcoming owner-tagged hold with no row here
-- is served loudly on /cleaner-messaging and the home feed until answered.
--
-- Keyed on the stay (property_id, stay_check_in), the same key the
-- schedule, checkout_adjustments and checkout_cleaning_skips use, so an
-- answer survives the block being extended. A 'no_clean' answer also writes
-- a checkout_cleaning_skips row: that table is what the schedule honours,
-- and this one only records that the question was asked and answered.
CREATE TABLE IF NOT EXISTS owner_hold_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id TEXT NOT NULL,
  stay_check_in DATE NOT NULL,
  -- The checkout as it stood when answered, for the record only.
  check_out DATE NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('clean', 'no_clean')),
  hold_reason TEXT,
  hold_note TEXT,
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, stay_check_in)
);

-- Service role only, like the rest of the schedule tables.
ALTER TABLE owner_hold_decisions ENABLE ROW LEVEL SECURITY;
