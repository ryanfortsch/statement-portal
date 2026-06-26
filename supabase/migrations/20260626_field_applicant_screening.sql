-- Field recruiting funnel: AI first-pass screening of applicants.
--
-- A cheap Haiku pass scores each application against the Vacation Rental
-- Specialist profile (local to Cape Ann, has a reliable vehicle, takes pride in
-- their work / relevant experience) and bubbles strong fits to the top of the
-- Applicants page. Advisory only -- the operator still clicks Invite / Decline.
--
-- All columns are nullable so an application without a verdict (LLM down, or
-- pre-dating this feature) still renders; the "Screen" button backfills them.
--
--   ai_recommendation  reach_out | maybe | pass
--   ai_score           0-100 fit score, drives the sort within a bucket
--   ai_reason          one-sentence rationale shown on the card
--   ai_assessed_at     when the pass last ran (null = never screened)

alter table public.contractor_applications
  add column if not exists ai_recommendation text
    check (ai_recommendation in ('reach_out', 'maybe', 'pass')),
  add column if not exists ai_score       int,
  add column if not exists ai_reason      text,
  add column if not exists ai_assessed_at timestamptz;
