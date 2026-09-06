-- What the Guesty owner statement PDF said, kept.
--
-- Reconciliation holds Helm's numbers up against independent sources and
-- names every difference. The PDF is the primary source for a statement's
-- stays, and until now ingest parsed it and threw the section facts away:
-- how many reservations the section listed, which confirmation codes, and
-- what rental income it printed per stay. Without those the only thing a
-- later check can compare against is Helm's own rows, which is circular.
--
-- Three nullable columns, written once at ingest and never updated:
--   pdf_stay_count           reservations the PDF section listed
--   pdf_rental_income_sum    sum of the per-stay Rental Income lines
--   pdf_confirmation_codes   the codes, so "on the PDF but not on the
--                            statement" (and the reverse) is exact
--
-- NULL means the statement was ingested before this shipped. A
-- reconciliation lane reads that as "not recorded", never as zero.
alter table public.property_statements
  add column if not exists pdf_stay_count integer,
  add column if not exists pdf_rental_income_sum numeric(12,2),
  add column if not exists pdf_confirmation_codes text[];
