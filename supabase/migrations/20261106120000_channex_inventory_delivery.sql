-- Dormant availability transport ledger. No activation or settlement RPC.
-- Accepted/uncertain attempts block the lane until a separately reviewed recovery
-- can prove provider task completion. Readback equality alone is insufficient.
begin;
set local lock_timeout = '5s';
create table helm_airbnb_bookings.delivery_scope (
 singleton boolean primary key default true check(singleton) references helm_airbnb_bookings.inventory_scope(singleton),
 enabled boolean not null default false,
 version bigint not null default 1 check(version between 1 and 9007199254740991),
 next_attempt_at timestamptz not null default '-infinity'
);
create table helm_airbnb_bookings.delivery_attempts (
 token uuid primary key,
 plan_version bigint not null references helm_airbnb_bookings.inventory_plans(version),
 scope_version bigint not null,
 state text not null check(state in ('leased','submitting','accepted','uncertain','rejected','expired')),
 request_body text not null check(octet_length(request_body) between 1 and 150000),
 request_digest text not null check(request_digest=encode(sha256(convert_to(request_body,'UTF8')),'hex')),
 created_at timestamptz not null default clock_timestamp(),
 expires_at bigint not null,
 started_at timestamptz,
 outcome jsonb,
 task_id uuid unique,
 recorded_at timestamptz
);
create unique index delivery_one_unresolved on helm_airbnb_bookings.delivery_attempts ((true))
 where state in ('leased','submitting','accepted','uncertain');
alter table helm_airbnb_bookings.delivery_scope enable row level security;
alter table helm_airbnb_bookings.delivery_attempts enable row level security;
revoke all on helm_airbnb_bookings.delivery_scope,helm_airbnb_bookings.delivery_attempts from public,anon,authenticated,service_role;
insert into helm_airbnb_bookings.delivery_scope(singleton) select singleton from helm_airbnb_bookings.inventory_scope;
create function helm_airbnb_bookings.delivery_configuration_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.singleton is distinct from old.singleton then raise exception 'delivery_identity_immutable'; end if;
 if new.enabled is distinct from old.enabled then new.version:=old.version+1;
 elsif new.version is distinct from old.version then raise exception 'delivery_version_managed'; end if;
 return new;
end $$;
create trigger delivery_configuration_guard before update on helm_airbnb_bookings.delivery_scope
 for each row execute function helm_airbnb_bookings.delivery_configuration_guard();

