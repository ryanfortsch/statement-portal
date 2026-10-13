-- Separate Helm Channex Staging project only. Never a production migration.
begin;
create table public.helm_pilot_ownership_state (
 id integer primary key check(id=1),
 version bigint not null default 0 check(version>=0),
 journal jsonb not null check(jsonb_typeof(journal)='object')
);
alter table public.helm_pilot_ownership_state enable row level security;
revoke all on public.helm_pilot_ownership_state from public,anon,authenticated,service_role;
grant select,insert on public.helm_pilot_ownership_state to service_role;
create table public.helm_pilot_ownership_history (
 version bigint primary key, journal jsonb not null, recorded_at timestamptz not null default now()
);
alter table public.helm_pilot_ownership_history enable row level security;
revoke all on public.helm_pilot_ownership_history from public,anon,authenticated,service_role;
grant select on public.helm_pilot_ownership_history to service_role;
create function public.helm_pilot_ownership_cas(expected_version bigint,next_journal jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
 select journal into prior from public.helm_pilot_ownership_state where id=1 and version=expected_version for update;
 if not found then return false; end if;
 if jsonb_typeof(next_journal->'events') is distinct from 'array'
    or next_journal->'version' is distinct from prior->'version'
    or next_journal->'mode' is distinct from prior->'mode'
    or jsonb_array_length(next_journal->'events') <> jsonb_array_length(prior->'events')+1
 then raise exception 'Expected one appended event'; end if;
 if exists(select 1 from jsonb_array_elements(prior->'events') with ordinality as e(value,idx)
    where next_journal->'events'->((idx-1)::integer) is distinct from value)
 then raise exception 'History rewrite refused'; end if;
 update public.helm_pilot_ownership_state set version=version+1,journal=next_journal where id=1;
 insert into public.helm_pilot_ownership_history(version,journal) values(expected_version+1,next_journal);
 return true;
end;
$$;
revoke all on function public.helm_pilot_ownership_cas(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.helm_pilot_ownership_cas(bigint,jsonb) to service_role;
commit;
