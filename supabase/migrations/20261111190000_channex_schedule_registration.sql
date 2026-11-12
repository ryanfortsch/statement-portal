-- Atomic guest-message registration; dormant until a separately reviewed handover.
-- No scope creation, evidence creation, rule release, scheduler, cron or sends.
begin;
set local lock_timeout='5s';
create function helm_channex_messages.booking_context(p_booking_id uuid) returns text
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
create or replace function helm_channex_messages.context(p_send_id uuid) returns text
language sql stable security definer set search_path='' set timezone='UTC' as $$
 select helm_channex_messages.booking_context(s.booking_id) from public.automation_sends s where s.id=p_send_id;
$$;

-- Private revision only. It is not source timing, a body digest or authority to send.
create function public.helm_channex_message_schedule_context(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('contextRevision',helm_channex_messages.booking_context(b.id),
  'routeGeneration',r.generation,'sourceEvidenceId',r.source_evidence_id,'sourceEvidenceAt',r.source_drained_at)
 from public.bookings b join helm_channex_messages.scope r on r.property_id=b.property_id
 join public.properties p on p.id=b.property_id
 where b.id=p_booking_id and b.property_id='65_calderwood' and b.status='confirmed' and b.duplicate_of is null
 and r.enabled and r.source_evidence_id is not null and r.source_drained_at is not null
 and p.calendar_authority='helm' and p.automations_enabled;
$$;

create function public.helm_channex_message_register(p_plan jsonb) returns jsonb
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
 or rule.migration_policy is not null -- frozen captured templates still require a separate reviewed release
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

 insert into public.automation_sends(id,booking_id,automation_id,automation_key,property_id,fire_at,status,
  delivery_used,planned_check_in,planned_check_out)
 values(sid,bid,rid,workflow,b.property_id,fire,'scheduled','channex',b.check_in,b.check_out);
 if not found then raise exception 'message_registration_conflict'; end if;
 insert into helm_channex_messages.jobs(send_id,booking_id,property_id,automation_key,route_generation,remote_booking,
  thread_id,body_sha256,context_revision,fire_at,expires_at,source_evidence_at,source_evidence_id)
 values(sid,bid,b.property_id,workflow,generation,remote,thread,body_hash,revision,fire,expiry,evidence_at,evidence);
 return jsonb_build_object('state','created','sendId',sid);
end$$;
revoke all on function helm_channex_messages.booking_context(uuid) from public,anon,authenticated,service_role;
revoke all on function public.helm_channex_message_schedule_context(uuid),public.helm_channex_message_register(jsonb)
 from public,anon,authenticated;
grant execute on function public.helm_channex_message_schedule_context(uuid),public.helm_channex_message_register(jsonb) to service_role;
commit;
