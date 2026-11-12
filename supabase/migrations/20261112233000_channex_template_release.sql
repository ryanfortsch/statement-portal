-- Reviewed template release only. Installation releases no templates and sends nothing.
begin;
set local lock_timeout='5s';
-- Installing stricter ownership must never reinterpret an active queue.
lock table helm_channex_messages.scope in share mode;
lock table public.automation_sends in share row exclusive mode;
do $$begin
 if exists(select 1 from helm_channex_messages.scope)
  or exists(select 1 from public.automation_sends where property_id='65_calderwood')
 then raise exception 'template_release_install_requires_dormant_queue'; end if;
end$$;
create table helm_channex_messages.template_releases (
 id uuid primary key,
 capture_id uuid not null unique references helm_channex_messages.template_captures(id),
 property_id text not null unique references public.properties(id) check(property_id='65_calderwood'),
 rules_sha256 text not null check(rules_sha256 ~ '^[a-f0-9]{64}$'),
 actor text not null check(length(btrim(actor)) between 1 and 200),
 released_at timestamptz not null default clock_timestamp() check(isfinite(released_at))
);
alter table helm_channex_messages.template_releases enable row level security;
revoke all on helm_channex_messages.template_releases from public,anon,authenticated,service_role;
create trigger channex_template_release_immutable before update or delete on helm_channex_messages.template_releases
 for each row execute function helm_channex_messages.template_capture_immutable();

-- A release retains the archived source policy. The active row may differ only in
-- the four dispatch fields. No runtime can invent a release by clearing the marker.
create function helm_channex_messages.released_template_valid(r public.message_automations) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(exists(select 1 from helm_channex_messages.template_releases x
  join helm_channex_messages.template_captures c on c.id=x.capture_id and c.rules_sha256=x.rules_sha256
  cross join lateral jsonb_array_elements(c.rules) original
  where x.property_id=r.property_id and r.audience='guest'
   and r.key in ('booking_confirmed','pre_arrival','checkin_day','pre_checkout')
   and original->>'id'=r.id::text
   and (to_jsonb(r)-array['created_at','updated_at','created_by']) = original ||
    '{"enabled":true,"configured_in_ota":false,"send_mode":"auto","migration_policy":null}'::jsonb),false);
