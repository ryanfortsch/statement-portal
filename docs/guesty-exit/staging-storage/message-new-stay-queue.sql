-- Candidate only: after message-new-stay-timing.sql. No seed or sender activation.
-- Receipt-based stays only; never invent Guesty source-history reviews.
begin;
create table helm_channex_revisions.message_new_stay_queue_policy (
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
create table helm_channex_revisions.message_new_stay_queues (
 booking_id uuid primary key references public.bookings(id),
 policy_id uuid not null, receipt_revision uuid not null,
 send_ids uuid[] not null check(cardinality(send_ids)=6),
 prepared_at timestamptz not null default clock_timestamp()
);
alter table helm_channex_revisions.message_new_stay_queue_policy enable row level security;
alter table helm_channex_revisions.message_new_stay_queues enable row level security;
revoke all on helm_channex_revisions.message_new_stay_queue_policy,helm_channex_revisions.message_new_stay_queues from public,anon,authenticated,service_role;
alter table helm_channex_revisions.message_receipt_anchors add column last_queue_checked_at timestamptz not null default '-infinity';

create function helm_channex_revisions.prepare_new_stay_queue(p_booking uuid,p_connection text,p_generation bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare cfg helm_channex_revisions.message_new_stay_queue_policy;
 b public.bookings; a helm_channex_revisions.message_receipt_anchors;
 policy helm_channex_revisions.message_timing_policies; route public.automation_channex_routes;
 binding public.automation_message_thread_bindings; rule public.message_automations;
 entry jsonb; flow text; sid uuid; fire timestamptz; expiry timestamptz; ids uuid[]:='{}'; keys text[]:='{}';
begin
 perform helm_channex_revisions.lock_route(p_connection,p_generation);
 select * into cfg from helm_channex_revisions.message_new_stay_queue_policy where singleton for share;
 if not found or not cfg.enabled or cfg.connection is distinct from p_connection or cfg.generation is distinct from p_generation
  or cfg.expires_at<=clock_timestamp() or cfg.expires_at>clock_timestamp()+interval '366 days' then return false; end if;
 select * into route from public.automation_channex_routes where property_id='HELMTEST-calderwood' for share;
 select * into b from public.bookings where id=p_booking for update;
 -- Replays never retime/release/recreate a prepared queue, even after a date move.
 if exists(select 1 from helm_channex_revisions.message_new_stay_queues where booking_id=p_booking) then return false; end if;
 select * into a from helm_channex_revisions.message_receipt_anchors where booking_id=p_booking;
 select * into policy from helm_channex_revisions.message_timing_policies where booking_id=p_booking for share;
 select * into binding from public.automation_message_thread_bindings where booking_id=p_booking for share;
 if b.id is null or b.property_id is distinct from 'HELMTEST-calderwood' or b.status::text is distinct from 'confirmed'
  or b.duplicate_of is not null or b.channel::text is distinct from 'other' or b.source is distinct from 'manual'
  or b.source_ref is distinct from ('channex-staging:'||a.remote_id)
  or a.connection is distinct from p_connection or a.generation is distinct from p_generation
  or a.received_at<cfg.source_drained_at or public.automation_message_confirmation_anchor(b.id) is distinct from a.received_at
  or policy.booking_id is null or not policy.enabled or policy.expires_at<=clock_timestamp()
  or policy.confirmation_basis is distinct from 'helm-first-durable-receipt' or policy.receipt_revision is distinct from a.revision_id
  or policy.connection is distinct from p_connection or policy.generation is distinct from p_generation
  or not public.automation_message_observation_current(b.id)
  or not exists(select 1 from helm_channex_revisions.bookings m join helm_channex_revisions.receipts rc on rc.revision_id=m.latest_revision
    where m.remote_id=a.remote_id and m.canonical_id=b.id and rc.canonical_id=b.id and rc.outcome='applied'
      and policy.latest_provider_revision=m.latest_revision and rc.revision->>'checkIn'=b.check_in::text
      and rc.revision->>'checkOut'=b.check_out::text and rc.revision->>'status' in ('new','modified'))
  or route.property_id is null or route.environment is distinct from 'staging' or route.provider is distinct from 'Airbnb'
  or route.channex_property_id is distinct from '30584a9a-8784-4eb1-a387-e26bd43aec1c'::uuid
  or route.generation is distinct from cfg.route_generation
  or route.source_stopped_at is distinct from cfg.source_stopped_at or route.source_drained_at is distinct from cfg.source_drained_at
  or binding.booking_id is null or binding.property_id is distinct from b.property_id
  or binding.route_generation is distinct from route.generation or binding.environment is distinct from route.environment
  or binding.channel_id is distinct from route.channel_id or binding.channex_booking_id is distinct from a.remote_id
  or binding.verified_at>clock_timestamp() or nullif(btrim(binding.evidence_id),'') is null
 then raise exception 'Current receipt timing and reviewed route/thread required'; end if;
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
 expiry:=least(cfg.expires_at,policy.expires_at);
 perform 1 from public.message_automations where property_id=b.property_id or property_id is null order by id for share;
 for entry in select value from jsonb_array_elements(cfg.rules) order by value->>'automation_id' loop
  select * into rule from public.message_automations where id=(entry->>'automation_id')::uuid;
  flow:=entry->>'workflow';
  if rule.id is null or md5(to_jsonb(rule)::text) is distinct from entry->>'digest'
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
  if fire is null or fire<=clock_timestamp() or fire>=expiry then
   raise exception 'Future unambiguous schedule required'; end if;
  update public.automation_sends set fire_at=fire where id=sid;
  if flow like 'cleaner_%' then
   insert into public.automation_cleaner_batches(send_id,booking_id,property_id,automation_key,workflow,from_number,recipient_phones,
    source_stopped_at,source_drained_at,source_evidence_at,source_evidence_id,fire_at,expires_at)
   values(sid,b.id,b.property_id,rule.key,flow,cfg.from_number,cfg.recipient_phones,cfg.source_stopped_at,cfg.source_drained_at,
    a.received_at,'new-stay-policy:'||cfg.policy_id,fire,expiry);
  else
   insert into public.automation_channex_jobs(send_id,booking_id,property_id,automation_key,route_generation,channex_booking_id,
    thread_id,body_sha256,context_revision,fire_at,expires_at,source_evidence_at,source_evidence_id,workflow)
   values(sid,b.id,b.property_id,rule.key,route.generation,a.remote_id,binding.thread_id,repeat('0',64),
    public.automation_channex_context(sid),fire,expiry,a.received_at,'new-stay-policy:'||cfg.policy_id,flow);
   update public.automation_channex_jobs set context_revision=public.automation_channex_schedule_context(sid) where send_id=sid;
  end if;
  ids:=array_append(ids,sid);
 end loop;
 insert into helm_channex_revisions.message_new_stay_queues(booking_id,policy_id,receipt_revision,send_ids)
  values(b.id,cfg.policy_id,a.revision_id,ids);
 return true;
end $$;
revoke all on function helm_channex_revisions.prepare_new_stay_queue(uuid,text,bigint) from public,anon,authenticated,service_role;

create function public.helm_pilot_message_queue_prepare(p_connection text,p_generation bigint,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a helm_channex_revisions.message_receipt_anchors; scanned integer:=0; prepared integer:=0; blocked integer:=0; inactive integer:=0;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Invalid queue batch limit'; end if;
 perform helm_channex_revisions.lock_route(p_connection,p_generation);
 for a in select x.* from helm_channex_revisions.message_receipt_anchors x where x.connection=p_connection and x.generation=p_generation
  and not exists(select 1 from helm_channex_revisions.message_new_stay_queues q where q.booking_id=x.booking_id)
  order by x.last_queue_checked_at,x.booking_id limit p_limit for update
 loop
  scanned:=scanned+1;
  update helm_channex_revisions.message_receipt_anchors set last_queue_checked_at=clock_timestamp() where booking_id=a.booking_id;
  begin
   if helm_channex_revisions.prepare_new_stay_queue(a.booking_id,p_connection,p_generation) then prepared:=prepared+1;
   else inactive:=inactive+1; end if;
  exception when raise_exception or check_violation then blocked:=blocked+1;
  end;
 end loop;
 return jsonb_build_object('scanned',scanned,'prepared',prepared,'blocked',blocked,'inactive',inactive,'canSend',false);
end $$;
revoke all on function public.helm_pilot_message_queue_prepare(text,bigint,integer) from public,anon,authenticated;
grant execute on function public.helm_pilot_message_queue_prepare(text,bigint,integer) to service_role;
commit;