-- Caller holds capture SHARE -> inventory scope UPDATE -> delivery scope UPDATE.
-- Reuse the complete planner guard (mapping, source hash, coverage, clocks,
-- authority and versions), never a weakened copy of its checks.
create function helm_airbnb_bookings.delivery_plan_current(p_version bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare p helm_airbnb_bookings.inventory_plans; i helm_airbnb_bookings.inventory_scope; r jsonb;
begin
 select * into i from helm_airbnb_bookings.inventory_scope where singleton;
 if i.head_version is distinct from p_version then return false; end if;
 select * into p from helm_airbnb_bookings.inventory_plans where version=p_version;
 if not found then return false; end if;
 r:=public.helm_channex_inventory_plan_commit(jsonb_build_object('captureVersion',p.capture_version,
  'configurationVersion',p.configuration_version,'headVersion',p.version,'inputToken',p.input_token),
  jsonb_build_object('id',p.id,'digest',p.digest,'start',p.start_date::text,'end',p.end_date::text,
   'freshUntil',i.fresh_until,'days',p.days));
 return r->>'status'='unchanged' and (r->>'version')::bigint=p_version;
end $$;
create function public.helm_channex_delivery_claim(p_token uuid)
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
  if a.state<>'leased' or a.scope_version<>d.version or not helm_airbnb_bookings.delivery_plan_current(a.plan_version)
  then return jsonb_build_object('status','blocked'); end if;
 else
  if d.next_attempt_at>clock_timestamp() or exists(select 1 from helm_airbnb_bookings.delivery_attempts
    where state in ('leased','submitting','accepted','uncertain') or
      (outcome->>'kind'='unauthorized' and scope_version=d.version))
   or (select count(*) from helm_airbnb_bookings.delivery_attempts where created_at>clock_timestamp()-interval '30 minutes')>=5
  then return jsonb_build_object('status','blocked'); end if;
  if not helm_airbnb_bookings.delivery_plan_current(i.head_version) then return jsonb_build_object('status','stale'); end if;
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

create function public.helm_channex_delivery_begin(p_token uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare d helm_airbnb_bookings.delivery_scope; a helm_airbnb_bookings.delivery_attempts; stamp bigint;
begin
 perform 1 from public.helm_inventory_capture_scopes where property_id='65_calderwood' for share;
 perform 1 from helm_airbnb_bookings.inventory_scope where singleton for update;
 select * into d from helm_airbnb_bookings.delivery_scope where singleton for update;
 select * into a from helm_airbnb_bookings.delivery_attempts where token=p_token for update;
 stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if not found or not d.enabled or a.state<>'leased' or a.scope_version<>d.version or a.expires_at<=stamp
  or a.request_digest is distinct from p_digest or not helm_airbnb_bookings.delivery_plan_current(a.plan_version)
 then return jsonb_build_object('status','blocked'); end if;
 if a.expires_at<=floor(extract(epoch from clock_timestamp())*1000)::bigint
 then return jsonb_build_object('status','blocked'); end if;
 update helm_airbnb_bookings.delivery_attempts set state='submitting',started_at=clock_timestamp() where token=p_token;
 -- Only this first successful transition grants permission. Retrying a lost
 -- response returns blocked, even if the same token/digest is supplied.
 return jsonb_build_object('status','started','expiresAt',a.expires_at);
end $$;

create function public.helm_channex_delivery_record(p_token uuid,p_digest text,p_outcome jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a helm_airbnb_bookings.delivery_attempts; kind text; task uuid; seconds int;
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
 perform 1 from helm_airbnb_bookings.delivery_scope where singleton for update;
 select * into a from helm_airbnb_bookings.delivery_attempts where token=p_token for update;
 if not found or a.request_digest is distinct from p_digest or a.started_at is null then raise exception 'delivery_receipt_mismatch'; end if;
 if a.outcome is not null and a.outcome=p_outcome then return true; end if;
 if a.state not in ('submitting','uncertain') or (a.outcome is not null and a.outcome->>'kind'<>'uncertain')
 then raise exception 'delivery_outcome_conflict'; end if;
 -- An uncertain local result may later acquire its authentic response. This
 -- records the response, but accepted still blocks every subsequent send.
 update helm_airbnb_bookings.delivery_attempts set outcome=p_outcome,task_id=task,recorded_at=clock_timestamp(),
  state=case when kind='accepted' then 'accepted' when kind='uncertain' then 'uncertain' else 'rejected' end where token=p_token;
 if kind='rate-limited' then update helm_airbnb_bookings.delivery_scope
  set next_attempt_at=greatest(next_attempt_at,clock_timestamp()+seconds*interval '1 second') where singleton; end if;
 return true;
end $$;
create function public.helm_channex_delivery_status()
returns jsonb language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('format',1,'enabled',d.enabled,'attempts',(select count(*) from helm_airbnb_bookings.delivery_attempts),
  'unresolved',(select count(*) from helm_airbnb_bookings.delivery_attempts where state in ('leased','submitting','accepted','uncertain')),
  'settlementEnabled',false) from helm_airbnb_bookings.delivery_scope d where singleton;
$$;
-- Report actual gate state; the inspection runtime must reject unexpected enablement.
create or replace function public.helm_channex_inventory_status()
returns jsonb language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('format',1,'planningEnabled',i.enabled,'publishingEnabled',d.enabled,
  'headVersion',i.head_version,'plans',(select count(*) from helm_airbnb_bookings.inventory_plans),
  'coverageSources',jsonb_array_length(i.coverage),'maxDays',500)
 from helm_airbnb_bookings.inventory_scope i join helm_airbnb_bookings.delivery_scope d using(singleton) where i.singleton;
$$;
revoke all on function helm_airbnb_bookings.delivery_configuration_guard(),helm_airbnb_bookings.delivery_plan_current(bigint),
 public.helm_channex_delivery_claim(uuid),public.helm_channex_delivery_begin(uuid,text),public.helm_channex_delivery_record(uuid,text,jsonb),
 public.helm_channex_delivery_status() from public,anon,authenticated,service_role;
grant execute on function public.helm_channex_delivery_claim(uuid),public.helm_channex_delivery_begin(uuid,text),
 public.helm_channex_delivery_record(uuid,text,jsonb),public.helm_channex_delivery_status() to service_role;
commit;
