-- Statement emails: opt-in "Work notes" section.
--
-- Per property + period, the operator can fold the month's work slips into
-- the owner-statement email as a polished section (done / in motion /
-- needs your input). Stored on close_tasks alongside email_template so the
-- choice survives reloads and drives Draft All the same way the template
-- picker does. Default off: existing statements render byte-identical.

alter table public.close_tasks
  add column if not exists email_include_work_slips boolean not null default false;
