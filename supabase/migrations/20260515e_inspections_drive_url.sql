-- Drive archive link for completed inspections.
--
-- When an inspection is completed, the inspection report PDF is
-- archived to the Rising Tide shared Drive under
-- Helm Records / Inspections / <year> / <property>/. This column stores
-- the resulting Drive webViewLink on the inspection row.
--
-- Null until the inspection is completed AND the Drive upload
-- succeeds. The archive is best-effort — a failed upload leaves this
-- null and never blocks completing the inspection.

alter table public.inspections
  add column drive_url text;
