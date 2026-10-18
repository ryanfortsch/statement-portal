-- Candidate only, NOT an automatic migration. Requires booking-inventory-events.sql
-- and the canonical booking/rate/season tables. No seeded route or provider calls.
-- Reviewed single-unit staging routes only. No linked-resource inference.
begin;
create table if not exists public.helm_booking_inventory_consumers (
 property_id text primary key references public.helm_inventory_capture_scopes(property_id),
 configuration_version bigint not null default 1 check(configuration_version between 1 and 9007199254740991),
 configuration jsonb not null check(jsonb_typeof(configuration)='object'),
 planned_capture_version bigint not null default 0,
 planned_configuration_version bigint not null default 0,
 plan_version bigint not null default 0 check(plan_version between 0 and 9007199254740991),
 journal_version bigint not null default 0 check(journal_version between 0 and 10000),
 journal jsonb not null default '{"format":1,"commands":[]}',
 planned_inputs jsonb,
 last_digest text,
 planned_fresh_until bigint not null default 0,
 check(planned_capture_version between 0 and 9007199254740991),
 check(planned_configuration_version between 0 and configuration_version)
);
alter table public.helm_booking_inventory_consumers enable row level security;
revoke all on public.helm_booking_inventory_consumers from public,anon,authenticated,service_role;
grant select on public.helm_booking_inventory_consumers to service_role;
drop policy if exists service_read on public.helm_booking_inventory_consumers;
create policy service_read on public.helm_booking_inventory_consumers for select to service_role using(true);

create or replace function public.helm_booking_inventory_configuration_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.property_id is distinct from old.property_id then raise exception 'Inventory consumer identity is immutable'; end if;
 if new.configuration is distinct from old.configuration then
  if new.configuration->'connection' is distinct from old.configuration->'connection'
     or new.configuration->'listing' is distinct from old.configuration->'listing'
  then raise exception 'Mapping change requires reviewed rollover'; end if;
  if (new.configuration->>'generation')::bigint < (old.configuration->>'generation')::bigint
  then raise exception 'Generation cannot regress'; end if;
  new.configuration_version := old.configuration_version + 1;
 elsif new.configuration_version is distinct from old.configuration_version then
  raise exception 'Configuration version is managed by the guard';
 end if;
 return new;
end $$;
drop trigger if exists helm_booking_inventory_configuration_guard on public.helm_booking_inventory_consumers;
create trigger helm_booking_inventory_configuration_guard before update on public.helm_booking_inventory_consumers
 for each row execute function public.helm_booking_inventory_configuration_guard();

-- One SQL snapshot. Explicit projection excludes guest fields, prices, minimum
-- stays, notes, keys and other private payloads. Load buffer neighbours too.
-- A 5001st booking / 1001st season row makes the TypeScript parser refuse the
-- result instead of treating truncation as an empty or complete calendar.
create or replace function public.helm_booking_inventory_inputs(p_property text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'authority',p.calendar_authority,
  'plan',(select jsonb_build_object('advance_notice_hours',r.advance_notice_hours,
    'booking_window_days',r.booking_window_days,'turnover_buffer_days',r.turnover_buffer_days,'checkin_time',r.checkin_time)
    from public.property_rate_plans r where r.property_id=p.id),
  'bookings',coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from (
    select id,status,check_in,check_out,duplicate_of,hold_kind,source,channel from public.bookings
    where property_id=p.id and check_in < (c.configuration->>'end')::date + 30
      and check_out > (c.configuration->>'start')::date - 30 order by id limit 5001
   ) b),'[]'::jsonb),
  'rateDays',coalesce((select jsonb_agg(jsonb_build_object('date',r.date,'closed',r.closed) order by r.date)
    from (select date,closed from public.property_rate_days where property_id=p.id and date >= (c.configuration->>'start')::date
      and date < (c.configuration->>'end')::date order by date limit 367) r),'[]'::jsonb),
  'periods',coalesce((select jsonb_agg(jsonb_build_object('startMonth',r.start_month,'startDay',r.start_day,
    'endMonth',r.end_month,'endDay',r.end_day) order by r.start_month,r.start_day,r.end_month,r.end_day) from (
     select start_month,start_day,end_month,end_day from public.property_rental_periods where property_id=p.id
     order by start_month,start_day,end_month,end_day limit 1001) r),'[]'::jsonb)
 ) from public.properties p join public.helm_booking_inventory_consumers c on c.property_id=p.id where p.id=p_property;
