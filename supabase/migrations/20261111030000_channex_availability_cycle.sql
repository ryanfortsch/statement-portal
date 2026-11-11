-- Dormant one-cycle selection and read-only operational projection. No activation.
begin;
set local lock_timeout='5s';
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
 then raise exception 'disable_empty_channex_cycle_before_migration'; end if;
end $$;

-- Called only after a successful fresh plan commit. The existing claim/recover
-- functions repeat every source/coverage/authority guard while holding locks.
-- A restart resumes the durable current lease, never a new competing permit.
create function public.helm_channex_delivery_cycle_claim(p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare d helm_airbnb_bookings.delivery_scope; a helm_airbnb_bookings.delivery_attempts; r jsonb; stamp bigint;
begin
 if p_token is null then raise exception 'delivery_token_required'; end if;
 perform 1 from public.helm_inventory_capture_scopes where property_id='65_calderwood' for share;
 perform 1 from helm_airbnb_bookings.inventory_scope where singleton for update;
 select * into d from helm_airbnb_bookings.delivery_scope where singleton for update;
 if not found then raise exception 'delivery_storage_missing'; end if;
 if not d.enabled then return jsonb_build_object('status','disabled'); end if;
 stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 select * into a from helm_airbnb_bookings.delivery_attempts
  where state in ('leased','submitting','uncertain') and superseded_by is null for update;
 if found and a.state in ('submitting','uncertain') then
  r:=public.helm_channex_delivery_recover(a.token,p_token);
 elsif found and a.state='leased' and a.expires_at>stamp then
  r:=public.helm_channex_delivery_claim(a.token);
 else
  r:=public.helm_channex_delivery_claim(p_token);
 end if;
 if r->>'status' in ('claimed','existing') then
  return jsonb_build_object('status','selected','token',r->'attempt'->'token');
 end if;
 return r;
end $$;

-- One statement snapshot; no request bodies, tokens, task IDs, guest data or keys.
-- Separate from the strict dormant runtime status contract (which stays format 1).
create function public.helm_channex_delivery_operations()
returns jsonb language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 with active as (
  select * from helm_airbnb_bookings.delivery_attempts
   where state in ('leased','submitting','uncertain') and superseded_by is null
 ), recent as (
  select * from helm_airbnb_bookings.delivery_attempts order by created_at desc,token desc limit 8
 )
 select jsonb_build_object(
  'format',1,'propertyId','65_calderwood','observedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
  'authority',p.calendar_authority,'publishingEnabled',d.enabled,'planningEnabled',i.enabled,
  'importEnabled',s.enabled,'captureEnabled',c.enabled,'headVersion',i.head_version,'freshUntil',i.fresh_until,
  'nextAttemptAt',case when isfinite(d.next_attempt_at) then floor(extract(epoch from d.next_attempt_at)*1000)::bigint else null end,
  'consecutiveRecoveries',d.consecutive_recoveries,
  'recentClaims',(select count(*) from helm_airbnb_bookings.delivery_attempts where created_at>statement_timestamp()-interval '30 minutes'),
  'credentialBlocked',exists(select 1 from helm_airbnb_bookings.delivery_attempts where outcome->>'kind'='unauthorized' and scope_version=d.version),
  'active',(select jsonb_build_object('state',a.state,'expiresAt',a.expires_at,
   'startedAt',floor(extract(epoch from a.started_at)*1000)::bigint,
   'generationCurrent',a.recovery_generation=d.recovery_generation,
   'recoverAfter',case when a.started_at is not null then greatest(a.expires_at+60000,floor(extract(epoch from a.started_at)*1000)::bigint+60000) else null end) from active a),
  'counts',jsonb_build_object('total',(select count(*) from helm_airbnb_bookings.delivery_attempts),
   'accepted',(select count(*) from helm_airbnb_bookings.delivery_attempts where state='accepted'),
   'historicalUnknown',(select count(*) from helm_airbnb_bookings.delivery_attempts where state='uncertain' and superseded_by is not null)),
  'recent',coalesce((select jsonb_agg(jsonb_build_object('state',r.state,
   'createdAt',floor(extract(epoch from r.created_at)*1000)::bigint,
   'recordedAt',floor(extract(epoch from r.recorded_at)*1000)::bigint,
   'retired',r.superseded_by is not null,'outcome',r.outcome->>'kind') order by r.created_at desc,r.token desc) from recent r),'[]'::jsonb)
 ) from helm_airbnb_bookings.delivery_scope d
 join helm_airbnb_bookings.inventory_scope i using(singleton)
 join helm_airbnb_bookings.scope s using(singleton)
 join public.properties p on p.id=s.property_id
 join public.helm_inventory_capture_scopes c on c.property_id=s.property_id where d.singleton;
$$;
revoke all on function public.helm_channex_delivery_cycle_claim(uuid),public.helm_channex_delivery_operations() from public,anon,authenticated,service_role;
grant execute on function public.helm_channex_delivery_cycle_claim(uuid),public.helm_channex_delivery_operations() to service_role;
commit;
