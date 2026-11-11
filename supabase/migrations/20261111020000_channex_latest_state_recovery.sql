-- Latest-absolute-state recovery follows Channex's confirmed PMS contract.
-- No public endpoint, scheduler, activation, task polling or OTA delivery claim.
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
 then raise exception 'disable_empty_channex_recovery_before_migration'; end if;
end $$;
alter table helm_airbnb_bookings.delivery_scope
 add column recovery_generation bigint not null default 0 check(recovery_generation between 0 and 9007199254740991),
 add column consecutive_recoveries integer not null default 0 check(consecutive_recoveries between 0 and 3);
alter table helm_airbnb_bookings.delivery_attempts
 add column recovery_generation bigint not null default 0 check(recovery_generation between 0 and 9007199254740991),
 add column superseded_by uuid unique references helm_airbnb_bookings.delivery_attempts(token) deferrable initially deferred,
 add column superseded_at timestamptz,
 add constraint delivery_recovery_link check((superseded_by is null)=(superseded_at is null) and superseded_by is distinct from token);
-- Retired uncertain outcomes remain in history and in the unresolved status
-- count. Only the current transport attempt excludes concurrent workers.
drop index helm_airbnb_bookings.delivery_one_unresolved;
create unique index delivery_one_unresolved on helm_airbnb_bookings.delivery_attempts ((true))
 where state in ('leased','submitting','uncertain') and superseded_by is null;

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
 update helm_airbnb_bookings.delivery_attempts set state='expired' where state='leased' and superseded_by is null and expires_at<=stamp;
 update helm_airbnb_bookings.delivery_attempts set state='uncertain' where state='submitting' and superseded_by is null and expires_at<=stamp;
 select * into a from helm_airbnb_bookings.delivery_attempts where token=p_token;
 if found then
  -- A durable acceptance is an idempotent result, never a new send permit.
  -- Old tokens cannot replay a plan after the head or source has changed.
  if a.state='accepted' and a.superseded_by is null and a.recovery_generation=d.recovery_generation and helm_airbnb_bookings.delivery_plan_current(a.plan_version)
  then return jsonb_build_object('status','already-accepted'); end if;
  if a.state<>'leased' or a.superseded_by is not null or a.recovery_generation<>d.recovery_generation or a.scope_version<>d.version or not helm_airbnb_bookings.delivery_plan_current(a.plan_version)
  then return jsonb_build_object('status','blocked'); end if;
 else
  if exists(select 1 from helm_airbnb_bookings.delivery_attempts
    where (state in ('leased','submitting','uncertain') and superseded_by is null) or
      (outcome->>'kind'='unauthorized' and scope_version=d.version))
  then return jsonb_build_object('status','blocked'); end if;
  if not helm_airbnb_bookings.delivery_plan_current(i.head_version) then return jsonb_build_object('status','stale'); end if;
  -- Successful POST means accepted into Channex, not delivered to an OTA.
  -- Deduplicate the exact current plan before consuming another rate-limit slot.
  if exists(select 1 from helm_airbnb_bookings.delivery_attempts
    where state='accepted' and superseded_by is null and recovery_generation=d.recovery_generation and plan_version=i.head_version)
  then return jsonb_build_object('status','already-accepted'); end if;
  if d.next_attempt_at>clock_timestamp()
   or (select count(*) from helm_airbnb_bookings.delivery_attempts where created_at>clock_timestamp()-interval '30 minutes')>=5
  then return jsonb_build_object('status','blocked'); end if;
  select * into p from helm_airbnb_bookings.inventory_plans where version=i.head_version;
  select jsonb_build_object('values',jsonb_agg(jsonb_build_object(
   'property_id','320c5cb5-91e0-46af-b9b3-a3fc20b4631e','room_type_id','e8673d84-4bea-48b1-a160-214b016a8c05',
   'date',value->>'date','availability',value->'available') order by idx))::text
  into body from jsonb_array_elements(p.days) with ordinality rows(value,idx);
  insert into helm_airbnb_bookings.delivery_attempts(token,plan_version,scope_version,recovery_generation,state,request_body,request_digest,expires_at)
  values(p_token,p.version,d.version,d.recovery_generation,'leased',body,encode(sha256(convert_to(body,'UTF8')),'hex'),least(i.fresh_until,stamp+30000)) returning * into a;
  update helm_airbnb_bookings.delivery_scope set next_attempt_at=clock_timestamp()+interval '60 seconds' where singleton;
  fresh:=true;
 end if;
 select * into p from helm_airbnb_bookings.inventory_plans where version=a.plan_version;
 return jsonb_build_object('status',case when fresh then 'claimed' else 'existing' end,'attempt',jsonb_build_object(
  'token',a.token,'planVersion',p.version,'planId',p.id,'planDigest',p.digest,'requestBody',a.request_body,
  'requestDigest',a.request_digest,'start',p.start_date::text,'end',p.end_date::text,'expiresAt',a.expires_at,'state',a.state));
