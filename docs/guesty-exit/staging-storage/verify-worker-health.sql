-- Rollback-only verification on jgkblfozftcvymvwhhii; never inserts a durable heartbeat.
begin;
do $$ begin
 if has_table_privilege('anon','public.helm_pilot_worker_health','SELECT')
 or has_table_privilege('authenticated','public.helm_pilot_worker_health','SELECT')
 or has_function_privilege('anon','public.helm_pilot_record_worker_health(boolean)','EXECUTE')
 or has_function_privilege('authenticated','public.helm_pilot_record_worker_health(boolean)','EXECUTE')
 then raise exception 'Unexpected client access'; end if;
 if not (select relrowsecurity from pg_class where oid='public.helm_pilot_worker_health'::regclass)
 then raise exception 'RLS missing'; end if;
end $$;
set local role service_role;
select public.helm_pilot_record_worker_health(true);
select public.helm_pilot_record_worker_health(false);
do $$ begin
 if not exists(select 1 from public.helm_pilot_worker_health where id=1 and outcome='failure' and consecutive_failures=1 and last_success is not null and last_failure is not null)
 then raise exception 'Failure must preserve success'; end if;
end $$;
select public.helm_pilot_record_worker_health(true);
do $$ begin
 if not exists(select 1 from public.helm_pilot_worker_health where id=1 and outcome='success' and consecutive_failures=0 and last_failure is not null)
 then raise exception 'Recovery must preserve failure timestamp'; end if;
end $$;
rollback;
select 'PASS: restricted access, failure retention and recovery; test rolled back' as verification;
