-- Durable availability-only plans. This migration cannot publish to a provider,
-- activate capture/import, or change calendar authority. Install dormant.
begin;
set local lock_timeout = '5s';
create table helm_airbnb_bookings.inventory_scope (
 singleton boolean primary key default true check(singleton) references helm_airbnb_bookings.scope(singleton),
 enabled boolean not null default false,
 configuration_version bigint not null default 1 check(configuration_version between 1 and 9007199254740991),
 coverage jsonb not null default '[]' check(jsonb_typeof(coverage)='array'),
 head_version bigint not null default 0 check(head_version between 0 and 9007199254740991),
 fresh_until bigint not null default 0
);
create table helm_airbnb_bookings.inventory_plans (
 version bigint primary key check(version between 1 and 9007199254740991),
 id text not null unique check(id ~ '^[a-f0-9]{64}$'),
 capture_version bigint not null, configuration_version bigint not null,
 input_token text not null check(input_token ~ '^[a-f0-9]{64}$'),
 start_date date not null, end_date date not null check(end_date-start_date=500),
 digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 days jsonb not null check(jsonb_typeof(days)='array' and jsonb_array_length(days)=500),
 created_at timestamptz not null default clock_timestamp()
);
alter table helm_airbnb_bookings.inventory_scope enable row level security;
alter table helm_airbnb_bookings.inventory_plans enable row level security;
revoke all on helm_airbnb_bookings.inventory_scope,helm_airbnb_bookings.inventory_plans from public,anon,authenticated,service_role;
insert into helm_airbnb_bookings.inventory_scope(singleton) select singleton from helm_airbnb_bookings.scope where singleton;

create function helm_airbnb_bookings.inventory_configuration_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.singleton is distinct from old.singleton then raise exception 'inventory_identity_immutable'; end if;
 if (new.enabled,new.coverage) is distinct from (old.enabled,old.coverage) then
  new.configuration_version := old.configuration_version+1;
  new.fresh_until := 0;
 elsif new.configuration_version is distinct from old.configuration_version then
  raise exception 'inventory_configuration_version_managed';
 end if;
 return new;
end $$;
create trigger inventory_configuration_guard before update on helm_airbnb_bookings.inventory_scope
 for each row execute function helm_airbnb_bookings.inventory_configuration_guard();

-- Consistent SQL snapshot, including buffer neighbours. No guest identity,
-- messages, rates, minimum stays, financials or arbitrary JSON are returned.
-- One excess row is intentional: the application rejects truncation.
create function helm_airbnb_bookings.inventory_inputs(p_start date,p_end date)
returns jsonb language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('authority',p.calendar_authority,
  'plan',(select jsonb_build_object('advance_notice_hours',r.advance_notice_hours,
    'booking_window_days',r.booking_window_days,'turnover_buffer_days',r.turnover_buffer_days,
    'checkin_time',left(r.checkin_time::text,5)) from public.property_rate_plans r where r.property_id=p.id),
  'bookings',coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from (
    select id,status,check_in,check_out,duplicate_of,hold_kind,source,channel from public.bookings
    where property_id=p.id and check_in<p_end+30 and check_out>p_start-30 order by id limit 5001
   ) b),'[]'::jsonb),
  'rateDays',coalesce((select jsonb_agg(to_jsonb(r) order by r.date) from (
    select date,closed from public.property_rate_days where property_id=p.id and date>=p_start and date<p_end
    order by date limit 501) r),'[]'::jsonb),
  'periods',coalesce((select jsonb_agg(jsonb_build_object('startMonth',r.start_month,'startDay',r.start_day,
    'endMonth',r.end_month,'endDay',r.end_day) order by r.start_month,r.start_day,r.end_month,r.end_day) from (
    select start_month,start_day,end_month,end_day from public.property_rental_periods where property_id=p.id
    order by start_month,start_day,end_month,end_day limit 1001) r),'[]'::jsonb)
 ) from public.properties p where p.id='65_calderwood';
$$;
create function public.helm_channex_inventory_read()
returns jsonb language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 with bounds as (select (statement_timestamp() at time zone 'America/New_York')::date as start),
 state as (select s.*,c.enabled capture_enabled,c.version capture_version,
   i.enabled planning_enabled,i.configuration_version,i.coverage,i.head_version,b.start,b.start+500 as finish,
   case when i.enabled then helm_airbnb_bookings.inventory_inputs(b.start,b.start+500) end inputs
  from helm_airbnb_bookings.scope s join helm_airbnb_bookings.inventory_scope i using(singleton)
  join public.helm_inventory_capture_scopes c on c.property_id=s.property_id cross join bounds b where s.singleton)
 select case when not planning_enabled then jsonb_build_object('status','disabled') else jsonb_build_object(
  'propertyId',property_id,'remotePropertyId',remote_property,'roomTypeId',room_type,'ratePlanId',rate_plan,
  'environment',environment,'generation',generation,'timeZone','America/New_York',
  'planningEnabled',planning_enabled,'importEnabled',enabled,'captureEnabled',capture_enabled,'captureVersion',capture_version,
  'configurationVersion',configuration_version,'headVersion',head_version,
  'start',start::text,'end',finish::text,'observedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
  'inputToken',encode(sha256(convert_to(inputs::text,'UTF8')),'hex'),
  'requiredSources',jsonb_build_array('canonical-calendar','channex-bookings'),'coverage',coverage,'inputs',inputs) end from state;
