-- INACTIVE candidate. After provider timing and shared message worker/handoff/receipt timing SQL.
-- Creates held jobs only. No release, sender enablement, origin inference or migrated replay.
begin;
create table helm_airbnb_bookings.message_queue_policy (
 singleton boolean primary key default true check(singleton),
 policy_id uuid not null default gen_random_uuid(),
 connection text not null, generation bigint not null check(generation>0),
 route_generation uuid not null,
 rules jsonb not null check(jsonb_typeof(rules)='array' and jsonb_array_length(rules)=6),
 from_number text not null check(from_number ~ '^\+1[0-9]{10}$'),
 recipient_phones text[] not null check(cardinality(recipient_phones) between 1 and 10),
 source_stopped_at timestamptz not null, source_drained_at timestamptz not null,
 expires_at timestamptz not null,
 enabled boolean not null default false,
 check(isfinite(source_stopped_at) and source_stopped_at<=source_drained_at and source_drained_at<expires_at and isfinite(expires_at))
);
create table helm_airbnb_bookings.message_queues (
 booking_id uuid primary key references public.bookings(id),
 policy_id uuid not null, receipt_revision uuid not null,
 send_ids uuid[] not null check(cardinality(send_ids)=6),
 latest_observation uuid not null, latest_provider_revision uuid not null,
 prepared_at timestamptz not null default clock_timestamp()
);
alter table helm_airbnb_bookings.message_queue_policy enable row level security;
alter table helm_airbnb_bookings.message_queues enable row level security;
revoke all on helm_airbnb_bookings.message_queue_policy,helm_airbnb_bookings.message_queues from public,anon,authenticated,service_role;