end $$;

create or replace function public.helm_channex_delivery_begin(p_token uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare d helm_airbnb_bookings.delivery_scope; a helm_airbnb_bookings.delivery_attempts; stamp bigint;
begin
 perform 1 from public.helm_inventory_capture_scopes where property_id='65_calderwood' for share;
 perform 1 from helm_airbnb_bookings.inventory_scope where singleton for update;
 select * into d from helm_airbnb_bookings.delivery_scope where singleton for update;
 select * into a from helm_airbnb_bookings.delivery_attempts where token=p_token for update;
 stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if not found or not d.enabled or a.state<>'leased' or a.scope_version<>d.version or a.expires_at<=stamp
  or a.superseded_by is not null or a.recovery_generation<>d.recovery_generation
  or a.request_digest is distinct from p_digest or not helm_airbnb_bookings.delivery_plan_current(a.plan_version)
 then return jsonb_build_object('status','blocked'); end if;
 if a.expires_at<=floor(extract(epoch from clock_timestamp())*1000)::bigint
 then return jsonb_build_object('status','blocked'); end if;
 update helm_airbnb_bookings.delivery_attempts set state='submitting',started_at=clock_timestamp() where token=p_token;
 -- Only this first successful transition grants permission. Retrying a lost
 -- response returns blocked, even if the same token/digest is supplied.
 return jsonb_build_object('status','started','expiresAt',a.expires_at);
end $$;

create or replace function public.helm_channex_delivery_record(p_token uuid,p_digest text,p_outcome jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare d helm_airbnb_bookings.delivery_scope; a helm_airbnb_bookings.delivery_attempts; kind text; task uuid; seconds int;
begin
 if jsonb_typeof(p_outcome) is distinct from 'object' then raise exception 'invalid_delivery_outcome'; end if;
 kind:=p_outcome->>'kind';
 if kind='accepted' then
  if p_outcome-array['kind','taskId']<>'{}'::jsonb or jsonb_typeof(p_outcome->'taskId') is distinct from 'string'
  then raise exception 'invalid_delivery_receipt'; end if;
  task:=(p_outcome->>'taskId')::uuid;
 elsif kind='rate-limited' then
  if p_outcome-array['kind','retryAfterSeconds']<>'{}'::jsonb or jsonb_typeof(p_outcome->'retryAfterSeconds') is distinct from 'number'
   or (p_outcome->'retryAfterSeconds')::text!~'^\d+$' then raise exception 'invalid_delivery_retry'; end if;
  seconds:=(p_outcome->>'retryAfterSeconds')::int;
  if seconds not between 60 and 86400 then raise exception 'invalid_delivery_retry'; end if;
 elsif kind in ('uncertain','unauthorized') then
  if p_outcome-array['kind']<>'{}'::jsonb then raise exception 'invalid_delivery_outcome'; end if;
 else raise exception 'invalid_delivery_outcome'; end if;
 -- Capture an already-attempted result even if scope/authority was disabled.
 -- Recording cannot grant new IO or change canonical data.
 select * into d from helm_airbnb_bookings.delivery_scope where singleton for update;
 select * into a from helm_airbnb_bookings.delivery_attempts where token=p_token for update;
 if not found or a.request_digest is distinct from p_digest or a.started_at is null then raise exception 'delivery_receipt_mismatch'; end if;
 if a.outcome is not null and a.outcome=p_outcome then return true; end if;
 if a.state not in ('submitting','uncertain') or (a.outcome is not null and a.outcome->>'kind'<>'uncertain')
 then raise exception 'delivery_outcome_conflict'; end if;
 -- An uncertain local result may later acquire its authentic response. This
 -- preserves its authentic result without reusing the old request.
 update helm_airbnb_bookings.delivery_attempts set outcome=p_outcome,task_id=task,recorded_at=clock_timestamp(),
  state=case when kind='accepted' then 'accepted' when kind='uncertain' then 'uncertain' else 'rejected' end where token=p_token;
 -- A definitive late receipt for a retired attempt changes what is known about
 -- ordering. Fence any prepared replacement and reassert the CURRENT plan next.
 -- The identical-receipt return above makes this generation advance one-use.
 if a.superseded_by is not null and kind<>'uncertain' then
  update helm_airbnb_bookings.delivery_scope set recovery_generation=recovery_generation+1 where singleton;
 elsif kind='accepted' and a.recovery_generation=d.recovery_generation then
  update helm_airbnb_bookings.delivery_scope set consecutive_recoveries=0 where singleton;
 end if;
 if kind='rate-limited' then update helm_airbnb_bookings.delivery_scope
  set next_attempt_at=greatest(next_attempt_at,clock_timestamp()+seconds*interval '1 second') where singleton; end if;
 return true;
end $$;

create function public.helm_channex_delivery_recover(p_previous_token uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare d helm_airbnb_bookings.delivery_scope; i helm_airbnb_bookings.inventory_scope;
 a helm_airbnb_bookings.delivery_attempts; r jsonb; stamp bigint;
begin
 if p_token is null or p_previous_token is null or p_token=p_previous_token
 then raise exception 'distinct_recovery_tokens_required'; end if;
 perform 1 from public.helm_inventory_capture_scopes where property_id='65_calderwood' for share;
 select * into i from helm_airbnb_bookings.inventory_scope where singleton for update;
 select * into d from helm_airbnb_bookings.delivery_scope where singleton for update;
 if not found then raise exception 'delivery_storage_missing'; end if;
 if not d.enabled then return jsonb_build_object('status','disabled'); end if;
 select * into a from helm_airbnb_bookings.delivery_attempts where token=p_previous_token for update;
 if not found then return jsonb_build_object('status','blocked'); end if;
 -- A lost recovery-claim response can only recover its own linked replacement.
 if a.superseded_by=p_token then return public.helm_channex_delivery_claim(p_token); end if;
 stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if a.superseded_by is not null or a.scope_version<>d.version or a.started_at is null
  or a.state not in ('submitting','uncertain') or (a.outcome is not null and a.outcome->>'kind'<>'uncertain')
  or a.expires_at+60000>stamp or a.started_at+interval '60 seconds'>clock_timestamp()
  or d.consecutive_recoveries>=3 or d.next_attempt_at>clock_timestamp()
  or exists(select 1 from helm_airbnb_bookings.delivery_attempts where token=p_token
    or (outcome->>'kind'='unauthorized' and scope_version=d.version))
  or (select count(*) from helm_airbnb_bookings.delivery_attempts where created_at>clock_timestamp()-interval '30 minutes')>=5
 then return jsonb_build_object('status','blocked'); end if;
 if not helm_airbnb_bookings.delivery_plan_current(i.head_version)
 then return jsonb_build_object('status','stale'); end if;
 -- Reuse the fully validated latest head; never copy the previous request body.
 -- Preserve the old outcome and exact bytes. The deferred link is committed only
 -- with the new lease. Any failed claim rolls the retirement and generation back.
 update helm_airbnb_bookings.delivery_attempts
  set state='uncertain',superseded_by=p_token,superseded_at=clock_timestamp() where token=p_previous_token;
 update helm_airbnb_bookings.delivery_scope
  set recovery_generation=recovery_generation+1,consecutive_recoveries=consecutive_recoveries+1 where singleton;
 r:=public.helm_channex_delivery_claim(p_token);
 if r->>'status'<>'claimed' then raise exception 'recovery_claim_not_created'; end if;
 return r;
end $$;

revoke all on function public.helm_channex_delivery_claim(uuid),public.helm_channex_delivery_begin(uuid,text),
 public.helm_channex_delivery_record(uuid,text,jsonb),public.helm_channex_delivery_recover(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.helm_channex_delivery_claim(uuid),public.helm_channex_delivery_begin(uuid,text),
 public.helm_channex_delivery_record(uuid,text,jsonb),public.helm_channex_delivery_recover(uuid,uuid) to service_role;
commit;
