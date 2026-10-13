-- ONLY separate staging project jgkblfozftcvymvwhhii. Never a production migration.
begin;
create table public.helm_pilot_message_state (
 unit text primary key check(unit in ('front','back')),
 version bigint not null default 0 check(version>=0),
 archive jsonb not null default '{"version":1,"conversations":[]}'::jsonb,
 last_attempt timestamptz, last_success timestamptz, last_failure timestamptz,
 consecutive_failures integer not null default 0 check(consecutive_failures>=0),
 outcome text check(outcome in ('success','failure'))
);
insert into public.helm_pilot_message_state(unit) values('front'),('back');
alter table public.helm_pilot_message_state enable row level security;
revoke all on public.helm_pilot_message_state from public,anon,authenticated,service_role;
grant select on public.helm_pilot_message_state to service_role;
create function public.helm_pilot_save_messages(target_unit text,expected_version bigint,next_archive jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
 select archive into prior from public.helm_pilot_message_state where unit=target_unit and version=expected_version for update;
 if not found then return false; end if;
 if next_archive->'version' is distinct from '1'::jsonb
 or jsonb_typeof(next_archive->'conversations') is distinct from 'array'
 or octet_length(next_archive::text)>1000000
 then raise exception 'Invalid archive'; end if;
 if exists(select 1 from jsonb_array_elements(next_archive->'conversations') c where c->'thread'->>'unit' is distinct from target_unit)
 then raise exception 'Wrong property'; end if;
 -- Saved threads and message IDs cannot disappear during an incremental read.
 if exists(select 1 from jsonb_array_elements(prior->'conversations') p where not exists(
 select 1 from jsonb_array_elements(next_archive->'conversations') n where n->'thread'->>'id'=p->'thread'->>'id'
 and not exists(select 1 from jsonb_array_elements(p->'messages') pm where not exists(
 select 1 from jsonb_array_elements(n->'messages') nm where nm->>'id'=pm->>'id'))))
 then raise exception 'History removal refused'; end if;
 update public.helm_pilot_message_state set archive=next_archive,version=version+1,last_attempt=now(),last_success=now(),consecutive_failures=0,outcome='success' where unit=target_unit;
 return true;
end;
$$;
create function public.helm_pilot_message_failure(target_unit text)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.helm_pilot_message_state set last_attempt=now(),last_failure=now(),consecutive_failures=consecutive_failures+1,outcome='failure' where unit=target_unit;
 if not found then raise exception 'Missing message state'; end if;
end;
$$;
revoke all on function public.helm_pilot_save_messages(text,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.helm_pilot_message_failure(text) from public,anon,authenticated;
grant execute on function public.helm_pilot_save_messages(text,bigint,jsonb) to service_role;
grant execute on function public.helm_pilot_message_failure(text) to service_role;
commit;
