-- Production-only dormant mapping. Inserts never activate a consumer or change authority.
begin;
set local lock_timeout = '5s';
insert into public.helm_inventory_capture_scopes(property_id,enabled)
select id,false from public.properties where id='65_calderwood'
on conflict(property_id) do nothing;
insert into helm_airbnb_bookings.scope(singleton,property_id,environment,remote_property,room_type,rate_plan,generation,enabled)
select true,id,'production','320c5cb5-91e0-46af-b9b3-a3fc20b4631e',
 'e8673d84-4bea-48b1-a160-214b016a8c05','ce53790a-7b7d-4cec-91a6-a128589f9dd2',1,false
from public.properties where id='65_calderwood'
on conflict(singleton) do nothing;

create table helm_airbnb_bookings.runtime_status (
 singleton boolean primary key default true check(singleton),
 last_attempt_at timestamptz not null, last_success_at timestamptz,
 code text not null, consecutive_failures integer not null default 0 check(consecutive_failures>=0)
);
alter table helm_airbnb_bookings.runtime_status enable row level security;
revoke all on helm_airbnb_bookings.runtime_status from public,anon,authenticated,service_role;

create function public.helm_channex_storage_status()
returns jsonb language sql security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('propertyId',s.property_id,'environment',s.environment,
  'remotePropertyId',s.remote_property,'roomTypeId',s.room_type,'ratePlanId',s.rate_plan,
  'generation',s.generation,'importEnabled',s.enabled,'captureEnabled',c.enabled,
  'calendarAuthority',p.calendar_authority,
  'receipts',(select count(*) from helm_airbnb_bookings.receipts),
  'inventoryEvents',(select count(*) from public.helm_booking_inventory_events where property_id=s.property_id))
 from helm_airbnb_bookings.scope s join public.properties p on p.id=s.property_id
 join public.helm_inventory_capture_scopes c on c.property_id=s.property_id where s.singleton;
$$;
create function public.helm_channex_runtime_checkpoint(p_ok boolean,p_code text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if p_ok is null or p_code is null or
 p_code not in ('OK','STORAGE_NOT_READY','PROVIDER_CHECK_FAILED','CREDENTIAL_REQUIRED',
 'ACCESS_DENIED','PROVIDER_UNAVAILABLE','INVALID_RESPONSE','MAPPING_MISMATCH','RATE_NOT_CLOSED','CHANNELS_PRESENT')
 or p_ok is distinct from (p_code='OK') then raise exception 'invalid_runtime_checkpoint'; end if;
 insert into helm_airbnb_bookings.runtime_status(singleton,last_attempt_at,last_success_at,code,consecutive_failures)
 values(true,clock_timestamp(),case when p_ok then clock_timestamp() end,p_code,case when p_ok then 0 else 1 end)
 on conflict(singleton) do update set last_attempt_at=clock_timestamp(),code=p_code,
 last_success_at=case when p_ok then clock_timestamp() else helm_airbnb_bookings.runtime_status.last_success_at end,
 consecutive_failures=case when p_ok then 0 else least(helm_airbnb_bookings.runtime_status.consecutive_failures::bigint+1,2147483647)::int end;
 return true;
end $$;
create function public.helm_channex_runtime_status()
returns jsonb language sql security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('lastAttemptAt',last_attempt_at,'lastSuccessAt',last_success_at,
 'code',code,'consecutiveFailures',consecutive_failures)
 from helm_airbnb_bookings.runtime_status where singleton;
$$;
revoke all on function public.helm_channex_storage_status(),
 public.helm_channex_runtime_checkpoint(boolean,text),public.helm_channex_runtime_status()
 from public,anon,authenticated;
grant execute on function public.helm_channex_storage_status(),
 public.helm_channex_runtime_checkpoint(boolean,text),public.helm_channex_runtime_status()
 to service_role;
commit;
