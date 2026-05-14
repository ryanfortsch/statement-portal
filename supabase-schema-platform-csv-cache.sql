-- Cached Platform CSVs (Guesty accounting export).
--
-- Why: the Platform CSV is a whole-portfolio Guesty export -- one file
-- covers every property's confirmation codes / platforms / guest names
-- / TOTAL_PAID for the month. Asking the operator to re-upload it for
-- each of 9 property ingests in the same month is busywork.
--
-- Storage path convention:
--   platform-csvs/{YYYY-MM}/{epoch_ms}-{sanitized_filename}.csv
--
-- The /api/ingest route writes the most recent upload here, and
-- subsequent property ingests for the same month fall back to the
-- newest cached file if no platform CSV is in the request FormData.
-- Run in the Supabase SQL editor at:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('platform-csvs', 'platform-csvs', false, 26214400)  -- 25 MB cap; portfolio exports are well under this
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 26214400;
