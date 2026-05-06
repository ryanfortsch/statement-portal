-- Inspection plan: assignee
--
-- The plan to walk a property at date X also needs a "who walks it." Until
-- now `planned_by_email` recorded who *created* the plan, but we couldn't
-- distinguish that from the actual inspector — and on a multi-person team
-- those are usually different people (Allie schedules, the inspector goes).
--
-- Adds `assigned_to_email` (nullable; null = "anyone on the team can take
-- it"). Uses the same email-as-id convention every other Helm-native
-- assignment field uses (work_slips.assigned_to_email,
-- tasks.assigned_to_email).

alter table public.inspection_plans
  add column if not exists assigned_to_email text;

create index if not exists idx_inspection_plans_assigned_to
  on public.inspection_plans(assigned_to_email);
