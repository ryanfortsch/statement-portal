-- Make the negotiable numeric term columns nullable.
--
-- The AI contract-redline tool can remove a term entirely during a
-- negotiation (e.g. owner replaces the 200-day minimum-availability
-- requirement with a seasonal calendar window, so the day-count no
-- longer applies). The apply path writes null to the corresponding
-- column, but these were created NOT NULL, so the whole apply
-- transaction failed with:
--   null value in column "min_availability_days" ... violates not-null
--
-- Drop NOT NULL on the five term fields a redline can legitimately
-- null out. Defaults stay in place (new rows still default sensibly;
-- only an explicit null write from a redline sets null). Existing
-- rows are unaffected — all are currently non-null.
--
-- mgmt_fee_pct is intentionally left NOT NULL: it's the core economic
-- term, it drives the projection financial model, and a redline
-- changes it (e.g. 25% -> 22%) rather than removing it. The apply
-- path defensively skips any field change that tries to null it.

alter table public.projections
  alter column initial_deposit drop not null,
  alter column min_account_balance drop not null,
  alter column min_availability_days drop not null,
  alter column sale_notification_days drop not null,
  alter column reputation_fee drop not null;