$$;
create or replace function public.helm_booking_inventory_read(p_property text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('property',c.property_id,'captureEnabled',s.enabled,'captureVersion',s.version,
   'configurationVersion',c.configuration_version,'configuration',c.configuration,
   'plannedCaptureVersion',c.planned_capture_version,'plannedConfigurationVersion',c.planned_configuration_version,
   'planVersion',c.plan_version,'journalVersion',c.journal_version,'journal',c.journal,
   'lastDigest',c.last_digest,'plannedFreshUntil',c.planned_fresh_until,
   'inputsMatchPlan',coalesce(c.planned_inputs=public.helm_booking_inventory_inputs(c.property_id),false),
   'inputs',public.helm_booking_inventory_inputs(c.property_id))
 from public.helm_booking_inventory_consumers c join public.helm_inventory_capture_scopes s using(property_id)
 where c.property_id=p_property;
$$;

-- Private append primitive. Trusted TS replays the complete state machine first.
-- SQL independently enforces exact history prefix and a single appended command.
create or replace function public.helm_booking_inventory_append_internal(p_property text,expected_journal bigint,next_journal jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
 select journal into prior from public.helm_booking_inventory_consumers
 where property_id=p_property and journal_version=expected_journal for update;
 if not found then return false; end if;
 if next_journal->'format' is distinct from '1'::jsonb or jsonb_typeof(next_journal->'commands') is distinct from 'array'
 then raise exception 'Invalid inventory journal'; end if;
 if jsonb_array_length(next_journal->'commands') <> expected_journal+1 or expected_journal>=10000
 then raise exception 'Expected one appended command'; end if;
 if exists(select 1 from jsonb_array_elements(prior->'commands') with ordinality e(value,idx)
   where next_journal->'commands'->((idx-1)::integer) is distinct from value)
 then raise exception 'Inventory history rewrite refused'; end if;
 update public.helm_booking_inventory_consumers set journal_version=journal_version+1,journal=next_journal where property_id=p_property;
 return true;
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
 command := next_journal->'commands'->(expected_journal::integer); payload := command->'intent';
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
    or jsonb_array_length(payload->'days') not between 1 and 366 then raise exception 'Incomplete inventory window'; end if;
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

create or replace function public.helm_booking_inventory_journal_append(p_property text,expected_journal bigint,next_journal jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.helm_booking_inventory_consumers; s public.helm_inventory_capture_scopes; command jsonb; ctx jsonb; stamp bigint;
begin
 select * into s from public.helm_inventory_capture_scopes where property_id=p_property for share;
 if not found then return false; end if;
 select * into c from public.helm_booking_inventory_consumers where property_id=p_property for update;
 if not found or c.journal_version<>expected_journal then return false; end if;
 command := next_journal->'commands'->(expected_journal::integer);
 if command->>'kind' is null or command->>'kind' not in ('claim','dispatch','accepted','ambiguous','rejected','expire','reconcile')
 then raise exception 'Use the atomic planning boundary for enqueue'; end if;
 if command->>'kind'='dispatch' then
  ctx := command->'context'; stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if not s.enabled or s.version<>c.planned_capture_version or c.configuration_version<>c.planned_configuration_version
     or c.planned_fresh_until<=stamp or c.planned_inputs is distinct from public.helm_booking_inventory_inputs(p_property)
     or c.configuration->'publishEnabled' is distinct from 'true'::jsonb
     or c.planned_inputs->>'authority' is distinct from 'helm'
     or ctx->>'environment' is distinct from 'staging' or ctx->>'property' is distinct from p_property
     or ctx->'connection' is distinct from c.configuration->'connection' or ctx->'generation' is distinct from c.configuration->'generation'
     or ctx->'version' is distinct from to_jsonb(c.plan_version) or ctx->>'digest' is distinct from c.last_digest
     or ctx->>'authority' is distinct from 'helm' or ctx->'enabled' is distinct from 'true'::jsonb
     or ctx->'complete' is distinct from 'true'::jsonb or (ctx->>'freshUntil') is null
     or (ctx->>'freshUntil')::bigint<=stamp or (ctx->>'freshUntil')::bigint>c.planned_fresh_until
  then return false; end if;
 end if;
 return public.helm_booking_inventory_append_internal(p_property,expected_journal,next_journal);
end $$;
revoke all on function public.helm_booking_inventory_configuration_guard(), public.helm_booking_inventory_inputs(text),
 public.helm_booking_inventory_read(text), public.helm_booking_inventory_append_internal(text,bigint,jsonb),
 public.helm_booking_inventory_plan_commit(text,bigint,bigint,bigint,bigint,jsonb,jsonb,bigint,text),
 public.helm_booking_inventory_journal_append(text,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.helm_booking_inventory_read(text),
 public.helm_booking_inventory_plan_commit(text,bigint,bigint,bigint,bigint,jsonb,jsonb,bigint,text),
 public.helm_booking_inventory_journal_append(text,bigint,jsonb) to service_role;
commit;