$$;

-- Service-only CAS. No dispatch RPC is installed. A later transport must check
-- the head, all versions, source coverage and clock again before any network IO.
create function public.helm_channex_inventory_plan_commit(p_expected jsonb,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare c public.helm_inventory_capture_scopes; i helm_airbnb_bookings.inventory_scope;
 s helm_airbnb_bookings.scope; previous helm_airbnb_bookings.inventory_plans;
 inputs jsonb; token text; stamp bigint; today date; finish date; fresh bigint;
 buffer_days int; actual_digest text; actual_id text; deadline bigint; v jsonb; wanted_version bigint;
begin
 if jsonb_typeof(p_expected) is distinct from 'object' or not(p_expected ?& array['captureVersion','configurationVersion','headVersion','inputToken'])
  or p_expected-array['captureVersion','configurationVersion','headVersion','inputToken']<>'{}'::jsonb
  or jsonb_typeof(p_plan) is distinct from 'object' or not(p_plan ?& array['id','digest','start','end','freshUntil','days'])
  or p_plan-array['id','digest','start','end','freshUntil','days']<>'{}'::jsonb then raise exception 'invalid_inventory_plan'; end if;
 for v in select value from jsonb_each(p_expected) where key<>'inputToken' loop
  if jsonb_typeof(v) is distinct from 'number' or v::text!~'^\d+$' or v::numeric>9007199254740991
  then raise exception 'invalid_inventory_expectation'; end if;
 end loop;
 if p_expected->>'inputToken'!~'^[a-f0-9]{64}$' or p_plan->>'id'!~'^[a-f0-9]{64}$'
  or p_plan->>'digest'!~'^[a-f0-9]{64}$' or jsonb_typeof(p_plan->'freshUntil') is distinct from 'number'
  or (p_plan->'freshUntil')::text!~'^\d+$' then raise exception 'invalid_inventory_identity'; end if;
 -- No booking row or advisory locks are taken: canonical writers may finish and
 -- then invalidate this checkpoint atomically, without a reverse lock dependency.
 select * into c from public.helm_inventory_capture_scopes where property_id='65_calderwood' for share;
 select * into i from helm_airbnb_bookings.inventory_scope where singleton for update;
 if not found then raise exception 'inventory_storage_missing'; end if;
 select * into s from helm_airbnb_bookings.scope where singleton;
 if not i.enabled or not c.enabled or not s.enabled or c.version is distinct from (p_expected->>'captureVersion')::bigint
  or i.configuration_version is distinct from (p_expected->>'configurationVersion')::bigint
  or s.property_id is distinct from '65_calderwood' or s.environment is distinct from 'production' or s.generation is distinct from 1
  or s.remote_property is distinct from '320c5cb5-91e0-46af-b9b3-a3fc20b4631e'::uuid
  or s.room_type is distinct from 'e8673d84-4bea-48b1-a160-214b016a8c05'::uuid
  or s.rate_plan is distinct from 'ce53790a-7b7d-4cec-91a6-a128589f9dd2'::uuid
 then return jsonb_build_object('status','superseded','version',i.head_version); end if;
 stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
 today := (clock_timestamp() at time zone 'America/New_York')::date; finish := today+500;
 fresh := (p_plan->>'freshUntil')::bigint;
 if p_plan->>'start' is distinct from today::text or p_plan->>'end' is distinct from finish::text
  or fresh<=stamp or fresh>stamp+60000 then return jsonb_build_object('status','superseded','version',i.head_version); end if;
 inputs := helm_airbnb_bookings.inventory_inputs(today,finish);
 token := encode(sha256(convert_to(inputs::text,'UTF8')),'hex');
 if token is distinct from (p_expected->>'inputToken') or inputs->>'authority' is distinct from 'helm'
  or inputs->'plan'->'booking_window_days' is distinct from '365'::jsonb
  or jsonb_array_length(inputs->'bookings')>5000 or jsonb_array_length(inputs->'rateDays')>500
  or jsonb_array_length(inputs->'periods')>1000
 then return jsonb_build_object('status','superseded','version',i.head_version); end if;
 buffer_days := (inputs->'plan'->>'turnover_buffer_days')::int;
 if buffer_days is null or buffer_days not between 0 and 30 or jsonb_array_length(i.coverage)<>2
  or (select count(distinct value->>'source') from jsonb_array_elements(i.coverage))<>2
 then return jsonb_build_object('status','superseded','version',i.head_version); end if;
 for v in select value from jsonb_array_elements(i.coverage) loop
  if jsonb_typeof(v) is distinct from 'object' or not(v ?& array['source','start','end','complete','observedAt','freshUntil'])
   or v-array['source','start','end','complete','observedAt','freshUntil']<>'{}'::jsonb
   or v->>'source' is null or v->>'source' not in ('canonical-calendar','channex-bookings')
   or v->'complete' is distinct from 'true'::jsonb or v->>'start' is null or v->>'end' is null
   or v->>'observedAt' is null or v->>'freshUntil' is null
   or (v->>'start')::date>today-buffer_days or (v->>'end')::date<finish+buffer_days
   or (v->>'end')::date-(v->>'start')::date not between 1 and 560
   or (v->>'observedAt')::bigint<0 or (v->>'observedAt')::bigint>stamp or (v->>'freshUntil')::bigint<fresh
   or (v->>'freshUntil')::bigint-(v->>'observedAt')::bigint not between 1 and 3600000
  then return jsonb_build_object('status','superseded','version',i.head_version); end if;
 end loop;
 -- A date can close merely because a notice boundary or Eastern midnight passes.
 deadline := floor(extract(epoch from ((today+1)::timestamp at time zone 'America/New_York'))*1000)::bigint;
 select least(deadline,coalesce(min(boundary),deadline)) into deadline from (
  select floor(extract(epoch from ((today+n+(inputs->'plan'->>'checkin_time')::time) at time zone 'America/New_York'))*1000)::bigint
   -(inputs->'plan'->>'advance_notice_hours')::bigint*3600000+1 as boundary
  from generate_series(0,499) n) times where boundary>stamp;
 if fresh>deadline then return jsonb_build_object('status','superseded','version',i.head_version); end if;
 if jsonb_typeof(p_plan->'days') is distinct from 'array' or jsonb_array_length(p_plan->'days')<>500
 then raise exception 'incomplete_inventory_window'; end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'days') with ordinality d(value,idx)
  where jsonb_typeof(value) is distinct from 'object' or not(value ?& array['date','available'])
   or value-array['date','available']<>'{}'::jsonb or value->>'date' is distinct from (today+(idx-1)::int)::text
   or value->'available' is null or value->'available' not in ('0'::jsonb,'1'::jsonb))
 then raise exception 'invalid_availability_only_payload'; end if;
 select encode(sha256(convert_to(string_agg((value->>'date')||':'||(value->>'available')||E'\n','' order by idx),'UTF8')),'hex')
 into actual_digest from jsonb_array_elements(p_plan->'days') with ordinality d(value,idx);
 actual_id := encode(sha256(convert_to(concat_ws('|',s.property_id,s.remote_property,s.room_type,s.rate_plan,s.generation,
  c.version,i.configuration_version,today,finish,actual_digest),'UTF8')),'hex');
 if actual_digest is distinct from (p_plan->>'digest') or actual_id is distinct from (p_plan->>'id') then raise exception 'inventory_digest_mismatch'; end if;
 select * into previous from helm_airbnb_bookings.inventory_plans where version=i.head_version;
 if found and previous.id=actual_id then
  if previous.input_token<>token or previous.days<>p_plan->'days' then raise exception 'inventory_identity_conflict'; end if;
  if fresh>i.fresh_until then
   update helm_airbnb_bookings.inventory_scope set fresh_until=fresh where singleton;
   return jsonb_build_object('status','refreshed','version',i.head_version);
  end if;
  return jsonb_build_object('status','unchanged','version',i.head_version);
 end if;
 if i.head_version is distinct from (p_expected->>'headVersion')::bigint or i.head_version>=9007199254740991
 then return jsonb_build_object('status','superseded','version',i.head_version); end if;
 wanted_version := i.head_version+1;
 insert into helm_airbnb_bookings.inventory_plans(version,id,capture_version,configuration_version,input_token,start_date,end_date,digest,days)
 values(wanted_version,actual_id,c.version,i.configuration_version,token,today,finish,actual_digest,p_plan->'days');
 update helm_airbnb_bookings.inventory_scope set head_version=wanted_version,fresh_until=fresh where singleton;
 return jsonb_build_object('status','stored','version',wanted_version);
end $$;
create function public.helm_channex_inventory_status()
returns jsonb language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('format',1,'planningEnabled',i.enabled,'publishingEnabled',false,
  'headVersion',i.head_version,'plans',(select count(*) from helm_airbnb_bookings.inventory_plans),
  'coverageSources',jsonb_array_length(i.coverage),'maxDays',500)
 from helm_airbnb_bookings.inventory_scope i where singleton;
$$;
revoke all on function helm_airbnb_bookings.inventory_configuration_guard(),helm_airbnb_bookings.inventory_inputs(date,date),
 public.helm_channex_inventory_read(),public.helm_channex_inventory_plan_commit(jsonb,jsonb),public.helm_channex_inventory_status()
 from public,anon,authenticated,service_role;
grant execute on function public.helm_channex_inventory_read(),public.helm_channex_inventory_plan_commit(jsonb,jsonb),
 public.helm_channex_inventory_status() to service_role;
commit;
