-- Prospective comparison evidence only. No rate writes or activation by migration.
create table public.property_pricing_tracking (
  property_id text primary key references public.property_pricing_profiles(property_id),
  enabled boolean not null default false, version integer not null default 1 check(version>0),
  updated_at timestamptz not null default now(), updated_by text not null
);
create table public.property_pricing_observations (
  id uuid primary key default gen_random_uuid(), property_id text not null references public.properties(id),
  capture_key text not null check(length(capture_key) between 1 and 100),
  data jsonb not null, recorded_at timestamptz not null default clock_timestamp(), recorded_by text not null,
  unique(property_id,capture_key),
  check(data->>'propertyId'=property_id), check(jsonb_typeof(data->'days')='array')
);
create index on public.property_pricing_observations(property_id,recorded_at desc);
alter table public.property_pricing_tracking enable row level security;
alter table public.property_pricing_observations enable row level security;
revoke all on public.property_pricing_tracking, public.property_pricing_observations from public,anon,authenticated,service_role;
grant select,insert,update on public.property_pricing_tracking to service_role;
grant select,insert on public.property_pricing_observations to service_role;

create function public.helm_set_pricing_tracking(p_property text,p_enabled boolean,p_expected integer,p_actor text)
returns public.property_pricing_tracking language plpgsql security invoker set search_path=public,pg_temp as $$
declare result public.property_pricing_tracking;
begin
  perform set_config('lock_timeout','3s',true);
  perform pg_advisory_xact_lock(hashtext('helm_pricing:'||p_property));
  if not exists(select 1 from properties join property_pricing_profiles on property_id=id where id=p_property and is_active)
    then raise exception 'Save a policy for an active property first';end if;
  select * into result from property_pricing_tracking where property_id=p_property for update;
  if coalesce(result.version,0) is distinct from p_expected then raise exception 'Tracking changed; reload';end if;
  insert into property_pricing_tracking(property_id,enabled,version,updated_by)
    values(p_property,p_enabled,coalesce(result.version,0)+1,p_actor)
    on conflict(property_id) do update set enabled=excluded.enabled,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp()
    returning * into result;
  return result;
end $$;

create function public.helm_record_pricing_observation(p_property text,p_key text,p_data jsonb,p_context jsonb,p_tracking_version integer,p_actor text)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare result uuid; start_date date; stamp timestamptz; profile_version integer;
begin
  perform set_config('lock_timeout','3s',true);
  perform pg_advisory_xact_lock(hashtext('helm_pricing:'||p_property));
  select id into result from property_pricing_observations where property_id=p_property and capture_key=p_key;
  if found then return result;end if;
  if p_key is null or p_key !~ '^(manual:[0-9a-f-]{36}|daily:[0-9]{4}-[0-9]{2}-[0-9]{2})$' then raise exception 'Invalid capture key';end if;
  if p_data->>'version' is distinct from '1' or p_data->>'propertyId' is distinct from p_property
    or jsonb_typeof(p_data->'days') is distinct from 'array' then raise exception 'Invalid observation';end if;
  start_date:=(p_data->>'asOf')::date; stamp:=(p_data->>'capturedAt')::timestamptz;
  if start_date is null or stamp is null or stamp<clock_timestamp()-interval '2 minutes' or stamp>clock_timestamp()+interval '30 seconds'
    then raise exception 'Observation expired; capture again';end if;
  if p_key like 'daily:%' and (p_key<>'daily:'||start_date::text or p_tracking_version is null) then raise exception 'Daily tracking version required';end if;
  if p_tracking_version is not null and not exists(select 1 from property_pricing_tracking where property_id=p_property and enabled and version=p_tracking_version)
    then raise exception 'Daily tracking changed';end if;
  if not exists(select 1 from properties where id=p_property and is_active
    and calendar_authority=p_data->>'authority' and start_date=(stamp at time zone coalesce(timezone,'America/New_York'))::date)
    then raise exception 'Observation authority or date changed';end if;
  select version into profile_version from property_pricing_profiles where property_id=p_property;
  if profile_version is null or profile_version is distinct from (p_data->>'policyVersion')::integer then raise exception 'Policy changed; capture again';end if;
  if coalesce((p_context->'evidence'->>'version')::integer,0) is distinct from (p_data->>'evidenceVersion')::integer then raise exception 'Evidence version mismatch';end if;
  if jsonb_array_length(p_data->'days')<>180 or
    (select count(distinct d->>'date') from jsonb_array_elements(p_data->'days') d)<>180 or
    exists(select 1 from jsonb_array_elements(p_data->'days') d where (d->>'date') is null or (d->>'date')::date not between start_date and start_date+179)
    then raise exception 'Complete 180-night observation required';end if;
  if p_context is null or p_context is distinct from helm_pricing_context(p_property,start_date,start_date+179)
    then raise exception 'Calendar changed; capture again';end if;
  insert into property_pricing_observations(property_id,capture_key,data,recorded_by) values(p_property,p_key,p_data,p_actor) returning id into result;
  return result;
end $$;
revoke all on function public.helm_set_pricing_tracking(text,boolean,integer,text),public.helm_record_pricing_observation(text,text,jsonb,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.helm_set_pricing_tracking(text,boolean,integer,text),public.helm_record_pricing_observation(text,text,jsonb,jsonb,integer,text) to service_role;