$$;
create or replace function helm_channex_messages.prepared_rule_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare retained boolean;
begin
 if tg_op<>'INSERT' then
  select exists(select 1 from helm_channex_messages.template_releases x
   join helm_channex_messages.template_captures c on c.id=x.capture_id
   cross join lateral jsonb_array_elements(c.rules) original where original->>'id'=old.id::text) into retained;
  if old.migration_policy is not null or retained then
   if tg_op='DELETE' then raise exception 'prepared_template_frozen'; end if;
   if (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    if not (tg_op='UPDATE' and old.migration_policy is not null
     and helm_channex_messages.prepared_template_valid(old)
     and helm_channex_messages.released_template_valid(new)
     and new.created_by is not distinct from old.created_by and new.created_at=old.created_at)
    then raise exception 'prepared_template_frozen'; end if;
   end if;
  end if;
 end if;
 if tg_op<>'DELETE' and new.migration_policy is not null then
  if not helm_channex_messages.prepared_template_valid(new)
   or (new.migration_policy->>'capturedAt')::timestamptz>clock_timestamp()
  then raise exception 'invalid_prepared_template'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end$$;

-- One explicit receipt, all four guest templates atomically. Cleaner templates
-- remain frozen. This can only run before handover, with Guesty authoritative and
-- Helm automation off. The receipt is not proof of source queue drainage.
create function public.helm_channex_release_templates(p_release_id uuid,p_capture_id uuid,p_rules_sha256 text,p_actor text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare c helm_channex_messages.template_captures; prior helm_channex_messages.template_releases; bundle jsonb; n integer;
begin
 if p_release_id is null or p_capture_id is null or p_rules_sha256 is null or p_rules_sha256 !~ '^[a-f0-9]{64}$'
  or p_actor is null or length(btrim(p_actor)) not between 1 and 200
  or current_setting('transaction_isolation')<>'read committed'
 then raise exception 'invalid_template_release'; end if;
 lock table helm_channex_messages.scope in share mode;
 perform 1 from public.properties where id='65_calderwood' for update;
 lock table public.message_automations in share row exclusive mode;
 lock table public.automation_sends in share row exclusive mode;
 select * into c from helm_channex_messages.template_captures where id=p_capture_id and rules_sha256=p_rules_sha256;
 if not found then raise exception 'template_release_capture_mismatch'; end if;
 select * into prior from helm_channex_messages.template_releases where property_id='65_calderwood';
 if found then
  if (prior.id,prior.capture_id,prior.rules_sha256,prior.actor) is distinct from
   (p_release_id,p_capture_id,p_rules_sha256,btrim(p_actor))
  then raise exception 'template_release_conflict'; end if;
  return jsonb_build_object('releaseId',prior.id,'captureId',prior.capture_id,'rulesSha256',prior.rules_sha256,'guestRules',4,'reused',true);
 end if;
 if not exists(select 1 from public.properties where id='65_calderwood' and calendar_authority='guesty' and not automations_enabled)
  or exists(select 1 from helm_channex_messages.scope)
  or exists(select 1 from public.automation_sends where property_id='65_calderwood')
 then raise exception 'template_release_not_dormant'; end if;
 select jsonb_agg(to_jsonb(r)-array['created_at','updated_at','created_by'] order by id) into bundle
 from public.message_automations r where property_id='65_calderwood';
 if bundle is distinct from c.rules
  or exists(select 1 from public.message_automations r where property_id='65_calderwood'
   and not helm_channex_messages.prepared_template_valid(r))
 then raise exception 'template_release_rules_changed'; end if;
 insert into helm_channex_messages.template_releases(id,capture_id,property_id,rules_sha256,actor)
 values(p_release_id,p_capture_id,'65_calderwood',p_rules_sha256,btrim(p_actor));
 update public.message_automations set enabled=true,configured_in_ota=false,send_mode='auto',migration_policy=null,
 updated_at=clock_timestamp() where property_id='65_calderwood' and audience='guest';
 get diagnostics n=row_count;
 if n<>4 then raise exception 'template_release_rules_changed'; end if;
 return jsonb_build_object('releaseId',p_release_id,'captureId',p_capture_id,'rulesSha256',p_rules_sha256,'guestRules',4,'reused',false);
end$$;

-- Legacy/fleet rules must never reserve a migrated workflow ahead of the dedicated
-- scheduler. Registration sets this transaction-local ID only after its checks.
create or replace function helm_channex_messages.prepared_send_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare rule public.message_automations;
begin
 if exists(select 1 from public.message_automations r where r.migration_policy is not null
  and (r.id=new.automation_id or (r.property_id=new.property_id and r.key=new.automation_key)))
 then raise exception 'prepared_template_not_dispatchable'; end if;
 if tg_op='INSERT' and exists(select 1 from helm_channex_messages.template_releases where property_id=new.property_id)
 and (new.automation_key in ('booking_confirmed','pre_arrival','checkin_day','pre_checkout','cleaner_reminder','cleaner_arrival')
  or exists(select 1 from public.message_automations where id=new.automation_id
   and key in ('booking_confirmed','pre_arrival','checkin_day','pre_checkout','cleaner_reminder','cleaner_arrival'))) then
  select * into rule from public.message_automations where id=new.automation_id;
  if new.delivery_used is distinct from 'channex' or new.status is distinct from 'scheduled'
   or current_setting('helm.channex_message_registration',true) is distinct from new.id::text
   or not helm_channex_messages.released_template_valid(rule)
  then return null; end if; -- Ignore old planner inserts without breaking unrelated homes.
 end if;
 return new;
end$$;
create or replace function public.helm_channex_message_register(p_plan jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
 sid uuid; bid uuid; rid uuid; generation uuid; remote uuid; thread uuid; evidence uuid;
 workflow text; revision text; body_hash text; fire timestamptz; expiry timestamptz; evidence_at timestamptz;
 scope helm_channex_messages.scope; b public.bookings; prop public.properties; rule public.message_automations;
 previous helm_channex_messages.jobs; stamp timestamptz;
begin
 if jsonb_typeof(p_plan) is distinct from 'object' or length(p_plan::text)>2500
 or (select count(*) from jsonb_object_keys(p_plan))<>13
 or not p_plan ?& array['sendId','bookingId','automationId','key','routeGeneration','remoteBookingId','threadId',
  'bodySha256','contextRevision','fireAt','expiresAt','sourceEvidenceId','sourceEvidenceAt']
 or exists(select 1 from jsonb_each(p_plan) e where jsonb_typeof(e.value)<>'string')
 then raise exception 'invalid_message_registration'; end if;
 sid:=(p_plan->>'sendId')::uuid; bid:=(p_plan->>'bookingId')::uuid; rid:=(p_plan->>'automationId')::uuid;
 generation:=(p_plan->>'routeGeneration')::uuid; remote:=(p_plan->>'remoteBookingId')::uuid;
 thread:=(p_plan->>'threadId')::uuid; evidence:=(p_plan->>'sourceEvidenceId')::uuid;
 workflow:=p_plan->>'key'; revision:=p_plan->>'contextRevision'; body_hash:=p_plan->>'bodySha256';
 fire:=(p_plan->>'fireAt')::timestamptz; expiry:=(p_plan->>'expiresAt')::timestamptz;
 evidence_at:=(p_plan->>'sourceEvidenceAt')::timestamptz;
 if workflow not in ('booking_confirmed','pre_arrival','checkin_day','pre_checkout')
 or revision !~ '^[a-f0-9]{32}$' or body_hash !~ '^[a-f0-9]{64}$'
 or not isfinite(fire) or not isfinite(expiry) or not isfinite(evidence_at)
 or exists(select 1 from unnest(array['fireAt','expiresAt','sourceEvidenceAt']) k
  where p_plan->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$')
 or expiry<=fire or expiry>fire+interval '1 day'
 then raise exception 'invalid_message_registration'; end if;

 -- Same lock order as dispatch/cancellation. The existing insert trigger makes
 -- legacy writers acquire the same booking lock, including replacement rules.
 select * into scope from helm_channex_messages.scope where property_id='65_calderwood' for share;
 select * into b from public.bookings where id=bid for update;
 if not found or b.property_id<>'65_calderwood' then raise exception 'message_registration_unavailable'; end if;
 select * into previous from helm_channex_messages.jobs where booking_id=bid and automation_key=workflow;
 if found then
  -- A lost response may conceal a committed write. Only the identical request can
  -- read it back. Never rewrite an existing hold, receipt, attempt or moved date.
  if previous.send_id is distinct from sid or previous.route_generation is distinct from generation
   or previous.remote_booking is distinct from remote or previous.thread_id is distinct from thread
   or previous.body_sha256 is distinct from body_hash or previous.context_revision is distinct from revision
   or previous.fire_at is distinct from fire or previous.expires_at is distinct from expiry
   or previous.source_evidence_id is distinct from evidence or previous.source_evidence_at is distinct from evidence_at
   or not exists(select 1 from public.automation_sends s where s.id=sid and s.automation_id=rid)
   then raise exception 'message_registration_conflict'; end if;
  return jsonb_build_object('state','existing','sendId',previous.send_id);
 end if;
 select * into prop from public.properties where id=b.property_id for share;
 select * into rule from public.message_automations where id=rid for share;
 stamp:=clock_timestamp();
 if scope.property_id is null or not scope.enabled or scope.generation is distinct from generation
 or scope.source_stopped_at is null or scope.source_drained_at is null or scope.source_evidence_id is null
 or scope.source_evidence_id is distinct from evidence or scope.source_drained_at is distinct from evidence_at
 or scope.source_stopped_at>scope.source_drained_at or evidence_at>stamp
 or prop.calendar_authority is distinct from 'helm' or prop.automations_enabled is distinct from true
 or b.status is distinct from 'confirmed' or b.duplicate_of is not null or b.channel is distinct from 'airbnb'::public.booking_channel
 or b.check_in is null or b.check_out is null or b.check_in>=b.check_out or b.check_out<=(stamp at time zone 'America/New_York')::date
 or rule.id is null or rule.property_id is distinct from b.property_id or rule.key is distinct from workflow
 or rule.trigger is distinct from workflow or rule.audience is distinct from 'guest'
 or rule.enabled is distinct from true or rule.configured_in_ota is distinct from false or rule.send_mode is distinct from 'auto'
 or not helm_channex_messages.released_template_valid(rule)
 or rule.delivery is distinct from 'ota_manual' or rule.timezone is distinct from 'America/New_York'
 or (rule.min_nights is not null and b.check_out-b.check_in<rule.min_nights)
 or 'airbnb'=any(select lower(x) from unnest(rule.channel_exclusions) x)
 or helm_channex_messages.booking_context(bid) is distinct from revision
 or fire<=stamp or fire>stamp+interval '500 days'
 or not exists(select 1 from helm_airbnb_bookings.bookings m where m.canonical_id=bid and m.remote_id=remote
  and m.remote_property=scope.remote_property and m.environment=scope.environment and m.check_in=b.check_in
  and m.check_out=b.check_out and m.status=b.status and m.code is not distinct from b.external_confirmation_code)
 then raise exception 'message_registration_not_ready'; end if;
 if exists(select 1 from public.automation_sends s left join public.message_automations r on r.id=s.automation_id
  where s.booking_id=bid and (s.automation_key=workflow or s.automation_id=rid
   or (s.automation_key is null and (r.key is null or r.key=workflow))
   or (s.automation_key is not null and r.key is not null and r.key<>s.automation_key)))
 then raise exception 'message_history_conflict'; end if;
 if exists(select 1 from public.automation_sends where id=sid) then raise exception 'message_registration_conflict'; end if;

 perform set_config('helm.channex_message_registration',sid::text,true);
 insert into public.automation_sends(id,booking_id,automation_id,automation_key,property_id,fire_at,status,
  delivery_used,planned_check_in,planned_check_out)
 values(sid,bid,rid,workflow,b.property_id,fire,'scheduled','channex',b.check_in,b.check_out);
 if not found then raise exception 'message_registration_conflict'; end if;
 insert into helm_channex_messages.jobs(send_id,booking_id,property_id,automation_key,route_generation,remote_booking,
  thread_id,body_sha256,context_revision,fire_at,expires_at,source_evidence_at,source_evidence_id)
 values(sid,bid,b.property_id,workflow,generation,remote,thread,body_hash,revision,fire,expiry,evidence_at,evidence);
 perform set_config('helm.channex_message_registration','',true);
 return jsonb_build_object('state','created','sendId',sid);
end$$;
create or replace function public.helm_channex_message_claim(p_send_id uuid,p_attempt_id uuid,p_attempt jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare j helm_channex_messages.jobs; r helm_channex_messages.scope; s public.automation_sends;
 b public.bookings; p public.properties; rule public.message_automations; stamp timestamptz;
begin
 if p_attempt_id is null or p_attempt is null or current_setting('transaction_isolation')<>'read committed' then return false; end if;
 select * into j from helm_channex_messages.jobs where send_id=p_send_id;
 if not found then return false; end if;
 select * into r from helm_channex_messages.scope where property_id=j.property_id for share;
 -- Booking -> send -> job agrees with canonical cancellation/hold/receipt writes.
 select * into b from public.bookings where id=j.booking_id for update;
 select * into s from public.automation_sends where id=p_send_id for update;
 select * into j from helm_channex_messages.jobs where send_id=p_send_id for update;
 select * into p from public.properties where id=j.property_id for share;
 select * into rule from public.message_automations where id=s.automation_id for share;
 stamp:=clock_timestamp();
 if j.state<>'prepared' or j.held or not r.enabled or r.generation<>j.route_generation
 or r.source_stopped_at is null or r.source_drained_at is null or r.source_evidence_id is null
 or r.source_drained_at is distinct from j.source_evidence_at
 or r.source_evidence_id is distinct from j.source_evidence_id or j.source_evidence_at>stamp
 or s.status is distinct from 'scheduled' or s.delivery_used is distinct from 'channex'
 or s.provider_message_id is not null or s.sent_at is not null
 or (s.booking_id,s.property_id,s.automation_key) is distinct from (j.booking_id,j.property_id,j.automation_key)
 or b.status is distinct from 'confirmed' or b.duplicate_of is not null or b.property_id<>j.property_id
 or b.channel is distinct from 'airbnb'::public.booking_channel
 or b.check_in is distinct from s.planned_check_in or b.check_out is distinct from s.planned_check_out
 or s.fire_at is distinct from j.fire_at or s.fire_at>stamp or j.expires_at<=stamp
 or p.automations_enabled is distinct from true or p.calendar_authority is distinct from 'helm'
 or rule.id is null or not rule.enabled or rule.audience<>'guest' or rule.send_mode<>'auto' or rule.configured_in_ota
 or not helm_channex_messages.released_template_valid(rule)
 or rule.key<>j.automation_key or rule.trigger<>j.automation_key
 or (rule.property_id is not null and rule.property_id<>j.property_id)
 or (rule.min_nights is not null and b.check_out-b.check_in<rule.min_nights)
 or 'airbnb'=any(select lower(x) from unnest(rule.channel_exclusions) x)
 or exists(select 1 from public.message_automations o where rule.property_id is null and o.property_id=j.property_id and o.key=rule.key)
 or exists(select 1 from public.automation_sends other where other.booking_id=j.booking_id and other.automation_key=j.automation_key and other.id<>s.id)
 or helm_channex_messages.descendant_history(j.booking_id)
 or exists(select 1 from public.automation_sends other left join public.message_automations a on a.id=other.automation_id
  where other.booking_id=j.booking_id and other.id<>s.id and
   (other.automation_key is null or (a.key is not null and a.key<>other.automation_key)))
 or j.context_revision is distinct from helm_channex_messages.context(s.id)
 or not exists(select 1 from helm_airbnb_bookings.bookings m where m.canonical_id=b.id and m.remote_id=j.remote_booking
   and m.remote_property=r.remote_property and m.environment=r.environment and m.check_in=b.check_in
   and m.check_out=b.check_out and m.status=b.status and m.code is not distinct from b.external_confirmation_code)
 or p_attempt is distinct from jsonb_build_object('environment',r.environment,'propertyId',r.remote_property,
   'channelId',r.channel_id,'provider',r.provider,'bookingId',j.remote_booking,'threadId',j.thread_id,'bodySha256',j.body_sha256)
 then return false; end if;
 update helm_channex_messages.jobs set state='attempting',attempt_id=p_attempt_id,attempted_at=stamp,version=version+1 where send_id=p_send_id;
 perform set_config('helm.channex_message_claim',p_attempt_id::text,true);
 update public.automation_sends set status='sending',updated_at=stamp where id=p_send_id;
 return true; -- Replaying even the same attempt never grants another POST.
end$$;


create or replace function helm_channex_messages.send_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare j helm_channex_messages.jobs;
begin
 if (new.booking_id,new.property_id,new.automation_key) is distinct from (old.booking_id,old.property_id,old.automation_key)
 and exists(select 1 from helm_channex_messages.scope where property_id in (new.property_id,old.property_id))
 then raise exception 'message_schedule_identity_immutable'; end if;
 select * into j from helm_channex_messages.jobs where send_id=old.id;
 if not found then return new; end if;
 if (new.booking_id,new.property_id,new.automation_key,new.delivery_used)
 is distinct from (old.booking_id,old.property_id,old.automation_key,'channex'::text)
 then raise exception 'reserved_message_cannot_be_rerouted'; end if;
 if new.status='sending' and (j.state<>'attempting'
 or current_setting('helm.channex_message_claim',true) is distinct from j.attempt_id::text) then return null; end if;
 if new.status='sent' and (j.state not in ('accepted','recorded')
 or new.provider_message_id is distinct from j.provider_message_id::text)
 then raise exception 'message_receipt_required'; end if;
 -- Reserved job timing/content never belongs to the generic planner. Only a
 -- current canonical cancellation, a disabled home, or this job's own claim and
 -- receipt transition may change its ledger. Returning NULL keeps old batch
 -- workers from breaking unrelated homes during deployment skew.
 if (to_jsonb(new)-array['updated_at','status','error','sent_at','provider_message_id'])
  is distinct from (to_jsonb(old)-array['updated_at','status','error','sent_at','provider_message_id'])
 then return null; end if;
 if (new.status,new.error,new.sent_at,new.provider_message_id) is distinct from
    (old.status,old.error,old.sent_at,old.provider_message_id) then
  if not (
    (new.status='cancelled' and new.sent_at is not distinct from old.sent_at
     and new.provider_message_id is not distinct from old.provider_message_id
     and (exists(select 1 from public.bookings where id=j.booking_id and status<>'confirmed')
       or exists(select 1 from public.properties where id=j.property_id and not automations_enabled)))
    or (new.status='sending' and j.state='attempting' and current_setting('helm.channex_message_claim',true)=j.attempt_id::text)
    or (new.status='sent' and j.state in ('accepted','recorded') and new.provider_message_id=j.provider_message_id::text)
    or (new.status='failed' and j.state in ('unknown','rejected'))
   ) then return null; end if;
 end if;
 return new;
end$$;

revoke all on function helm_channex_messages.released_template_valid(public.message_automations) from public,anon,authenticated,service_role;
revoke all on function public.helm_channex_release_templates(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.helm_channex_release_templates(uuid,uuid,text,text) to service_role;
commit;
