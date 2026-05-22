-- Drive archive link for the submitted owner-onboarding intake.
--
-- When an owner submits the onboarding form, the intake document is
-- archived to the Rising Tide shared Drive under
-- Helm Records / Onboarding / <year>/. This column stores the resulting
-- Drive webViewLink on the projection row.
--
-- Null until the intake is submitted AND the Drive upload succeeds.
-- Best-effort — a failed upload leaves this null and never blocks the
-- owner's submission.

alter table public.projections
  add column onboarding_drive_url text;
