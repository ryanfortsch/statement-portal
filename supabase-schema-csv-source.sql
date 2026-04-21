-- Adds a data-source column to reviews + guesty_reservations so we can
-- distinguish Guesty-API rows from CSV-fallback rows, and deduplicate
-- correctly when both sources cover the same reservation.
--
-- Run this in the Supabase SQL editor AFTER supabase-schema-guesty-reservations.sql.

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'guesty-api';
ALTER TABLE guesty_reservations ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'guesty-api';

-- Index on confirmation_code so we can efficiently dedupe CSV + API sources.
CREATE INDEX IF NOT EXISTS idx_guesty_res_confirmation
  ON guesty_reservations (confirmation_code)
  WHERE confirmation_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_reservation_id
  ON reviews (reservation_id)
  WHERE reservation_id IS NOT NULL;
