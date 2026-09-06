-- The bank review queue gets an operator-facing note column.
--
-- `label` is what the owner's statement prints when a deposit is
-- attributed as an add-on. The cancellation-payout matcher needs to tell
-- the operator something the owner must never see ("ALREADY on the
-- 2026-08 statement, attributing it again pays the owner twice", or
-- "the cancellation check could not run at ingest, verify"). Putting an
-- instruction in `label` meant it would print on the PDF the moment an
-- operator confirmed through the guard, and the undo path clears `label`,
-- which made the guard one-shot. A separate column keeps the two jobs
-- apart: `review_note` is pipeline-written, read on the review card,
-- printed nowhere, and untouched by attribute / unattribute.
alter table public.bank_deposit_attributions
  add column if not exists review_note text;

comment on column public.bank_deposit_attributions.review_note is
  'Pipeline-written note for the operator reviewing this row (which stay a deposit is, whether it may be attributed). Never printed on a statement; not cleared by attribute or unattribute.';
