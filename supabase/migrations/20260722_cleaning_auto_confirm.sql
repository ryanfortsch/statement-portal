-- Auto-confirm quiet cleaning estimates: the operator asked not to be the
-- human-in-the-loop for every lock-relock estimate. src/lib/cleaning-sessions.ts
-- autoGraduateQuietEstimates (run by /api/cron/confirm-cleanings) graduates an
-- unconfirmed 'estimate' to authoritative once every lock on the property has
-- been quiet long enough after the relock. No schema change is required:
-- finish_source is unconstrained text (see 20260623_cleaning_sessions.sql), so
-- writing the new 'auto_quiet' value works today. This migration only updates
-- the documentation comment and adds an index for the cron's scan.

comment on column public.cleaning_sessions.finish_source is
  '''quo'' | ''manual'' | ''estimate'' | ''auto_quiet'' -- auto_quiet: cron-graduated after a sustained quiet period on every lock mapped to the property, see src/lib/cleaning-sessions.ts autoGraduateQuietEstimates';

-- Partial index: the cron scans exactly this predicate every 10 minutes. Rows
-- leave this set permanently once graduated (finish_source changes), so the
-- index stays small regardless of how much history cleaning_sessions accrues.
create index if not exists cleaning_sessions_unconfirmed_estimate_idx
  on public.cleaning_sessions (checkout_date)
  where finish_source = 'estimate';

notify pgrst, 'reload schema';
