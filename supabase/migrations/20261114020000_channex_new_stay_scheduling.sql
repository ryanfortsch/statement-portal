-- Verified new Airbnb stays: approved clocks, atomic six-workflow scheduling.
-- Installation changes no authority, releases, enrollment, schedules or senders.
begin;
set local lock_timeout='5s';

-- Return NULL for stale dated exceptions or unresolved checkout adjustments.
create function helm_channex_messages.new_stay_clocks(p_booking uuid) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare v jsonb; c jsonb; x jsonb; a jsonb;
begin
 v:=public.helm_channex_new_stay_read(p_booking); if v is null then return null; end if;
 c:=v->'clocks'; x:=nullif(c->'exception','null'::jsonb); a:=nullif(c->'checkoutAdjustment','null'::jsonb);
 if c->>'policy'<>'calderwood_new_airbnb_helm_clocks_v1'
 or (x is not null and (x->>'start',x->>'end') is distinct from (c->>'start',c->>'end'))
 or (a is not null and (a->>'start' is distinct from c->>'start'
  or (a->>'originalEnd' is distinct from c->>'end' and a->>'end' is distinct from c->>'end')
  or (a->>'end' is not null and a->>'end' is distinct from c->>'end')
  or (x->>'departure' is not null and a->>'departure' is not null and x->>'departure'<>a->>'departure')))
 then return null; end if;
 return jsonb_build_object('start',c->>'start','end',c->>'end','bookingId',p_booking,
 'clocks',jsonb_build_object('timezone','America/New_York','plannedArrival',x->>'arrival',
 'plannedDeparture',coalesce(x->>'departure',a->>'departure'),'defaultArrival','16:00','defaultDeparture','11:00','confirmedAt',null));
end$$;

create function helm_channex_messages.new_stay_instant(p_day date,p_clock text) returns timestamptz
language plpgsql immutable set search_path='' set timezone='UTC' as $$
declare v timestamptz; expected text;
begin
 if p_day is null or p_clock is null or p_clock !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
 expected:=p_day::text||' '||p_clock; v:=expected::timestamp at time zone 'America/New_York';
 if to_char(v at time zone 'America/New_York','YYYY-MM-DD HH24:MI')<>expected
 or to_char((v-interval '1 hour') at time zone 'America/New_York','YYYY-MM-DD HH24:MI')=expected
 or to_char((v+interval '1 hour') at time zone 'America/New_York','YYYY-MM-DD HH24:MI')=expected then return null; end if;
 return v;
end$$;

-- Independent SQL clock calculation at registration AND one-use claim.
create function helm_channex_messages.new_stay_fire(p_booking uuid,p_key text) returns timestamptz
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare r jsonb; arrival text; departure text; a timestamptz; d timestamptz; target timestamptz; n integer; day date;
begin
 r:=helm_channex_messages.new_stay_clocks(p_booking); if r is null then return null; end if;
 arrival:=coalesce(r->'clocks'->>'plannedArrival','16:00'); departure:=coalesce(r->'clocks'->>'plannedDeparture','11:00');
 -- Retained copy contains literal times. An override does not rewrite that copy.
 if (p_key in ('booking_confirmed','pre_arrival','cleaner_arrival') and arrival<>'16:00')
 or (p_key in ('pre_arrival','pre_checkout') and departure<>'11:00') then return null; end if;
 if p_key='booking_confirmed' then
  select to_timestamp(ceil(extract(epoch from(first_received_at+interval '30 minutes'))*1000)/1000)
  into target from helm_channex_messages.new_stay_admissions where booking_id=p_booking;
  return target;
 end if;
 a:=helm_channex_messages.new_stay_instant((r->>'start')::date,arrival);
 d:=helm_channex_messages.new_stay_instant((r->>'end')::date,departure);
 if p_key='checkin_day' then return a-interval '60 minutes'; end if;
 if p_key='cleaner_arrival' then return a-interval '7 hours'; end if;
 if p_key in ('pre_arrival','cleaner_reminder') then
  n:=case when p_key='pre_arrival' then 1 else 10 end; day:=(r->>'start')::date;
  target:=helm_channex_messages.new_stay_instant(day-n,arrival);
  if target=a-make_interval(days=>n) then return target; end if;
 elsif p_key='pre_checkout' then
  target:=helm_channex_messages.new_stay_instant((r->>'end')::date-1,departure);
  if target=d-interval '24 hours' then return target; end if;
 end if;
 return null;
end$$;

