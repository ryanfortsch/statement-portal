-- Launch rows have one status control: Done, Not done, Does not apply
-- (UI/UX audit 2026-10-17, appendix 05: five statuses where the team wanted
-- one tick, and "Skipped" versus "N/A" was never explained).
--
-- In progress reads as not done; Skipped was a resolved state, so it reads
-- as does not apply. Idempotent. On 2026-10-18 the table held 24 done and
-- 205 todo rows and no in_progress or skipped ones, so this is a safety net
-- for rows written before the deploy. The column's check constraint still
-- allows all five for one release, because a tab on the previous deployment
-- can write them during the skew window; normalizeLaunchStatus in
-- src/lib/launch-checklist.ts maps those at read.

update public.property_launch_steps set status = 'todo' where status = 'in_progress';
update public.property_launch_steps set status = 'n_a' where status = 'skipped';
