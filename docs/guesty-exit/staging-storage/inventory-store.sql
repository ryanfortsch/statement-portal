-- MANUAL REVIEW ONLY: jgkblfozftcvymvwhhii isolated staging project.
-- Not in production migrations. No provider calls or live worker activation.
begin;
create table public.helm_pilot_inventory_state (
 id integer primary key check(id=1),
 version bigint not null default 0 check(version between 0 and 10000),
 journal jsonb not null check(jsonb_typeof(journal)='object')
);
alter table public.helm_pilot_inventory_state enable row level security;
revoke all on public.helm_pilot_inventory_state from public,anon,authenticated,service_role;
grant select on public.helm_pilot_inventory_state to service_role;
-- Initialization occurs once through this reviewed SQL, never on worker startup.
insert into public.helm_pilot_inventory_state(id,journal) values(1,'{"format":1,"commands":[]}');
create function public.helm_pilot_inventory_append(expected_version bigint,next_journal jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
 select journal into prior from public.helm_pilot_inventory_state
 where id=1 and version=expected_version for update;
 if not found then return false; end if;
 if next_journal->'format' is distinct from '1'::jsonb
    or jsonb_typeof(next_journal->'commands') is distinct from 'array'
 then raise exception 'Invalid inventory journal'; end if;
 if jsonb_array_length(next_journal->'commands') <> expected_version+1
    or expected_version>=10000
 then raise exception 'Expected one appended command'; end if;
 if exists(select 1 from jsonb_array_elements(prior->'commands') with ordinality as e(value,idx)
    where next_journal->'commands'->((idx-1)::integer) is distinct from value)
 then raise exception 'Inventory history rewrite refused'; end if;
 update public.helm_pilot_inventory_state set version=version+1,journal=next_journal where id=1;
 return true;
end;
$$;
revoke all on function public.helm_pilot_inventory_append(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.helm_pilot_inventory_append(bigint,jsonb) to service_role;
commit;