create or replace function helm_channex_messages.booking_context_base(p_booking_id uuid) returns text
language sql stable security definer set search_path='' set timezone='UTC' as $$
 select md5(jsonb_build_object('booking',to_jsonb(b),'property',to_jsonb(p),
 'rules',(select jsonb_agg(to_jsonb(r) order by r.id) from public.message_automations r where r.property_id=b.property_id or r.property_id is null),
 'plan',(select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.property_rate_plans r where r.property_id=b.property_id),
 'adjustments',(select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text) from public.checkout_adjustments a where a.property_id=b.property_id and a.stay_check_in=b.check_in),
 'access',(select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text) from public.property_access a where a.property_id=b.property_id),
 'codes',(select jsonb_agg(to_jsonb(c) order by c.id) from public.guest_access_codes c where c.booking_id=b.id),
 'locks',(select jsonb_agg(to_jsonb(l) order by l.device_id) from public.lock_devices l where l.property_id=b.property_id),
 'guest',(select to_jsonb(g) from public.guests g where g.id=b.guest_id))::text)
 from public.bookings b join public.properties p on p.id=b.property_id where b.id=p_booking_id;
$$;

create or replace function helm_channex_messages.booking_context(p_booking_id uuid) returns text
language sql stable security definer set search_path='' set timezone='UTC' as $$
 select case when exists(select 1 from helm_channex_messages.new_stay_admissions where booking_id=p_booking_id)
 then md5(jsonb_build_object('base',helm_channex_messages.booking_context_base(p_booking_id),
 'newStay',public.helm_channex_new_stay_read(p_booking_id)-'observedAt')::text)
 else helm_channex_messages.booking_context_base(p_booking_id) end;
$$;

alter table helm_channex_messages.cleaner_jobs alter column binding_id drop not null;
alter table helm_channex_messages.cleaner_jobs add column new_stay_id uuid references helm_channex_messages.new_stay_admissions(booking_id);
alter table helm_channex_messages.cleaner_jobs add constraint cleaner_timing_origin check
 ((binding_id is not null and new_stay_id is null) or (binding_id is null and new_stay_id=booking_id and new_stay_id is not null));

create or replace function helm_channex_messages.cleaner_fire(p_binding uuid,p_booking uuid,p_key text) returns timestamptz
language sql stable security definer set search_path='' set timezone='UTC' as $$
 select case when p_binding is null then helm_channex_messages.new_stay_fire(p_booking,p_key) else helm_channex_messages.cleaner_source_fire(v,p_key) end
 from (select public.helm_channex_timing_binding_read(p_binding)->'evidence'->'row' v) source
 where p_binding is null or v->>'bookingId'=p_booking::text;
$$;
create or replace function helm_channex_messages.cleaner_ready(p_release uuid,p_booking uuid,p_rule uuid,p_binding uuid,p_revision text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from helm_channex_messages.cleaner_releases x
 join helm_channex_messages.scope s on s.property_id=x.property_id and s.generation=x.route_generation
 join public.properties p on p.id=x.property_id join public.bookings b on b.property_id=p.id
 where x.id=p_release and b.id=p_booking and s.enabled
 and s.source_stopped_at<=s.source_drained_at and s.source_drained_at<=statement_timestamp() and s.source_evidence_id is not null
 and x.source_stopped_at<=x.source_drained_at and x.source_drained_at<=x.reviewed_at and x.reviewed_at<=statement_timestamp()
 and p.calendar_authority='helm' and p.automations_enabled and p.is_active and p.kind='managed'
 and b.status='confirmed' and b.duplicate_of is null and b.hold_kind is null and b.channel='airbnb'
 and b.check_in<b.check_out and b.check_out>(statement_timestamp() at time zone 'America/New_York')::date
 and x.recipient_revision=helm_channex_messages.cleaner_recipient_revision()
 and helm_channex_messages.cleaner_rule_valid(x.id,p_rule)
 and helm_channex_messages.booking_context(b.id)=p_revision
 and ((p_binding is not null and exists(select 1 from helm_channex_messages.timing_bindings t where t.id=p_binding and t.booking_id=b.id
  and t.intent->'context'->>'contextRevision'=p_revision) and public.helm_channex_timing_binding_read(p_binding) is not null)
  or (p_binding is null and helm_channex_messages.new_stay_clocks(b.id) is not null))
 and not helm_channex_messages.descendant_history(b.id));