create function public.helm_airbnb_message_queue_prepare(p_booking uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare cfg helm_airbnb_bookings.message_queue_policy; s helm_airbnb_bookings.scope;
 b public.bookings; m helm_airbnb_bookings.bookings; clocks helm_airbnb_bookings.message_clock_policy;
 origin helm_airbnb_bookings.message_origins; first_receipt helm_airbnb_bookings.receipts;
 route public.automation_channex_routes; binding public.automation_message_thread_bindings;
 rule public.message_automations; projection jsonb; entry jsonb; flow text; sid uuid;
 fire timestamptz; expiry timestamptz; ids uuid[]:='{}'; keys text[]:='{}';
begin
 select * into s from helm_airbnb_bookings.scope where singleton for update;
 select * into cfg from helm_airbnb_bookings.message_queue_policy where singleton for share;
 if s.singleton is null or not s.enabled or cfg.singleton is null or not cfg.enabled or cfg.generation<>s.generation
  or cfg.expires_at<=clock_timestamp() or cfg.expires_at>clock_timestamp()+interval '366 days' then return false; end if;
 select * into clocks from helm_airbnb_bookings.message_clock_policy where singleton for share;
 select * into route from public.automation_channex_routes where property_id=s.property_id for share;
 select * into b from public.bookings where id=p_booking for update;
 if exists(select 1 from helm_airbnb_bookings.message_queues where booking_id=p_booking) then return false; end if;
 select * into origin from helm_airbnb_bookings.message_origins where booking_id=p_booking for share;
 select * into m from helm_airbnb_bookings.bookings where canonical_id=p_booking;
 select * into first_receipt from helm_airbnb_bookings.receipts where revision_id=origin.first_revision;
 select * into binding from public.automation_message_thread_bindings where booking_id=p_booking for share;
 projection:=public.helm_airbnb_message_schedule(p_booking);
 if projection is null or projection->>'origin' is distinct from 'new'
  or jsonb_array_length(projection->'plans')<>6
  or exists(select 1 from jsonb_array_elements(projection->'plans') v where v->>'blockedReason' is not null)
  or first_receipt.committed_at<cfg.source_drained_at
  or route.property_id is null or route.provider is distinct from 'Airbnb'
  or route.environment is distinct from s.environment or route.channex_property_id is distinct from s.remote_property
  or route.generation is distinct from cfg.route_generation
  or route.source_stopped_at is distinct from cfg.source_stopped_at or route.source_drained_at is distinct from cfg.source_drained_at
  or binding.booking_id is null or binding.property_id is distinct from b.property_id
  or binding.route_generation is distinct from route.generation or binding.environment is distinct from route.environment
  or binding.channel_id is distinct from route.channel_id or binding.channex_booking_id is distinct from m.remote_id
  or binding.verified_at>clock_timestamp() or nullif(btrim(binding.evidence_id),'') is null
  or exists(select 1 from public.automation_message_observations where booking_id=b.id)
  or exists(select 1 from public.automation_channex_stay_times where booking_id=b.id)
  or exists(select 1 from public.checkout_adjustments where property_id=b.property_id and stay_check_in=b.check_in)
 then raise exception 'Eligible provider timing and reviewed route/thread required'; end if;
 perform public.automation_message_observe_times(b.id,public.automation_message_stay_revision(b.id),null,
  jsonb_build_object('check_in',b.check_in,'check_out',b.check_out,'arrival_time',clocks.arrival_time,'departure_time',clocks.departure_time,
   'confirmed_at',null,'observed_at',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'source_revision','airbnb:'||m.latest_revision,'evidence_id',origin.evidence_id));
 if exists(select 1 from public.automation_sends where booking_id=b.id)
  then raise exception 'Existing queue requires reconciliation'; end if;
 if (select array_agg(v->>'workflow' order by v->>'workflow') from jsonb_array_elements(cfg.rules) v)
  is distinct from array['cleaner_advance','cleaner_arrival','confirmation','key_code','pre_arrival','pre_checkout']
  or (select count(distinct v->>'automation_id') from jsonb_array_elements(cfg.rules) v)<>6
  or cardinality(cfg.recipient_phones)<>(select count(distinct x) from unnest(cfg.recipient_phones) x)
  or exists(select 1 from unnest(cfg.recipient_phones) x where x is null or x=cfg.from_number or
    (select count(*) from public.cleaner_schedule_recipients c where public.automation_cleaner_phone(c.phone)=x
      and c.enabled and b.property_id=any(c.property_ids))<>1)
 then raise exception 'Six reviewed rules and exact enabled cleaner recipients required'; end if;
 expiry:=least(cfg.expires_at,clocks.expires_at);
 perform 1 from public.message_automations where property_id=b.property_id or property_id is null order by id for share;
 for entry in select value from jsonb_array_elements(cfg.rules) order by value->>'automation_id' loop
  select * into rule from public.message_automations where id=(entry->>'automation_id')::uuid;
  flow:=entry->>'workflow';
  if rule.id is null or md5(to_jsonb(rule)::text) is distinct from entry->>'digest'
   or rule.timezone is distinct from clocks.timezone
   or nullif(btrim(rule.key),'') is null or rule.key=any(keys)
   or (rule.property_id is not null and rule.property_id<>b.property_id)
   or rule.audience is distinct from (case when flow like 'cleaner_%' then 'cleaner' else 'guest' end)
   or rule.trigger is distinct from (case flow when 'confirmation' then 'booking_confirmed' when 'pre_arrival' then 'pre_arrival'
      when 'key_code' then 'checkin_day' when 'pre_checkout' then 'pre_checkout' when 'cleaner_advance' then 'pre_arrival' else 'checkin_day' end)
  then raise exception 'Reviewed rule changed or binding invalid'; end if;
  keys:=array_append(keys,rule.key);
  perform pg_advisory_xact_lock(hashtextextended(b.id::text||':'||rule.key,0));
  sid:=gen_random_uuid();
  -- Held until separate delivery acceptance. Registration reserves the native
  -- sender rail atomically; no unreserved scheduled row is ever committed.
  insert into public.automation_sends(id,booking_id,property_id,automation_id,automation_key,status,planned_check_in,planned_check_out,updated_at)
   values(sid,b.id,b.property_id,rule.id,rule.key,'held',b.check_in,b.check_out,clock_timestamp());
  fire:=public.automation_message_resolved_schedule(sid,flow);
  if fire is null or fire<=clock_timestamp() or fire>=expiry
    or fire is distinct from (select (v->>'fireAt')::timestamptz from jsonb_array_elements(projection->'plans') v where v->>'workflow'=flow) then
   raise exception 'Future unambiguous schedule required'; end if;
  update public.automation_sends set fire_at=fire where id=sid;
  if flow like 'cleaner_%' then
   insert into public.automation_cleaner_batches(send_id,booking_id,property_id,automation_key,workflow,from_number,recipient_phones,
    source_stopped_at,source_drained_at,source_evidence_at,source_evidence_id,fire_at,expires_at)
   values(sid,b.id,b.property_id,rule.key,flow,cfg.from_number,cfg.recipient_phones,cfg.source_stopped_at,cfg.source_drained_at,
    first_receipt.committed_at,'new-stay-policy:'||cfg.policy_id,fire,expiry);
  else
   insert into public.automation_channex_jobs(send_id,booking_id,property_id,automation_key,route_generation,channex_booking_id,
    thread_id,body_sha256,context_revision,fire_at,expires_at,source_evidence_at,source_evidence_id,workflow)
   values(sid,b.id,b.property_id,rule.key,route.generation,m.remote_id,binding.thread_id,repeat('0',64),
    public.automation_channex_context(sid),fire,expiry,first_receipt.committed_at,'new-stay-policy:'||cfg.policy_id,flow);
   update public.automation_channex_jobs set context_revision=public.automation_channex_schedule_context(sid) where send_id=sid;
  end if;
  ids:=array_append(ids,sid);
 end loop;
 insert into helm_airbnb_bookings.message_queues(booking_id,policy_id,receipt_revision,send_ids,latest_observation,latest_provider_revision)
  values(b.id,cfg.policy_id,origin.first_revision,ids,
   (select revision from public.automation_message_observations where booking_id=b.id),m.latest_revision);
 return true;
end $$;
revoke all on function public.helm_airbnb_message_queue_prepare(uuid) from public,anon,authenticated;
grant execute on function public.helm_airbnb_message_queue_prepare(uuid) to service_role;
-- Shared claims/rendering must stop if provider evidence is withdrawn after preparation.
-- Non-provider stays retain the original observation rules unchanged.
create or replace function public.automation_message_observation_current(p_booking_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select not o.invalidated and o.canonical_revision=public.automation_message_stay_revision(o.booking_id)
   and o.timing_digest=public.automation_message_timing_digest(t) and o.observed_at<=statement_timestamp()
   and (not exists(select 1 from helm_airbnb_bookings.bookings m where m.canonical_id=o.booking_id)
    or exists(select 1 from helm_airbnb_bookings.message_clock_policy p
      join helm_airbnb_bookings.message_queue_policy q on q.singleton and q.enabled
      join helm_airbnb_bookings.scope sc on sc.singleton and sc.enabled and sc.generation=q.generation
      join public.automation_channex_routes r on r.property_id=sc.property_id and r.generation=q.route_generation
       and r.source_stopped_at=q.source_stopped_at and r.source_drained_at=q.source_drained_at
      where p.singleton and q.expires_at>statement_timestamp()
       and t.arrival_time=p.arrival_time and t.departure_time=p.departure_time and t.confirmed_at is null
       and public.helm_airbnb_message_schedule(o.booking_id)->>'origin'='new'))
 from public.automation_message_observations o join public.automation_channex_stay_times t using(booking_id)
 where o.booking_id=p_booking_id),false);
