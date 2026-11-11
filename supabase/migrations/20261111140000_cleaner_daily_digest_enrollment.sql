-- Keep existing crews enrolled; a portal-only recipient may opt out of the
-- daily checkout summary without disabling their scoped portal or future
-- booking reminders. No recipient, token, job or message is created here.
begin;
alter table public.cleaner_schedule_recipients
  add column if not exists daily_digest_enabled boolean not null default true;
comment on column public.cleaner_schedule_recipients.daily_digest_enabled is
  'Daily checkout summary enrollment only. enabled remains the master recipient switch; booking reminder timing and portal access are separate.';
notify pgrst, 'reload schema';
commit;
