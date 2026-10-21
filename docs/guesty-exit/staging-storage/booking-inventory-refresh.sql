-- Candidate only. Install after booking-inventory-planning.sql in the isolated
-- staging database. No initialization, owner-policy change or provider calls.
-- Fresh calculation of an IDENTICAL plan may extend its short dispatch deadline,
-- bounded by existing source evidence. This never renews source coverage.
begin;
create or replace function public.helm_booking_inventory_plan_refresh(p_property text,expected_capture bigint,
 expected_configuration bigint,expected_plan bigint,expected_journal bigint,expected_inputs jsonb,
 fresh_until bigint,desired_digest text)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.helm_inventory_capture_scopes; c public.helm_booking_inventory_consumers;
 stamp bigint; buffer_days integer; required_start date; required_end date;
begin
 if expected_capture is null or expected_capture<1 or expected_configuration is null or expected_configuration<1
    or expected_plan is null or expected_plan<1 or expected_journal is null or expected_journal<1
 then return false; end if;
 -- Match the existing planner/dispatch lock order; no separate read/write race.
 select * into s from public.helm_inventory_capture_scopes where property_id=p_property for share;
 if not found or not s.enabled or s.version<>expected_capture then return false; end if;
 select * into c from public.helm_booking_inventory_consumers where property_id=p_property for update;
 if not found or c.configuration_version<>expected_configuration or c.plan_version<>expected_plan
    or c.journal_version<>expected_journal or c.planned_capture_version<>expected_capture
    or c.planned_configuration_version<>expected_configuration then return false; end if;
 stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if fresh_until is null or fresh_until<=stamp or fresh_until>stamp+60000 or fresh_until<=c.planned_fresh_until
    or desired_digest is null or desired_digest !~ '^[a-f0-9]{64}$' or desired_digest is distinct from c.last_digest
    or expected_inputs is distinct from c.planned_inputs
    or expected_inputs is distinct from public.helm_booking_inventory_inputs(p_property)
    or c.configuration->>'environment' is distinct from 'staging'
    or c.configuration->>'topology' is distinct from 'single-unit'
 then return false; end if;
 -- No inference from an empty delta feed, old observation or partial scope.
 if jsonb_typeof(c.configuration->'requiredSources') is distinct from 'array'
    or jsonb_typeof(c.configuration->'coverage') is distinct from 'array'
    or jsonb_typeof(expected_inputs->'plan') is distinct from 'object' then return false; end if;
 if jsonb_array_length(c.configuration->'requiredSources') not between 1 and 20
    or jsonb_array_length(c.configuration->'coverage')<>jsonb_array_length(c.configuration->'requiredSources')
    or (select count(distinct value) from jsonb_array_elements(c.configuration->'requiredSources'))<>jsonb_array_length(c.configuration->'requiredSources')
    or (select count(distinct value->>'source') from jsonb_array_elements(c.configuration->'coverage'))<>jsonb_array_length(c.configuration->'coverage')
 then return false; end if;
 buffer_days := (expected_inputs->'plan'->>'turnover_buffer_days')::integer;
 if buffer_days is null or buffer_days not between 0 and 30 then return false; end if;
 required_start := (c.configuration->>'start')::date-buffer_days;
 required_end := (c.configuration->>'end')::date+buffer_days;
 if required_start is null or required_end is null or required_end<=required_start
    or required_end-required_start>426 then return false; end if;
 if exists(select 1 from jsonb_array_elements(c.configuration->'coverage') v
   where v->'complete' is distinct from 'true'::jsonb
    or not (c.configuration->'requiredSources' @> jsonb_build_array(v->'source'))
    or (v->>'observedAt') is null or (v->>'freshUntil') is null
    or (v->>'start') is null or (v->>'end') is null
    or (v->>'observedAt')::bigint<0 or (v->>'observedAt')::bigint>stamp
    or (v->>'freshUntil')::bigint<fresh_until
    or (v->>'freshUntil')::bigint-(v->>'observedAt')::bigint not between 1 and 3600000
    or (v->>'start')::date>required_start or (v->>'end')::date<required_end
    or (v->>'end')::date-(v->>'start')::date not between 1 and 426)
 then return false; end if;
 update public.helm_booking_inventory_consumers set planned_fresh_until=fresh_until where property_id=p_property;
 return true;
end $$;
revoke all on function public.helm_booking_inventory_plan_refresh(text,bigint,bigint,bigint,bigint,jsonb,bigint,text)
 from public,anon,authenticated,service_role;
grant execute on function public.helm_booking_inventory_plan_refresh(text,bigint,bigint,bigint,bigint,jsonb,bigint,text) to service_role;
commit;
