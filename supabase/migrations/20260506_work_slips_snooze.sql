-- Snooze a work slip
--
-- Some slips are real-and-pending but not actionable today. Examples:
--   * "Replace the deck stain in spring" filed in November
--   * "Touch up the patio railing — contractor available May 18"
--   * "Owner asked us to revisit Q3 cleaning rates after July"
--
-- Today every active slip clutters the queue regardless. snoozed_until
-- is a nullable date that hides the slip from the active queue until
-- the date passes. The slip itself stays in 'open' / 'in_progress' /
-- 'scheduled' status — snooze is a presentation thing, not a state
-- transition.
--
-- The active-queue read paths (work/page.tsx, /me, home signals,
-- property page Open Work, queue's per-property group counts) all need
-- to filter `snoozed_until is null OR snoozed_until <= today`. That's
-- a one-line change per query.

alter table public.work_slips
  add column if not exists snoozed_until date,
  add column if not exists snoozed_by_email text;

create index if not exists idx_work_slips_snoozed_until
  on public.work_slips(snoozed_until);