$$;
create or replace function public.helm_channex_new_cleaner_register(p_plan jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' as $$
declare j helm_channex_messages.cleaner_jobs; prior helm_channex_messages.cleaner_jobs;
 x helm_channex_messages.cleaner_releases; b public.bookings;
begin
 if current_setting('transaction_isolation')<>'read committed' or jsonb_typeof(p_plan) is distinct from 'object'
 or length(p_plan::text)>3000 or (select count(*) from jsonb_object_keys(p_plan))<>14
 or not p_plan ?& array['sendId','bookingId','automationId','releaseId','newStayId','propertyId','key','keyId',
 'contextRevision','recipientHmac','targetHmac','bodySha256','fireAt','expiresAt']
 or exists(select 1 from jsonb_each(p_plan) e where jsonb_typeof(e.value)<>'string')
 then raise exception 'invalid_cleaner_registration'; end if;
 j.send_id:=(p_plan->>'sendId')::uuid; j.booking_id:=(p_plan->>'bookingId')::uuid;
 j.automation_id:=(p_plan->>'automationId')::uuid; j.release_id:=(p_plan->>'releaseId')::uuid;
 j.new_stay_id:=(p_plan->>'newStayId')::uuid; j.binding_id:=null; j.property_id:=p_plan->>'propertyId'; j.automation_key:=p_plan->>'key';
 j.key_id:=p_plan->>'keyId'; j.context_revision:=p_plan->>'contextRevision'; j.recipient_hmac:=p_plan->>'recipientHmac';
 j.target_hmac:=p_plan->>'targetHmac'; j.body_sha256:=p_plan->>'bodySha256';
 j.fire_at:=(p_plan->>'fireAt')::timestamptz; j.expires_at:=(p_plan->>'expiresAt')::timestamptz;
 if j.new_stay_id is distinct from j.booking_id or j.property_id<>'65_calderwood' or j.automation_key not in ('cleaner_reminder','cleaner_arrival')
 or j.context_revision !~ '^[a-f0-9]{32}$' or j.body_sha256 !~ '^[a-f0-9]{64}$'
 or not isfinite(j.fire_at) or not isfinite(j.expires_at) or j.expires_at<=j.fire_at or j.expires_at>j.fire_at+interval '30 minutes'
 or exists(select 1 from unnest(array['fireAt','expiresAt']) k where p_plan->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$')
 then raise exception 'invalid_cleaner_registration'; end if;
 perform 1 from helm_channex_messages.scope where property_id=j.property_id for share;
 select * into b from public.bookings where id=j.booking_id for update;
 if not found or b.property_id<>j.property_id then raise exception 'cleaner_registration_unavailable'; end if;
 select * into prior from helm_channex_messages.cleaner_jobs where booking_id=j.booking_id and automation_key=j.automation_key;
 if found then
  if (prior.send_id,prior.automation_id,prior.release_id,prior.binding_id,prior.new_stay_id,prior.property_id,prior.key_id,prior.context_revision,
   prior.recipient_hmac,prior.target_hmac,prior.body_sha256,prior.fire_at,prior.expires_at) is distinct from
   (j.send_id,j.automation_id,j.release_id,j.binding_id,j.new_stay_id,j.property_id,j.key_id,j.context_revision,
   j.recipient_hmac,j.target_hmac,j.body_sha256,j.fire_at,j.expires_at) then raise exception 'cleaner_registration_conflict'; end if;
  return jsonb_build_object('state','existing','sendId',prior.send_id);
 end if;
 lock table public.cleaner_schedule_recipients in share mode;
 perform 1 from public.properties where id=j.property_id for share;
 perform 1 from public.message_automations where id=j.automation_id for share;
 select * into x from helm_channex_messages.cleaner_releases where id=j.release_id;
 if x.id is null or (j.key_id,j.recipient_hmac,j.target_hmac) is distinct from (x.key_id,x.recipient_hmac,x.target_hmac)
 or not helm_channex_messages.cleaner_ready(j.release_id,j.booking_id,j.automation_id,j.binding_id,j.context_revision)
 or not exists(select 1 from public.message_automations where id=j.automation_id and key=j.automation_key)
 or helm_channex_messages.cleaner_fire(j.binding_id,j.booking_id,j.automation_key) is distinct from j.fire_at
 or j.fire_at<=clock_timestamp() or j.fire_at>clock_timestamp()+interval '500 days'
 then raise exception 'cleaner_registration_not_ready'; end if;
 if exists(select 1 from public.automation_sends s left join public.message_automations r on r.id=s.automation_id
  where s.booking_id=j.booking_id and (s.automation_key=j.automation_key or s.automation_id=j.automation_id
   or s.automation_key is null or (r.key is not null and r.key<>s.automation_key)))
 then raise exception 'cleaner_history_conflict'; end if;
 perform set_config('helm.cleaner_registration',j.send_id::text,true);
 insert into public.automation_sends(id,booking_id,automation_id,automation_key,property_id,fire_at,status,delivery_used,planned_check_in,planned_check_out)
 values(j.send_id,j.booking_id,j.automation_id,j.automation_key,j.property_id,j.fire_at,'scheduled','sms',b.check_in,b.check_out);
 if not found then raise exception 'cleaner_registration_conflict'; end if;
 insert into helm_channex_messages.cleaner_jobs(send_id,booking_id,automation_id,release_id,binding_id,new_stay_id,property_id,automation_key,
 key_id,context_revision,recipient_hmac,target_hmac,body_sha256,fire_at,expires_at)
 values(j.send_id,j.booking_id,j.automation_id,j.release_id,j.binding_id,j.new_stay_id,j.property_id,j.automation_key,
 j.key_id,j.context_revision,j.recipient_hmac,j.target_hmac,j.body_sha256,j.fire_at,j.expires_at);
 perform set_config('helm.cleaner_registration','',true);
 return jsonb_build_object('state','created','sendId',j.send_id);
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
 or (exists(select 1 from helm_channex_messages.new_stay_admissions where booking_id=bid)
  and (helm_channex_messages.new_stay_fire(bid,workflow) is distinct from fire or expiry>fire+interval '30 minutes'))
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
 or (exists(select 1 from helm_channex_messages.new_stay_admissions where booking_id=j.booking_id)
  and (helm_channex_messages.new_stay_fire(j.booking_id,j.automation_key) is distinct from j.fire_at or j.expires_at>j.fire_at+interval '30 minutes'))
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
create or replace function public.helm_channex_new_stay_schedule_inputs(p_booking_id uuid)
returns jsonb language sql stable security definer set search_path='' set timezone='UTC' as $$
 with recursive family(id) as (
  select id from public.bookings where id=p_booking_id
  union
  select b.id from public.bookings b join family f on b.duplicate_of=f.id
 ), bound as materialized (
  select public.helm_channex_new_stay_read(p_booking_id) value
 ), rules as materialized (
  select id,key,property_id,audience,trigger,offset_days,at_local,timezone,channel_exclusions,
   delivery,send_mode,min_nights,subject,body,enabled,configured_in_ota,migration_policy
  from public.message_automations where property_id='65_calderwood' or property_id is null
  order by id limit 201
 ), history as materialized (
  -- Do not filter by status, workflow, automation ID, or property: an unexpected
  -- row must fail validation, not disappear and allow a replacement message.
  select id,booking_id,property_id,automation_id,automation_key,fire_at,status,
   planned_check_in,planned_check_out,sent_at,provider_message_id
  from public.automation_sends where booking_id=p_booking_id order by id limit 5001
 )
 select jsonb_build_object('format',1,'observedAt',statement_timestamp(),
  'context',public.helm_channex_message_schedule_context(b.id),'admission',bound.value,
  'scope',(select jsonb_build_object('environment',s.environment,'propertyId',s.remote_property,'channelId',s.channel_id,'provider',s.provider) from helm_channex_messages.scope s where s.property_id=b.property_id),
  'booking',jsonb_build_object('id',b.id,'propertyId',b.property_id,'status',b.status,
   'duplicateOf',b.duplicate_of,'start',b.check_in,'end',b.check_out,'guestName',b.guest_name),
  'property',jsonb_build_object('id',p.id,'name',p.name,'wifiName',p.wifi_name),
  'access',case when a.property_id is null then null else jsonb_build_object(
   'smartLockCode',a.smart_lock_code,'wifiPassword',a.wifi_password) end,
  'lockMapped',exists(select 1 from public.lock_devices l where l.property_id=b.property_id and l.active),
  'currentRules',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from rules r),'[]'::jsonb),
  'ledger',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from history h),'[]'::jsonb))
 from public.bookings b join public.properties p on p.id=b.property_id
 left join public.property_access a on a.property_id=b.property_id cross join bound
 where b.id=p_booking_id and b.property_id='65_calderwood' and b.status='confirmed'
 and b.duplicate_of is null and b.hold_kind is null and b.channel='airbnb'
 and p.kind='managed' and p.is_active and p.calendar_authority='helm' and p.automations_enabled
 and bound.value is not null and helm_channex_messages.new_stay_clocks(b.id) is not null
 and (select count(*) from rules)<=200 and (select count(*) from history)<=5000
 -- Old duplicate/merged records can contain prior sends. Do not silently assign
 -- their history to a different stay or ignore it. Reconciliation is required.
 and not exists(select 1 from public.automation_sends s join family f on f.id=s.booking_id
  where f.id<>p_booking_id);
