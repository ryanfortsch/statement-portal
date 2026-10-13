-- MANUAL REVIEW ONLY. Isolated staging jgkblfozftcvymvwhhii, synthetic snapshots only.
-- Requires inventory-store.sql. No production migration or automatic initialization.
begin;
create table public.helm_pilot_inventory_snapshot (
 id integer primary key check(id=1),
 snapshot_version bigint not null check(snapshot_version between 1 and 9007199254740991),
 configuration_version bigint not null check(configuration_version between 1 and 9007199254740991),
 state jsonb not null,
 check(jsonb_typeof(state)='object'),
 check(((state->'snapshot'->>'version')::bigint = snapshot_version) is true),
 check(((state->>'configurationVersion')::bigint = configuration_version) is true)
);
alter table public.helm_pilot_inventory_snapshot enable row level security;
revoke all on public.helm_pilot_inventory_snapshot from public,anon,authenticated,service_role;
grant select on public.helm_pilot_inventory_snapshot to service_role;
-- Every reviewed snapshot/configuration replacement invalidates older planning reads.
create function public.helm_pilot_inventory_snapshot_version_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.snapshot_version<=old.snapshot_version or new.configuration_version<old.configuration_version
 then raise exception 'Snapshot versions must advance'; end if;
 if (new.state - 'snapshot' - 'configurationVersion') is distinct from
    (old.state - 'snapshot' - 'configurationVersion')
    and new.configuration_version<=old.configuration_version
 then raise exception 'Configuration version must advance'; end if;
 return new;
end; $$;
create trigger inventory_snapshot_version_guard before update on public.helm_pilot_inventory_snapshot
for each row execute function public.helm_pilot_inventory_snapshot_version_guard();
create function public.helm_pilot_inventory_planning_read()
returns jsonb language sql stable security definer set search_path='' as $$
 select s.state || jsonb_build_object('journalVersion',j.version,'journal',j.journal)
 from public.helm_pilot_inventory_snapshot s cross join public.helm_pilot_inventory_state j
 where s.id=1 and j.id=1;
$$;
create function public.helm_pilot_inventory_plan_commit(expected_snapshot bigint,expected_configuration bigint,
 expected_journal bigint,next_journal jsonb,fresh_until bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.helm_pilot_inventory_snapshot; command jsonb; payload jsonb; stamp bigint;
begin
 select * into s from public.helm_pilot_inventory_snapshot where id=1 for share;
 if not found or s.snapshot_version<>expected_snapshot or s.configuration_version<>expected_configuration
 then return false; end if;
 -- Lock ordering is snapshot then journal. Check time AFTER waiting for both locks.
 perform 1 from public.helm_pilot_inventory_state where id=1 for update;
 stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if fresh_until is null or fresh_until<=stamp then return false; end if;
 command := next_journal->'commands'->(expected_journal::integer);
 payload := command->'intent';
 if command->>'kind' is distinct from 'enqueue'
 or payload->>'environment' is distinct from 'staging'
 or payload->>'connection' is distinct from s.state->>'connection'
 or payload->>'property' is distinct from s.state->>'property'
 or payload->'generation' is distinct from s.state->'generation'
 or payload->'version' is distinct from to_jsonb(s.snapshot_version)
 then raise exception 'Planning identity mismatch'; end if;
 -- Caller cannot extend evidence beyond the stored snapshot. Full mapping/range and
 -- desired-payload calculation are validated by the trusted TypeScript planner.
 if jsonb_typeof(s.state->'snapshot'->'coverage') is distinct from 'array'
 then raise exception 'Invalid coverage'; end if;
 if jsonb_array_length(s.state->'snapshot'->'coverage')=0 then return false; end if;
 if exists(select 1 from jsonb_array_elements(s.state->'snapshot'->'coverage') c
   where c->'complete' is distinct from 'true'::jsonb
   or (c->>'freshUntil') is null or (c->>'freshUntil')::bigint < fresh_until)
 then return false; end if;
 return public.helm_pilot_inventory_append(expected_journal,next_journal);
end; $$;
revoke all on function public.helm_pilot_inventory_planning_read() from public,anon,authenticated;
revoke all on function public.helm_pilot_inventory_plan_commit(bigint,bigint,bigint,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.helm_pilot_inventory_planning_read() to service_role;
grant execute on function public.helm_pilot_inventory_plan_commit(bigint,bigint,bigint,jsonb,bigint) to service_role;
commit;
