-- Candidate only. Requires booking-inventory-planning.sql. No enablement/seed.
-- Trusted worker replays the journal and refuses unresolved attempts before
-- calling this CAS boundary, as for the existing journal transitions. SQL
-- independently binds that replay to unchanged captured inputs and history.
begin;
create or replace function public.helm_booking_inventory_window_advance(
 p_property text, expected_capture bigint, expected_configuration bigint,
 expected_plan bigint, expected_journal bigint, expected_inputs jsonb,
 next_start date, next_end date, next_journal jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.helm_inventory_capture_scopes; c public.helm_booking_inventory_consumers;
 stamp bigint; today date; cfg jsonb; cover jsonb; buffer_days integer; command jsonb;
begin
 -- The only installed pilot route, never a general production window editor.
 if p_property is distinct from 'HELMTEST-calderwood' then return false; end if;
 select * into s from public.helm_inventory_capture_scopes where property_id=p_property for share;
 if not found or not s.enabled or s.version is distinct from expected_capture or s.version<1 then return false; end if;
 select * into c from public.helm_booking_inventory_consumers where property_id=p_property for update;
 if not found or c.configuration_version is distinct from expected_configuration
   or c.plan_version is distinct from expected_plan or c.journal_version is distinct from expected_journal
   or expected_inputs is distinct from public.helm_booking_inventory_inputs(p_property) then return false; end if;
 cfg := c.configuration;
 stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
 today := (clock_timestamp() at time zone 'America/New_York')::date;
 if cfg->>'environment' is distinct from 'staging' or cfg->>'topology' is distinct from 'single-unit'
   or cfg->>'connection' is distinct from 'calderwood-hosted-inventory'
   or cfg->>'listing' is distinct from 'f795ae2c-f47d-4751-86ff-e883b6d30800'
   or cfg->'generation' is distinct from '1'::jsonb or cfg->'publishEnabled' is distinct from 'true'::jsonb
   or cfg->>'timeZone' is distinct from 'America/New_York'
   or expected_inputs->>'authority' is distinct from 'helm'
   or expected_inputs->'plan'->'booking_window_days' is distinct from '365'::jsonb
   or next_start is distinct from today or next_end is distinct from today+366
   or (cfg->>'start')::date is distinct from today-1 or (cfg->>'end')::date is distinct from today+365
   or cfg->'requiredSources' is null or cfg->'requiredSources' not in ('["synthetic-canonical"]'::jsonb,'["channex-staging-bookings"]'::jsonb)
   or jsonb_typeof(cfg->'coverage') is distinct from 'array' then return false; end if;
 if jsonb_array_length(cfg->'coverage')<>1 then return false; end if;
 cover := cfg->'coverage'->0;
 buffer_days := (expected_inputs->'plan'->>'turnover_buffer_days')::integer;
 if buffer_days is null or buffer_days not between 0 and 30
   or cover->>'source' is distinct from (cfg->'requiredSources'->>0) or cover->'complete' is distinct from 'true'::jsonb
   or (cover->>'start') is null or (cover->>'end') is null
   or (cover->>'start')::date > today-buffer_days or (cover->>'end')::date < next_end+buffer_days
   or (cover->>'end')::date-(cover->>'start')::date not between 1 and 426
   or (cover->>'observedAt') is null or (cover->>'freshUntil') is null
   or (cover->>'observedAt')::bigint>stamp or (cover->>'freshUntil')::bigint<=stamp
   or (cover->>'freshUntil')::bigint-(cover->>'observedAt')::bigint not between 1 and 3600000
 then return false; end if;
 command := next_journal->'commands'->(expected_journal::integer);
 if command is distinct from jsonb_build_object('kind','retire-pending','connection',cfg->>'connection',
     'property',p_property,'generation',cfg->'generation') then raise exception 'Invalid window retirement'; end if;
 if not public.helm_booking_inventory_append_internal(p_property,expected_journal,next_journal) then return false; end if;
 -- Both history and window commit together. The existing guard increments the
 -- configuration version, invalidating every old plan/dispatch context.
 update public.helm_booking_inventory_consumers
 set configuration=jsonb_set(jsonb_set(configuration,'{start}',to_jsonb(next_start::text)),'{end}',to_jsonb(next_end::text))
 where property_id=p_property;
 return true;
end $$;
revoke all on function public.helm_booking_inventory_window_advance(text,bigint,bigint,bigint,bigint,jsonb,date,date,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.helm_booking_inventory_window_advance(text,bigint,bigint,bigint,bigint,jsonb,date,date,jsonb) to service_role;
commit;