$$;

-- One booking per transaction, at most six unique workflows. All inserts roll
-- back together on a stale context, expired clock or failed cleaner release.
create function public.helm_channex_new_stay_schedule_register(p_booking uuid,p_epoch uuid,p_plans jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' as $$
declare p jsonb; result jsonb; results jsonb:='[]'::jsonb; admission jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' or jsonb_typeof(p_plans) is distinct from 'array'
 or jsonb_array_length(p_plans) not between 1 and 6 or length(p_plans::text)>16000
 then raise exception 'invalid_new_schedule_batch'; end if;
 perform 1 from helm_airbnb_bookings.scope where singleton for share;
 perform 1 from helm_channex_messages.scope where property_id='65_calderwood' for share;
 perform 1 from public.bookings where id=p_booking for update;
 admission:=public.helm_channex_new_stay_read(p_booking);
 if admission is null or admission->>'epochId' is distinct from p_epoch::text then raise exception 'new_schedule_unavailable'; end if;
 if (select count(distinct value->>'key') from jsonb_array_elements(p_plans))<>jsonb_array_length(p_plans)
 then raise exception 'duplicate_new_workflow'; end if;
 for p in select value from jsonb_array_elements(p_plans) loop
  if p->>'bookingId' is distinct from p_booking::text then raise exception 'new_schedule_identity'; end if;
  if p->>'key' in ('cleaner_reminder','cleaner_arrival') then result:=public.helm_channex_new_cleaner_register(p);
  elsif p->>'key' in ('booking_confirmed','pre_arrival','checkin_day','pre_checkout') then result:=public.helm_channex_message_register(p);
  else raise exception 'invalid_new_workflow'; end if;
  results:=results||jsonb_build_array(result);
 end loop;
 return jsonb_build_object('state','complete','results',results,'canSend',false);
end$$;

revoke all on function helm_channex_messages.new_stay_clocks(uuid),helm_channex_messages.new_stay_instant(date,text),
 helm_channex_messages.new_stay_fire(uuid,text),helm_channex_messages.booking_context_base(uuid) from public,anon,authenticated,service_role;
revoke all on function public.helm_channex_new_cleaner_register(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.helm_channex_new_stay_schedule_inputs(uuid),public.helm_channex_new_stay_schedule_register(uuid,uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.helm_channex_new_stay_schedule_inputs(uuid),public.helm_channex_new_stay_schedule_register(uuid,uuid,jsonb) to service_role;
-- Priority for the receipt-based confirmation plus a rotating slot so a blocked
-- older stay cannot starve the rest. Complete bounded population, never silently
-- truncate an unknown backlog. Readers perform no admission or scheduling writes.
create function public.helm_channex_new_stay_schedule_worklist() returns jsonb
language sql stable security definer set search_path='' set timezone='UTC' as $$
 with eligible as materialized (
 select a.booking_id,a.first_received_at from helm_channex_messages.new_stay_admissions a
 join public.properties p on p.id='65_calderwood'
 where p.automations_enabled and helm_channex_messages.new_stay_candidate(a.booking_id,a.epoch_id)=a.first_revision
 and exists(select 1 from unnest(array['booking_confirmed','pre_arrival','checkin_day','pre_checkout','cleaner_reminder','cleaner_arrival']) k
  where helm_channex_messages.new_stay_fire(a.booking_id,k)>statement_timestamp()
  and not exists(select 1 from public.automation_sends s where s.booking_id=a.booking_id and s.automation_key=k))
 order by a.first_received_at,a.booking_id limit 201
 ), numbered as (select *,row_number() over(order by first_received_at,booking_id)-1 pos from eligible),
 rotation as (select booking_id from numbered where pos=mod(floor(extract(epoch from statement_timestamp())/60)::bigint,
 greatest((select count(*) from eligible),1))),
 priority as (select e.booking_id from eligible e where not exists(select 1 from rotation r where r.booking_id=e.booking_id)
 order by case when e.first_received_at+interval '30 minutes'>statement_timestamp() then 0 else 1 end,
 e.first_received_at,e.booking_id limit 3), selected as (select * from rotation union all select * from priority)
 select case when (select count(*) from eligible)>200 then jsonb_build_object('state','overflow','bookingIds','[]'::jsonb)
 else jsonb_build_object('state','ready','bookingIds',coalesce((select jsonb_agg(booking_id order by booking_id) from selected),'[]'::jsonb)) end;
$$;
revoke all on function public.helm_channex_new_stay_schedule_worklist() from public,anon,authenticated;
grant execute on function public.helm_channex_new_stay_schedule_worklist() to service_role;
commit;
