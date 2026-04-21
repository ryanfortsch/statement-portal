-- Rising Tide Owner Statement Portal -- Guesty reservations feed
-- Run this in the Supabase SQL editor AFTER supabase-schema-reviews.sql

-- Reservations pulled from Guesty Open API /v1/reservations.
-- Drives the "On the horizon" upcoming-bookings block and (with the reviews
-- table) replaces the manual Reviews CSV upload.
CREATE TABLE IF NOT EXISTS guesty_reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guesty_reservation_id TEXT UNIQUE NOT NULL,   -- Guesty _id, for idempotent upserts
  listing_id TEXT,                              -- Guesty listing _id
  property_id TEXT,                             -- resolved via guesty_listings
  guest_id TEXT,
  guest_name TEXT,
  confirmation_code TEXT,
  check_in DATE,
  check_out DATE,
  nights INT,
  channel TEXT,                                 -- normalized: Airbnb, VRBO, Direct, Booking.com
  guesty_channel_id TEXT,                       -- raw: airbnb2, homeaway2, bookingCom, manual
  status TEXT,                                  -- confirmed, canceled, inquiry, reserved
  host_payout NUMERIC(10,2),                    -- for future cross-check against statement revenue
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guesty_res_property_checkin
  ON guesty_reservations (property_id, check_in);

ALTER TABLE guesty_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access" ON guesty_reservations;
CREATE POLICY "Allow read access" ON guesty_reservations FOR SELECT USING (true);
-- No INSERT/UPDATE policies = service_role only.

-- Persistent Guesty OAuth token cache. One row, upserted on sync.
-- Lets serverless cold starts reuse a token that's still valid (~24h),
-- avoiding the /oauth2/token rate limit.
CREATE TABLE IF NOT EXISTS guesty_auth (
  id INT PRIMARY KEY DEFAULT 1,
  access_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT singleton CHECK (id = 1)
);

ALTER TABLE guesty_auth ENABLE ROW LEVEL SECURITY;
-- No policies at all = service_role-only (for both read and write).

-- Track last successful sync per source so the dashboard can show freshness.
CREATE TABLE IF NOT EXISTS sync_status (
  source TEXT PRIMARY KEY,                -- 'guesty-reviews', 'guesty-reservations', 'guesty-listings'
  last_synced_at TIMESTAMPTZ NOT NULL,
  last_result JSONB,                      -- counts, errors, whatever is useful
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sync_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access" ON sync_status;
CREATE POLICY "Allow read access" ON sync_status FOR SELECT USING (true);
-- service_role writes only.
