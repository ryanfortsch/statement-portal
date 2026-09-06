-- Per-stay PDF facts, replacing a list and a sum.
--
-- The first cut kept the PDF's confirmation codes and the sum of its rental
-- income lines. Review showed that is not enough to judge anything: ingest
-- itself declines to insert some PDF stays BY DESIGN (a stay split across
-- months and recognized elsewhere; a row whose checkout falls outside the
-- month), so "on the PDF but not on the statement" needs the stay's own
-- checkout date and amount to tell an excused absence from a missing one,
-- and a sum can only say that something differs, never which stay.
--
--   pdf_stays   jsonb array of { code, check_out (YYYY-MM-DD), rental_income }
--               exactly as the PDF section printed them, for the target
--               property only. NULL when no PDF was part of the upload, when
--               the PDF's lone section belonged to another house, or when
--               nothing could be read from it: those are not facts about
--               this statement and must never read as "zero stays".
--
-- The two superseded columns are dropped. They were added earlier today,
-- nothing has been ingested since, and every row holds NULL in both.
alter table public.property_statements
  add column if not exists pdf_stays jsonb;

alter table public.property_statements
  drop column if exists pdf_confirmation_codes,
  drop column if exists pdf_rental_income_sum;
