-- Rising Tide Owner Statement Portal -- Reviews & Guesty listing map
-- Run this in the Supabase SQL editor AFTER supabase-schema.sql

-- Map Guesty listing IDs to our internal property_id slugs.
-- Populated during first /api/sync-reviews run by matching nickname against PROPERTY_DETAILS[*].listing_match.
CREATE TABLE IF NOT EXISTS guesty_listings (
  listing_id TEXT PRIMARY KEY,             -- Guesty _id (MongoDB ObjectId)
  property_id TEXT NOT NULL,               -- our slug, e.g. "17_beach_rd"
  nickname TEXT,                           -- Guesty marketing name, e.g. "Stay at The Neck"
  address TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reviews pulled from Guesty Open API.
CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guesty_review_id TEXT UNIQUE NOT NULL,   -- Guesty review _id (used for idempotent upserts)
  listing_id TEXT,                         -- Guesty listing _id (FK-ish to guesty_listings)
  property_id TEXT,                        -- resolved via guesty_listings at insert time
  reservation_id TEXT,                     -- Guesty reservation _id
  guest_id TEXT,                           -- Guesty guest _id
  guest_name TEXT,
  channel TEXT,                            -- normalized: Airbnb, VRBO, Booking.com, Direct
  guesty_channel_id TEXT,                  -- raw: airbnb2, homeaway2, bookingCom, etc.

  overall_rating NUMERIC(3,2),             -- 0..5
  public_review TEXT,                      -- guest's public text (may be null)
  private_feedback TEXT,

  category_cleanliness NUMERIC(3,2),
  category_accuracy NUMERIC(3,2),
  category_checkin NUMERIC(3,2),
  category_communication NUMERIC(3,2),
  category_location NUMERIC(3,2),
  category_value NUMERIC(3,2),

  review_created_at TIMESTAMPTZ NOT NULL,  -- Guesty createdAt
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_property_month
  ON reviews (property_id, review_created_at DESC);

-- RLS: read open (portal is internal), writes only via service role.
ALTER TABLE guesty_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access" ON guesty_listings;
CREATE POLICY "Allow read access" ON guesty_listings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow read access" ON reviews;
CREATE POLICY "Allow read access" ON reviews FOR SELECT USING (true);
-- No INSERT/UPDATE policies = service_role only (bypasses RLS).
