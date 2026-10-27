-- Candidate: isolated staging only. Not installed. Requires the archived-journal planner.
-- Changes only the maximum sync span; no configuration, authority or booking-window change.
begin;
do $$
begin
 if to_regprocedure('public.helm_booking_inventory_plan_commit(text,bigint,bigint,bigint,bigint,jsonb,jsonb,bigint,text)') is null
    or to_regprocedure('public.helm_booking_inventory_append_internal(text,bigint,jsonb)') is null
 then raise exception 'Install the archived-journal planner first'; end if;
end $$;
create or replace function public.helm_booking_inventory_plan_commit(p_property text,expected_capture bigint,
 expected_configuration bigint,expected_plan bigint,expected_journal bigint,expected_inputs jsonb,
 next_journal jsonb,fresh_until bigint,desired_digest text)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.helm_inventory_capture_scopes; c public.helm_booking_inventory_consumers;
 command jsonb; payload jsonb; stamp bigint;
begin
 if expected_capture is null or expected_capture<1 or expected_configuration is null or expected_configuration<1
    or expected_plan is null or expected_plan<0 or expected_journal is null or expected_journal<0
 then raise exception 'Invalid planning expectation'; end if;
 -- Same lock order in both planning and dispatch: capture scope, then consumer.
 select * into s from public.helm_inventory_capture_scopes where property_id=p_property for share;
 if not found or not s.enabled or s.version<>expected_capture then return false; end if;
 select * into c from public.helm_booking_inventory_consumers where property_id=p_property for update;
 if not found or c.configuration_version<>expected_configuration or c.plan_version<>expected_plan
    or c.journal_version<>expected_journal then return false; end if;
 stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if fresh_until is null or fresh_until<=stamp or fresh_until>stamp+60000 then return false; end if;
 if expected_inputs is distinct from public.helm_booking_inventory_inputs(p_property) then return false; end if;
 command := next_journal->'commands'->(jsonb_array_length(next_journal->'commands')-1); payload := command->'intent';
 if c.configuration->>'environment' is distinct from 'staging' or c.configuration->>'topology' is distinct from 'single-unit'
    or command->>'kind' is distinct from 'enqueue' or jsonb_typeof(payload) is distinct from 'object'
    or payload - array['id','environment','connection','property','generation','version','days'] <> '{}'::jsonb
    or payload->>'environment' is distinct from 'staging'
    or payload->>'property' is distinct from p_property or payload->'connection' is distinct from c.configuration->'connection'
    or payload->'generation' is distinct from c.configuration->'generation'
    or payload->'version' is distinct from to_jsonb(expected_plan+1)
 then raise exception 'Planning identity mismatch'; end if;
 if desired_digest is null or desired_digest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid inventory digest'; end if;
 if jsonb_typeof(payload->'days') is distinct from 'array' then raise exception 'Invalid inventory days'; end if;
 if jsonb_array_length(payload->'days') <> (c.configuration->>'end')::date-(c.configuration->>'start')::date
    or jsonb_array_length(payload->'days') not between 1 and 500 then raise exception 'Incomplete inventory window'; end if;
 if exists(select 1 from jsonb_array_elements(payload->'days') with ordinality d(value,idx)
    where jsonb_typeof(value) is distinct from 'object' or not (value ?& array['date','available','stopSell'])
      or value - array['date','available','stopSell'] <> '{}'::jsonb
      or value->>'date' is distinct from (((c.configuration->>'start')::date+(idx-1)::integer)::text)
      or value->'available' not in ('0'::jsonb,'1'::jsonb)
      or value->'stopSell' is distinct from to_jsonb(value->'available'='0'::jsonb))
 then raise exception 'Invalid availability-only payload'; end if;
 if jsonb_typeof(c.configuration->'coverage') is distinct from 'array' then return false; end if;
 if jsonb_array_length(c.configuration->'coverage')=0 or exists(select 1 from jsonb_array_elements(c.configuration->'coverage') v
   where v->'complete' is distinct from 'true'::jsonb or (v->>'freshUntil') is null or (v->>'freshUntil')::bigint<fresh_until)
 then return false; end if;
 if not public.helm_booking_inventory_append_internal(p_property,expected_journal,next_journal) then return false; end if;
 update public.helm_booking_inventory_consumers set planned_capture_version=expected_capture,
  planned_configuration_version=expected_configuration,plan_version=expected_plan+1,planned_inputs=expected_inputs,
  last_digest=desired_digest,planned_fresh_until=fresh_until where property_id=p_property;
 return true;
end $$;
commit;
