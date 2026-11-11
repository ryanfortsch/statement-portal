\set ON_ERROR_STOP on
-- Only run against a disposable local/CI database. Synthetic rows only.
create table public.cleaner_schedule_recipients (
  phone text primary key, enabled boolean not null, portal_token text not null
);
insert into public.cleaner_schedule_recipients values
  ('synthetic-active',true,'synthetic-token-a'), ('synthetic-paused',false,'synthetic-token-b');
\ir ../../supabase/migrations/20261111140000_cleaner_daily_digest_enrollment.sql
do $$ begin
  if (select count(*) from public.cleaner_schedule_recipients where daily_digest_enabled) <> 2 then
    raise exception 'existing enrollment was changed';
  end if;
  if (select enabled from public.cleaner_schedule_recipients where phone='synthetic-paused') then
    raise exception 'migration enabled a paused recipient';
  end if;
end $$;
update public.cleaner_schedule_recipients set daily_digest_enabled=false where phone='synthetic-active';
-- Rerunning cannot reset an explicit opt-out or mint/rotate a portal token.
\ir ../../supabase/migrations/20261111140000_cleaner_daily_digest_enrollment.sql
do $$ begin
  if (select daily_digest_enabled from public.cleaner_schedule_recipients where phone='synthetic-active') then
    raise exception 'rerun reset an opt-out';
  end if;
  if (select portal_token from public.cleaner_schedule_recipients where phone='synthetic-active') <> 'synthetic-token-a' then
    raise exception 'migration changed portal credentials';
  end if;
  begin
    update public.cleaner_schedule_recipients set daily_digest_enabled=null where phone='synthetic-active';
    raise exception 'null consent accepted';
  exception when not_null_violation then null;
  end;
end $$;
drop table public.cleaner_schedule_recipients;
\echo 'Cleaner daily enrollment migration checks passed (synthetic database).'
