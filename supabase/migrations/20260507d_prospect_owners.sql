-- Structured owners on the prospect record.
--
-- Up to now the prospect form crammed couples into single fields like
-- "Bethany Giblin, John Gavin" / "Bethany, John". Now each owner has their
-- own card (first name, last name, email, phone, optional full legal name)
-- and the form starts with one card with an "Add owner" button to stamp
-- additional ones.
--
-- The owners array is stored as JSONB. Existing scalar columns
-- (prospect_name, prospect_first_name, prospect_first_names,
-- prospect_full_legal, prospect_phone, prospect_email) stay in place and
-- get re-derived from owners[0] / owners[*] on every save, so render
-- code that already reads them (deck, guide, contract) keeps working
-- without changes.

alter table public.projections
  add column owners jsonb;
