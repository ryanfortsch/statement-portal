-- MANUAL REVIEW ONLY: isolated staging jgkblfozftcvymvwhhii, synthetic snapshots.
-- Requires inventory-planning.sql. No initialization or routing changes.
begin;
create function public.helm_pilot_inventory_snapshot_replace(expected_snapshot bigint,
 expected_configuration bigint,next_snapshot jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare prior public.helm_pilot_inventory_snapshot;
begin
 select * into prior from public.helm_pilot_inventory_snapshot where id=1 for update;
 if not found or expected_snapshot is null or expected_configuration is null
 or prior.snapshot_version<>expected_snapshot or prior.configuration_version<>expected_configuration
 then return false; end if;
 if jsonb_typeof(next_snapshot) is distinct from 'object'
 or (next_snapshot->>'version')::bigint is distinct from expected_snapshot+1
 then raise exception 'Expected next snapshot version'; end if;
 -- Resource and source ownership are configuration, not incidental import content.
 if next_snapshot->'resources' is distinct from prior.state->'snapshot'->'resources'
 or next_snapshot->'listings' is distinct from prior.state->'snapshot'->'listings'
 or next_snapshot->'requiredSources' is distinct from prior.state->'snapshot'->'requiredSources'
 then raise exception 'Snapshot mapping change requires configuration review'; end if;
 update public.helm_pilot_inventory_snapshot set snapshot_version=expected_snapshot+1,
 state=jsonb_set(state,'{snapshot}',next_snapshot) where id=1;
 return true;
end; $$;
revoke all on function public.helm_pilot_inventory_snapshot_replace(bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.helm_pilot_inventory_snapshot_replace(bigint,bigint,jsonb) to service_role;
commit;