$$;
revoke all on function public.automation_message_observation_current(uuid) from public,anon,authenticated,service_role;

create or replace function public.automation_message_confirmation_anchor(p_booking_id uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
 select coalesce(t.confirmed_at,(
   select (v->>'fireAt')::timestamptz-interval '30 minutes'
   from jsonb_array_elements(public.helm_airbnb_message_schedule(b.id)->'plans') v
   where v->>'workflow'='confirmation'
     and exists(select 1 from helm_airbnb_bookings.message_origins o where o.booking_id=b.id and o.origin='new')
 ),(
   select a.received_at from helm_channex_revisions.message_receipt_anchors a
   join helm_channex_revisions.message_receipt_policy p on p.singleton and p.enabled
     and p.connection=a.connection and p.generation=a.generation
     and statement_timestamp()>=p.starts_at and statement_timestamp()<p.expires_at
   join helm_channex_revisions.bookings m on m.canonical_id=a.booking_id and m.remote_id=a.remote_id
   where a.booking_id=b.id and b.property_id='HELMTEST-calderwood'
     and b.source='manual' and b.channel::text='other'
     and b.source_ref='channex-staging:'||a.remote_id::text
 )) from public.bookings b left join public.automation_channex_stay_times t on t.booking_id=b.id
 where b.id=p_booking_id and b.status::text='confirmed' and b.duplicate_of is null;
$$;
revoke all on function public.automation_message_confirmation_anchor(uuid) from public,anon,authenticated,service_role;


-- Refresh provenance only. Existing workers render and retime unattempted jobs
-- through their own compare-and-swap controls; holds/history are never rewritten.
create function public.helm_airbnb_message_times_refresh(p_booking uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare sc helm_airbnb_bookings.scope; cfg helm_airbnb_bookings.message_queue_policy;
 clocks helm_airbnb_bookings.message_clock_policy; q helm_airbnb_bookings.message_queues;
 b public.bookings; m helm_airbnb_bookings.bookings; o public.automation_message_observations;
 t public.automation_channex_stay_times; projection jsonb; observation uuid;
begin
 select * into sc from helm_airbnb_bookings.scope where singleton for update;
 select * into cfg from helm_airbnb_bookings.message_queue_policy where singleton for share;
 select * into clocks from helm_airbnb_bookings.message_clock_policy where singleton for share;
 perform 1 from public.automation_channex_routes where property_id=sc.property_id for share;
 select * into b from public.bookings where id=p_booking for update;
 select * into q from helm_airbnb_bookings.message_queues where booking_id=p_booking for update;
 select * into m from helm_airbnb_bookings.bookings where canonical_id=p_booking;
 select * into o from public.automation_message_observations where booking_id=p_booking;
 select * into t from public.automation_channex_stay_times where booking_id=p_booking;
 projection:=public.helm_airbnb_message_schedule(p_booking);
 if not coalesce(sc.enabled and cfg.enabled,false) or cfg.generation is distinct from sc.generation
  or cfg.expires_at<=clock_timestamp() or q.policy_id is distinct from cfg.policy_id
  or q.booking_id is null or projection->>'origin' is distinct from 'new'
  or o.revision is distinct from q.latest_observation
  or o.timing_digest is distinct from public.automation_message_timing_digest(t)
  or (t.arrival_time,t.departure_time,t.confirmed_at) is distinct from (clocks.arrival_time,clocks.departure_time,null::timestamptz)
  or exists(select 1 from public.checkout_adjustments where property_id=b.property_id and stay_check_in=b.check_in)
 then return false; end if;
 if public.automation_message_observation_current(b.id) then
  update helm_airbnb_bookings.message_queues set latest_provider_revision=m.latest_revision where booking_id=b.id;
  return false;
 end if;
 -- A local edit/revert cannot renew provenance without a fresh applied receipt.
 if m.latest_revision=q.latest_provider_revision then return false; end if;
 observation:=public.automation_message_observe_times(b.id,public.automation_message_stay_revision(b.id),o.revision,
  jsonb_build_object('check_in',b.check_in,'check_out',b.check_out,'arrival_time',clocks.arrival_time,
   'departure_time',clocks.departure_time,'confirmed_at',null,
   'observed_at',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'source_revision','airbnb:'||m.latest_revision,'evidence_id',projection->>'evidenceId'));
 if not public.automation_message_observation_current(b.id) then
  raise exception 'Provider observation authority changed'; end if;
 update helm_airbnb_bookings.message_queues set latest_observation=observation,latest_provider_revision=m.latest_revision where booking_id=b.id;
 return true;
end $$;
revoke all on function public.helm_airbnb_message_times_refresh(uuid) from public,anon,authenticated;
grant execute on function public.helm_airbnb_message_times_refresh(uuid) to service_role;

-- Fair durable sweep is independent of the provider ACK/feed. A crash after ACK
-- leaves canonical rows available to the next sweep, including rejected stays.
alter table helm_airbnb_bookings.bookings add column message_checked_at timestamptz not null default '-infinity';
create function public.helm_airbnb_messages_tick(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item record; scanned integer:=0; prepared integer:=0; refreshed integer:=0; blocked integer:=0;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Invalid message batch limit'; end if;
 perform 1 from helm_airbnb_bookings.scope where singleton for update;
 for item in select canonical_id from helm_airbnb_bookings.bookings
   order by message_checked_at,canonical_id limit p_limit for update
 loop
  scanned:=scanned+1;
  update helm_airbnb_bookings.bookings set message_checked_at=clock_timestamp() where canonical_id=item.canonical_id;
  begin
   if exists(select 1 from helm_airbnb_bookings.message_queues where booking_id=item.canonical_id) then
    if public.helm_airbnb_message_times_refresh(item.canonical_id) then refreshed:=refreshed+1; end if;
   elsif public.helm_airbnb_message_queue_prepare(item.canonical_id) then prepared:=prepared+1;
   else blocked:=blocked+1;
   end if;
  exception when raise_exception or check_violation then
   -- Only expected per-stay rejection is isolated. System/permission failures
   -- roll back the tick. Cursor remains outside this subtransaction for fairness.
   blocked:=blocked+1;
  end;
 end loop;
 return jsonb_build_object('scanned',scanned,'prepared',prepared,'refreshed',refreshed,'blocked',blocked,'canSend',false);
end $$;
revoke all on function public.helm_airbnb_messages_tick(integer) from public,anon,authenticated;
grant execute on function public.helm_airbnb_messages_tick(integer) to service_role;
commit;
