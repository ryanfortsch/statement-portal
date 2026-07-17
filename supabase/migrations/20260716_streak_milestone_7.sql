-- Streak schedule change: add a day-7 milestone ($150) and raise day 10 to
-- $300 (day 5 stays $100). The amounts live in code (STREAK_MILESTONES);
-- the DB just needs the check constraint to admit the new milestone day.
alter table public.streak_awards drop constraint if exists streak_awards_milestone_check;
alter table public.streak_awards add constraint streak_awards_milestone_check check (milestone in (5, 7, 10));
