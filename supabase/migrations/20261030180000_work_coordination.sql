-- Coordination is independent of the person/vendor performing the work.
-- Additive only: no work assignments, dates or statuses are rewritten.
alter table public.work_slips
  add column if not exists coordinator_email text,
  add column if not exists follow_up_date date;

comment on column public.work_slips.coordinator_email is 'Team member accountable for follow-through; independent of assigned_to_* and the work lane.';
comment on column public.work_slips.follow_up_date is 'Next office follow-up date; does not reschedule a field visit.';

create index if not exists work_slips_coordinator_active
  on public.work_slips (coordinator_email, follow_up_date)
  where status in ('open', 'in_progress', 'scheduled', 'blocked');
