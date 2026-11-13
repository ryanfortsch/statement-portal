-- Explicit cleaner enrollment, separate from ticking the scheduler. No rows,
-- template flags, source settings, jobs or messages are created on installation.
begin;
set local lock_timeout='5s';

create function public.helm_channex_cleaner_enrollment_snapshot(p_capture_id uuid,p_digest text) returns jsonb
language sql stable security definer set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('format',1,'observedAt',to_char(statement_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'authority',p.calendar_authority,'automationsEnabled',p.automations_enabled,
  'routeGeneration',s.generation,'scopeEnabled',coalesce(s.enabled,false),
  'recipientRevision',helm_channex_messages.cleaner_recipient_revision(),
  'recipients',(select coalesce(jsonb_agg(jsonb_build_object('enabled',r.enabled,'property_ids',r.property_ids,
    'region',r.region,'phone',r.phone,'portal_token',r.portal_token,'language',r.language) order by r.phone),'[]')
    from public.cleaner_schedule_recipients r where r.enabled and
    ('65_calderwood'=any(r.property_ids) or (cardinality(r.property_ids)=0 and r.region='bridgeport_ct'))),
  'currentRules',(select jsonb_agg(to_jsonb(r)-array['created_at','updated_at','created_by'] order by r.id)
    from public.message_automations r where r.property_id=p.id and r.key in ('cleaner_reminder','cleaner_arrival')),
  'release',(select jsonb_build_object('releaseId',x.id,'captureId',x.capture_id,'templateDigest',x.rules_sha256,
    'routeGeneration',x.route_generation,'recipientRevision',x.recipient_revision,'keyId',x.key_id,
    'recipientHmac',x.recipient_hmac,'targetHmac',x.target_hmac,
    'sourceStoppedAt',to_char(x.source_stopped_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceDrainedAt',to_char(x.source_drained_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceEvidenceId',x.source_evidence_id,'actor',x.actor,
    'reviewedAt',to_char(x.reviewed_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    from helm_channex_messages.cleaner_releases x where x.property_id=p.id))
 from public.properties p
 join helm_channex_messages.template_captures c on c.property_id=p.id and c.id=p_capture_id and c.rules_sha256=p_digest
 left join helm_channex_messages.scope s on s.property_id=p.id
 where p.id='65_calderwood' and p.kind='managed' and p.is_active
 and (select count(*) from public.cleaner_schedule_recipients r where r.enabled and
    ('65_calderwood'=any(r.property_ids) or (cardinality(r.property_ids)=0 and r.region='bridgeport_ct')))<=200;
$$;

create function public.helm_channex_cleaner_enroll(p_review jsonb,p_actor text) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' as $$
declare x helm_channex_messages.cleaner_releases; old helm_channex_messages.cleaner_releases;
 s helm_channex_messages.scope; stamp timestamptz; started timestamptz; checked timestamptz;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_actor is null or length(btrim(p_actor)) not between 3 and 200
  or jsonb_typeof(p_review) is distinct from 'object' or length(p_review::text)>3000
  or (select count(*) from jsonb_object_keys(p_review))<>13
  or not p_review ?& array['releaseId','captureId','templateDigest','routeGeneration','recipientRevision','keyId',
    'recipientHmac','targetHmac','sourceStoppedAt','sourceDrainedAt','sourceEvidenceId','reviewStartedAt','reviewCheckedAt']
  or exists(select 1 from jsonb_each(p_review) e where jsonb_typeof(e.value)<>'string')
 then raise exception 'invalid_cleaner_enrollment'; end if;
 x.id:=(p_review->>'releaseId')::uuid; x.capture_id:=(p_review->>'captureId')::uuid;
 x.rules_sha256:=p_review->>'templateDigest'; x.route_generation:=(p_review->>'routeGeneration')::uuid;
 x.recipient_revision:=p_review->>'recipientRevision'; x.key_id:=p_review->>'keyId';
 x.recipient_hmac:=p_review->>'recipientHmac'; x.target_hmac:=p_review->>'targetHmac';
 x.source_stopped_at:=(p_review->>'sourceStoppedAt')::timestamptz;
 x.source_drained_at:=(p_review->>'sourceDrainedAt')::timestamptz;
 x.source_evidence_id:=(p_review->>'sourceEvidenceId')::uuid; x.actor:=btrim(p_actor);
 started:=(p_review->>'reviewStartedAt')::timestamptz; checked:=(p_review->>'reviewCheckedAt')::timestamptz;
 if x.rules_sha256 !~ '^[a-f0-9]{64}$' or x.recipient_revision !~ '^[a-f0-9]{32}$'
  or x.recipient_hmac !~ '^[a-f0-9]{64}$' or x.target_hmac !~ '^[a-f0-9]{64}$' or x.key_id !~ '^[a-zA-Z0-9_-]{1,48}$'
  or exists(select 1 from unnest(array['sourceStoppedAt','sourceDrainedAt','reviewStartedAt','reviewCheckedAt']) k
    where p_review->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
 then raise exception 'invalid_cleaner_enrollment'; end if;
 select * into s from helm_channex_messages.scope where property_id='65_calderwood' for update;
 -- This receipt is an explicit owner's assertion of separately retained cleaner
 -- evidence. It cannot create the channel/guest scope, stop Guesty or clear a queue.
 if not found then raise exception 'cleaner_handover_required'; end if;
 select * into old from helm_channex_messages.cleaner_releases where property_id='65_calderwood';
 if found then
  if (old.id,old.capture_id,old.rules_sha256,old.route_generation,old.recipient_revision,old.key_id,
    old.recipient_hmac,old.target_hmac,old.source_stopped_at,old.source_drained_at,old.source_evidence_id,old.actor)
   is distinct from (x.id,x.capture_id,x.rules_sha256,x.route_generation,x.recipient_revision,x.key_id,
    x.recipient_hmac,x.target_hmac,x.source_stopped_at,x.source_drained_at,x.source_evidence_id,x.actor)
  then raise exception 'cleaner_enrollment_conflict'; end if;
  return jsonb_build_object('state','existing','releaseId',old.id);
 end if;
 lock table public.cleaner_schedule_recipients in share mode;
 perform 1 from public.properties where id='65_calderwood' for share;
 perform 1 from public.message_automations where property_id='65_calderwood' for share;
 stamp:=clock_timestamp();
 if s.enabled is distinct from true or s.generation is distinct from x.route_generation or s.source_evidence_id is null
  or s.source_stopped_at is null or s.source_drained_at is null
  or not isfinite(s.source_stopped_at) or not isfinite(s.source_drained_at)
  or s.source_stopped_at>s.source_drained_at or s.source_drained_at>stamp
  or not isfinite(started) or not isfinite(checked) or checked>stamp or started>checked or stamp-started>interval '30 seconds'
  or not isfinite(x.source_stopped_at) or not isfinite(x.source_drained_at)
  or x.source_stopped_at>x.source_drained_at or x.source_drained_at>started
  or not exists(select 1 from public.properties p where p.id='65_calderwood' and p.kind='managed' and p.is_active and p.calendar_authority='helm')
  or x.recipient_revision is distinct from helm_channex_messages.cleaner_recipient_revision()
  or not exists(select 1 from helm_channex_messages.template_captures c where c.id=x.capture_id and c.rules_sha256=x.rules_sha256 and c.property_id='65_calderwood')
  or (select count(*) from public.message_automations r join helm_channex_messages.template_captures c on c.id=x.capture_id
    cross join lateral jsonb_array_elements(c.rules) original where r.property_id='65_calderwood'
    and r.key in ('cleaner_reminder','cleaner_arrival') and r.audience='cleaner'
    and helm_channex_messages.prepared_template_valid(r)
    and original->>'id'=r.id::text and to_jsonb(r)-array['created_at','updated_at','created_by']=original)<>2
 then raise exception 'cleaner_enrollment_not_ready'; end if;
 insert into helm_channex_messages.cleaner_releases(id,property_id,route_generation,capture_id,rules_sha256,
  recipient_revision,key_id,recipient_hmac,target_hmac,source_stopped_at,source_drained_at,source_evidence_id,actor)
 values(x.id,'65_calderwood',x.route_generation,x.capture_id,x.rules_sha256,x.recipient_revision,x.key_id,
  x.recipient_hmac,x.target_hmac,x.source_stopped_at,x.source_drained_at,x.source_evidence_id,x.actor);
 return jsonb_build_object('state','created','releaseId',x.id);
end$$;
revoke all on function public.helm_channex_cleaner_enrollment_snapshot(uuid,text),public.helm_channex_cleaner_enroll(jsonb,text)
 from public,anon,authenticated;
grant execute on function public.helm_channex_cleaner_enrollment_snapshot(uuid,text),public.helm_channex_cleaner_enroll(jsonb,text) to service_role;
commit;
