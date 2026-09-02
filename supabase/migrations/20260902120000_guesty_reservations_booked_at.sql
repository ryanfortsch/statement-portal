-- When the guest actually booked, per Guesty.
--
-- Helm has no honest booking timestamp today, and that is what blocks a
-- lead-time booking curve on /forecast. `bookings.first_seen_at` looks like
-- one and is not: it equals `created_at` on every row of both sources
-- (704/704 ical_import, 445/445 guesty_legacy), so it records when a row was
-- inserted rather than when a guest booked. For the legacy rows it also equals
-- `last_seen_at`, meaning they were written once by a backfill and never
-- re-observed, and July 2026's nights are ~100% legacy. Any curve built on
-- that field measures when the sync ran.
--
-- Guesty's reservation object already carries createdAt and confirmedAt.
-- /api/sync-guesty requested neither for reservations; it persisted createdAt
-- for reviews only. lib/guesty-reservations.ts now asks for both and writes
-- confirmedAt, falling back to createdAt because some channels omit it.
--
-- Backfill is impossible: Guesty's reservations feed drops non-confirmed rows
-- and the historical CSVs never carried the field. This only works forward,
-- so every day it is not captured is a day of history that cannot be
-- recovered. Nulls on existing rows are expected and permanent.
ALTER TABLE guesty_reservations
  ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ;

-- The curve reads this by stay month, so it is always filtered alongside
-- check_in / check_out rather than scanned on its own.
CREATE INDEX IF NOT EXISTS idx_guesty_reservations_booked_at
  ON guesty_reservations (booked_at)
  WHERE booked_at IS NOT NULL;

COMMENT ON COLUMN guesty_reservations.booked_at IS
  'Guesty confirmedAt, falling back to createdAt. When the guest booked, NOT when Helm synced (that is synced_at). Null on every row written before 2026-09-02; not backfillable.';
