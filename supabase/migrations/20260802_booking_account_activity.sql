-- Central "Bookingcom Deposits" Chase account (...5623) activity.
--
-- Booking.com pays every property's payouts into ONE central Chase account,
-- then the money is transferred out to the property's own checking as a
-- plain "Online Transfer to CHK ...last4". The property's bank CSV therefore
-- never shows a Booking.com-labeled deposit, so Booking.com stays were the
-- one channel with no bank corroboration on the statement dashboard.
--
-- The operator uploads the 5623 account's activity CSV once a month from
-- the Statements page (same global-upload pattern as the Reservations CSV).
-- Rows accumulate here (dedupe_hash makes re-uploads idempotent) and
-- /api/ingest reads them to corroborate Booking.com reservations: a
-- transfer out to the property's last4 in the statement window means the
-- channel paid us for that property.

CREATE TABLE IF NOT EXISTS booking_account_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,              -- signed: credits positive, transfers out negative
  txn_type TEXT,                        -- Chase "Type" column (ACH_CREDIT, ACCT_XFER, ...)
  kind TEXT NOT NULL DEFAULT 'other',   -- 'booking_credit' | 'property_transfer' | 'other'
  payout_ref TEXT,                      -- Booking.com IND ID (ST-...) on credits
  transfer_last4 TEXT,                  -- destination account last4 on transfers out
  property_id TEXT,                     -- resolved from transfer_last4 via PROPERTIES
  uploaded_month TEXT,                  -- YYYY-MM the operator filed the upload under
  dedupe_hash TEXT NOT NULL UNIQUE,     -- sha256(posting_date|amount|description)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS booking_account_activity_date_idx
  ON booking_account_activity(posting_date);
CREATE INDEX IF NOT EXISTS booking_account_activity_property_idx
  ON booking_account_activity(property_id, posting_date);

-- Service-role only, like every new Helm table: RLS on, no policies.
ALTER TABLE booking_account_activity ENABLE ROW LEVEL SECURITY;
