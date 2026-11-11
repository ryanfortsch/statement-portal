-- Channex support confirmed successful POST /availability means provider acceptance.
-- No supported PMS task-completion API exists. Preserve that distinction: a clean
-- accepted receipt permits a later fresh absolute plan; uncertainty still blocks.
-- No activation, timeout retry, task polling or channel-delivery attestation.
begin;
set local lock_timeout = '5s';
-- Install only on a dormant, empty transport. Preserve all existing gate values.
do $$begin
 perform 1 from helm_airbnb_bookings.scope where singleton for update;
 perform 1 from public.helm_inventory_capture_scopes where property_id='65_calderwood' for share;
 perform 1 from helm_airbnb_bookings.inventory_scope where singleton for update;
 perform 1 from helm_airbnb_bookings.delivery_scope where singleton for update;
 if exists(select 1 from helm_airbnb_bookings.scope where enabled)
  or exists(select 1 from public.helm_inventory_capture_scopes where property_id='65_calderwood' and enabled)
  or exists(select 1 from helm_airbnb_bookings.inventory_scope where enabled)
  or exists(select 1 from helm_airbnb_bookings.delivery_scope where enabled)
  or exists(select 1 from helm_airbnb_bookings.delivery_attempts)
 then raise exception 'disable_empty_channex_delivery_before_migration'; end if;
end $$;
-- An accepted response remains immutable history. Only unresolved transport
-- attempts exclude concurrent workers. OTA delivery remains unverified.
drop index helm_airbnb_bookings.delivery_one_unresolved;
create unique index delivery_one_unresolved on helm_airbnb_bookings.delivery_attempts ((true))
 where state in ('leased','submitting','uncertain');
create index delivery_accepted_plan on helm_airbnb_bookings.delivery_attempts(plan_version) where state='accepted';

create or replace function public.helm_channex_delivery_claim(p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare d helm_airbnb_bookings.delivery_scope; i helm_airbnb_bookings.inventory_scope;
 a helm_airbnb_bookings.delivery_attempts; p helm_airbnb_bookings.inventory_plans;
 stamp bigint; body text; fresh boolean:=false;
begin
 if p_token is null then raise exception 'delivery_token_required'; end if;
 perform 1 from public.helm_inventory_capture_scopes where property_id='65_calderwood' for share;
 select * into i from helm_airbnb_bookings.inventory_scope where singleton for update;
 select * into d from helm_airbnb_bookings.delivery_scope where singleton for update;
 if not found then raise exception 'delivery_storage_missing'; end if;
 if not d.enabled then return jsonb_build_object('status','disabled'); end if;
 stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 -- Before the IO barrier a lease is safe to retire. After it, an expired worker
 -- might still have submitted its request. Never free that lane automatically.
 update helm_airbnb_bookings.delivery_attempts set state='expired' where state='leased' and expires_at<=stamp;
 update helm_airbnb_bookings.delivery_attempts set state='uncertain' where state='submitting' and expires_at<=stamp;
 select * into a from helm_airbnb_bookings.delivery_attempts where token=p_token;
 if found then
  -- A durable acceptance is an idempotent result, never a new send permit.
  -- Old tokens cannot replay a plan after the head or source has changed.
  if a.state='accepted' and helm_airbnb_bookings.delivery_plan_current(a.plan_version)
  then return jsonb_build_object('status','already-accepted'); end if;
  if a.state<>'leased' or a.scope_version<>d.version or not helm_airbnb_bookings.delivery_plan_current(a.plan_version)
  then return jsonb_build_object('status','blocked'); end if;
 else
  if exists(select 1 from helm_airbnb_bookings.delivery_attempts
    where state in ('leased','submitting','uncertain') or
      (outcome->>'kind'='unauthorized' and scope_version=d.version))
  then return jsonb_build_object('status','blocked'); end if;
  if not helm_airbnb_bookings.delivery_plan_current(i.head_version) then return jsonb_build_object('status','stale'); end if;
  -- Successful POST means accepted into Channex, not delivered to an OTA.
  -- Deduplicate the exact current plan before consuming another rate-limit slot.
  if exists(select 1 from helm_airbnb_bookings.delivery_attempts
    where state='accepted' and plan_version=i.head_version)
  then return jsonb_build_object('status','already-accepted'); end if;
  if d.next_attempt_at>clock_timestamp()
   or (select count(*) from helm_airbnb_bookings.delivery_attempts where created_at>clock_timestamp()-interval '30 minutes')>=5
  then return jsonb_build_object('status','blocked'); end if;
  select * into p from helm_airbnb_bookings.inventory_plans where version=i.head_version;
  select jsonb_build_object('values',jsonb_agg(jsonb_build_object(
   'property_id','320c5cb5-91e0-46af-b9b3-a3fc20b4631e','room_type_id','e8673d84-4bea-48b1-a160-214b016a8c05',
   'date',value->>'date','availability',value->'available') order by idx))::text
  into body from jsonb_array_elements(p.days) with ordinality rows(value,idx);
  insert into helm_airbnb_bookings.delivery_attempts(token,plan_version,scope_version,state,request_body,request_digest,expires_at)
  values(p_token,p.version,d.version,'leased',body,encode(sha256(convert_to(body,'UTF8')),'hex'),least(i.fresh_until,stamp+30000)) returning * into a;
  update helm_airbnb_bookings.delivery_scope set next_attempt_at=clock_timestamp()+interval '60 seconds' where singleton;
  fresh:=true;
 end if;
 select * into p from helm_airbnb_bookings.inventory_plans where version=a.plan_version;
 return jsonb_build_object('status',case when fresh then 'claimed' else 'existing' end,'attempt',jsonb_build_object(
  'token',a.token,'planVersion',p.version,'planId',p.id,'planDigest',p.digest,'requestBody',a.request_body,
  'requestDigest',a.request_digest,'start',p.start_date::text,'end',p.end_date::text,'expiresAt',a.expires_at,'state',a.state));
end $$;

-- Keep the existing dormant inspection contract. Unresolved now counts transport
-- uncertainty, not asynchronous channel delivery; settlement is still unavailable.
create or replace function public.helm_channex_delivery_status()
returns jsonb language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('format',1,'enabled',d.enabled,'attempts',(select count(*) from helm_airbnb_bookings.delivery_attempts),
  'unresolved',(select count(*) from helm_airbnb_bookings.delivery_attempts where state in ('leased','submitting','uncertain')),
  'settlementEnabled',false) from helm_airbnb_bookings.delivery_scope d where singleton;
$$;
revoke all on function public.helm_channex_delivery_claim(uuid),public.helm_channex_delivery_status()
 from public,anon,authenticated,service_role;
grant execute on function public.helm_channex_delivery_claim(uuid),public.helm_channex_delivery_status() to service_role;
commit;
