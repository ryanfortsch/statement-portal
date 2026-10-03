-- Apply only to separate Helm Channex Staging jgkblfozftcvymvwhhii.
-- No booking content. Database timestamps survive process restarts.
begin;
create table public.helm_pilot_worker_health (
 id integer primary key check(id=1),
 last_attempt timestamptz not null,
 last_success timestamptz,
 last_failure timestamptz,
 consecutive_failures integer not null check(consecutive_failures>=0),
 outcome text not null check(outcome in ('success','failure'))
);
alter table public.helm_pilot_worker_health enable row level security;
revoke all on public.helm_pilot_worker_health from public,anon,authenticated,service_role;
grant select on public.helm_pilot_worker_health to service_role;
create function public.helm_pilot_record_worker_health(succeeded boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if succeeded is null then raise exception 'Outcome required'; end if;
 insert into public.helm_pilot_worker_health as h
 (id,last_attempt,last_success,last_failure,consecutive_failures,outcome)
 values (1,now(),case when succeeded then now() end,case when not succeeded then now() end,
 case when succeeded then 0 else 1 end,case when succeeded then 'success' else 'failure' end)
 on conflict(id) do update set
 last_attempt=now(),
 last_success=case when succeeded then now() else h.last_success end,
 last_failure=case when succeeded then h.last_failure else now() end,
 consecutive_failures=case when succeeded then 0 else h.consecutive_failures+1 end,
 outcome=case when succeeded then 'success' else 'failure' end;
end;
$$;
revoke all on function public.helm_pilot_record_worker_health(boolean) from public,anon,authenticated;
grant execute on function public.helm_pilot_record_worker_health(boolean) to service_role;
commit;
