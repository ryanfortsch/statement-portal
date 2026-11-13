-- Dormant cleaner ledger. No enrollment, clearance, schedule, template edit or SMS.
begin;
set local lock_timeout='5s';

-- A reviewed enrollment is deliberately not mintable by a scheduling RPC.
-- Its separate source evidence must cover the cleaner workflow/provider queue.
create table helm_channex_messages.cleaner_releases (
 id uuid primary key,
 property_id text not null unique references helm_channex_messages.scope(property_id) check(property_id='65_calderwood'),
 route_generation uuid not null,
 capture_id uuid not null references helm_channex_messages.template_captures(id),
 rules_sha256 text not null check(rules_sha256 ~ '^[a-f0-9]{64}$'),
 recipient_revision text not null check(recipient_revision ~ '^[a-f0-9]{32}$'),
 key_id text not null check(key_id ~ '^[a-zA-Z0-9_-]{1,48}$'),
 recipient_hmac text not null check(recipient_hmac ~ '^[a-f0-9]{64}$'),
 target_hmac text not null check(target_hmac ~ '^[a-f0-9]{64}$'),
 source_stopped_at timestamptz not null check(isfinite(source_stopped_at)),
 source_drained_at timestamptz not null check(isfinite(source_drained_at)),
 source_evidence_id uuid not null,
 actor text not null check(length(btrim(actor)) between 1 and 200),
 reviewed_at timestamptz not null default clock_timestamp() check(isfinite(reviewed_at)),
 check(source_stopped_at<=source_drained_at and source_drained_at<=reviewed_at)
);
create table helm_channex_messages.cleaner_jobs (
 send_id uuid primary key references public.automation_sends(id),
 booking_id uuid not null references public.bookings(id),
 automation_id uuid not null references public.message_automations(id),
 release_id uuid not null references helm_channex_messages.cleaner_releases(id),
 binding_id uuid not null references helm_channex_messages.timing_bindings(id),
 property_id text not null check(property_id='65_calderwood'),
 automation_key text not null check(automation_key in ('cleaner_reminder','cleaner_arrival')),
 key_id text not null check(key_id ~ '^[a-zA-Z0-9_-]{1,48}$'),
 context_revision text not null check(context_revision ~ '^[a-f0-9]{32}$'),
 recipient_hmac text not null check(recipient_hmac ~ '^[a-f0-9]{64}$'),
 target_hmac text not null check(target_hmac ~ '^[a-f0-9]{64}$'),
 body_sha256 text not null check(body_sha256 ~ '^[a-f0-9]{64}$'),
 fire_at timestamptz not null check(isfinite(fire_at)),
 expires_at timestamptz not null check(isfinite(expires_at)),
 prepared_at timestamptz not null default clock_timestamp(),
 held boolean not null default false,
 state text not null default 'prepared' check(state in ('prepared','attempting','aborted','unknown','rejected','accepted','delivered','undelivered')),
 attempt_id uuid unique, attempted_at timestamptz,
 provider_message_id text unique check(provider_message_id ~ '^AC[A-Za-z0-9_-]{1,100}$'),
 provider_status text check(provider_status in ('queued','sent','delivered','undelivered')),
 provider_updated_at timestamptz check(isfinite(provider_updated_at)),
 rejection_status integer check(rejection_status in (400,401,402,403,404)),
 finished_at timestamptz,
 unique(booking_id,automation_key),
 check(prepared_at<fire_at and fire_at<expires_at and expires_at<=fire_at+interval '30 minutes'),
 check((state='prepared')=(attempt_id is null) and (attempt_id is null)=(attempted_at is null)),
 check((state in ('accepted','delivered','undelivered'))=(provider_message_id is not null)),
 check((provider_message_id is null)=(provider_status is null)),
 check(provider_updated_at is null or provider_message_id is not null),
 check(state not in ('delivered','undelivered') or (provider_status=state and provider_updated_at is not null)),
 check((state='rejected')=(rejection_status is not null))
);
create table helm_channex_messages.cleaner_hold_events (
 id bigint generated always as identity primary key,
 send_id uuid not null references helm_channex_messages.cleaner_jobs(send_id),
 held boolean not null, actor text not null check(length(btrim(actor)) between 1 and 200),
 happened_at timestamptz not null default clock_timestamp()
);
alter table helm_channex_messages.cleaner_releases enable row level security;
alter table helm_channex_messages.cleaner_jobs enable row level security;
alter table helm_channex_messages.cleaner_hold_events enable row level security;
revoke all on helm_channex_messages.cleaner_releases,helm_channex_messages.cleaner_jobs,
 helm_channex_messages.cleaner_hold_events from public,anon,authenticated,service_role;
revoke all on sequence helm_channex_messages.cleaner_hold_events_id_seq from public,anon,authenticated,service_role;
create trigger cleaner_release_immutable before update or delete on helm_channex_messages.cleaner_releases
 for each row execute function helm_channex_messages.template_capture_immutable();

-- Private revision includes every competing covering recipient. A later broad
-- enrollment, revoked access, token/phone/language change invalidates the release.
create function helm_channex_messages.cleaner_recipient_revision() returns text
language sql stable security definer set search_path='' as $$
 select case when count(*)=1 and bool_and(r.enabled and r.language='en'
   and r.property_ids=array['65_calderwood']::text[] and r.phone ~ '^\+[1-9][0-9]{7,14}$'
   and r.portal_token ~ '^([a-f0-9]{16}|[a-f0-9]{32})$')
 then md5(jsonb_agg(jsonb_build_object('enabled',r.enabled,'region',r.region,
  'properties',r.property_ids,'phone',r.phone,'token',r.portal_token,'language',r.language) order by r.phone)::text) end
 from public.cleaner_schedule_recipients r where r.enabled and
  ('65_calderwood'=any(r.property_ids) or (cardinality(r.property_ids)=0 and r.region='bridgeport_ct'));
$$;
create function helm_channex_messages.cleaner_rule_valid(p_release uuid,p_rule uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from helm_channex_messages.cleaner_releases x
 join helm_channex_messages.template_captures c on c.id=x.capture_id and c.rules_sha256=x.rules_sha256
 join public.message_automations r on r.id=p_rule
 cross join lateral jsonb_array_elements(c.rules) original
 where r.property_id=x.property_id and r.audience='cleaner' and r.key in ('cleaner_reminder','cleaner_arrival')
 and helm_channex_messages.prepared_template_valid(r) and x.id=p_release
 and original->>'id'=r.id::text and to_jsonb(r)-array['created_at','updated_at','created_by']=original);
$$;

-- Original source time only; DST disagreement must still be reviewed, never
-- silently replaced by a cleaner deadline or an invented confirmation timestamp.
create function helm_channex_messages.cleaner_source_fire(p_row jsonb,p_key text) returns timestamptz
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare c jsonb; clock text; arrival timestamptz; target timestamptz; day date;
begin
 c:=p_row->'clocks';
 if p_row is null or c->>'timezone' is distinct from 'America/New_York'
  or not c ? 'plannedArrival' then return null; end if;
 clock:=case when c->'plannedArrival'='null'::jsonb then c->>'defaultArrival' else c->>'plannedArrival' end;
 if clock is null or clock !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
 day:=(p_row->>'start')::date;
 arrival:=(day::text||' '||clock)::timestamp at time zone 'America/New_York';
 if to_char(arrival at time zone 'America/New_York','YYYY-MM-DD HH24:MI')<>day::text||' '||clock
  or to_char((arrival-interval '1 hour') at time zone 'America/New_York','HH24:MI')=clock
  or to_char((arrival+interval '1 hour') at time zone 'America/New_York','HH24:MI')=clock then return null; end if;
 if p_key='cleaner_arrival' then
  if clock<>'16:00' then return null; end if;
  return arrival-interval '7 hours';
 elsif p_key='cleaner_reminder' then
  target:=((day-10)::text||' '||clock)::timestamp at time zone 'America/New_York';
  if target=arrival-interval '240 hours'
   and to_char(target at time zone 'America/New_York','YYYY-MM-DD HH24:MI')=(day-10)::text||' '||clock
   and to_char((target-interval '1 hour') at time zone 'America/New_York','HH24:MI')<>clock
   and to_char((target+interval '1 hour') at time zone 'America/New_York','HH24:MI')<>clock then return target; end if;
 end if;
 return null;
end$$;

create function helm_channex_messages.cleaner_fire(p_binding uuid,p_booking uuid,p_key text) returns timestamptz
language sql stable security definer set search_path='' set timezone='UTC' as $$
 select helm_channex_messages.cleaner_source_fire(v,p_key)
 from (select public.helm_channex_timing_binding_read(p_binding)->'evidence'->'row' v) source
 where v->>'bookingId'=p_booking::text;
$$;

create function public.helm_channex_cleaner_read(p_send_id uuid) returns jsonb
language sql stable security definer set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('sendId',j.send_id,'bookingId',j.booking_id,'automationId',j.automation_id,
 'releaseId',j.release_id,'propertyId',j.property_id,'key',j.automation_key,'keyId',j.key_id,
 'contextRevision',j.context_revision,'recipientHmac',j.recipient_hmac,'targetHmac',j.target_hmac,'bodySha256',j.body_sha256,
 'fireAt',to_char(j.fire_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'expiresAt',to_char(j.expires_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'state',j.state,'attemptId',j.attempt_id,'providerMessageId',j.provider_message_id,'providerStatus',j.provider_status,
 'providerUpdatedAt',to_char(j.provider_updated_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 from helm_channex_messages.cleaner_jobs j where j.send_id=p_send_id;
$$;

-- Source queue clearance is separate from the guest-message scope's evidence.
-- No RPC in this migration creates either record or releases any template flags.
create function helm_channex_messages.cleaner_ready(p_release uuid,p_booking uuid,p_rule uuid,p_binding uuid,p_revision text) returns boolean
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
 and exists(select 1 from helm_channex_messages.timing_bindings t where t.id=p_binding and t.booking_id=b.id
  and t.intent->'context'->>'contextRevision'=p_revision)
 and public.helm_channex_timing_binding_read(p_binding) is not null
 and not helm_channex_messages.descendant_history(b.id));
$$;

create function public.helm_channex_cleaner_register(p_plan jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' as $$
declare j helm_channex_messages.cleaner_jobs; prior helm_channex_messages.cleaner_jobs;
 x helm_channex_messages.cleaner_releases; b public.bookings;
begin
 if current_setting('transaction_isolation')<>'read committed' or jsonb_typeof(p_plan) is distinct from 'object'
 or length(p_plan::text)>3000 or (select count(*) from jsonb_object_keys(p_plan))<>14
 or not p_plan ?& array['sendId','bookingId','automationId','releaseId','bindingId','propertyId','key','keyId',
 'contextRevision','recipientHmac','targetHmac','bodySha256','fireAt','expiresAt']
 or exists(select 1 from jsonb_each(p_plan) e where jsonb_typeof(e.value)<>'string')
 then raise exception 'invalid_cleaner_registration'; end if;
 j.send_id:=(p_plan->>'sendId')::uuid; j.booking_id:=(p_plan->>'bookingId')::uuid;
 j.automation_id:=(p_plan->>'automationId')::uuid; j.release_id:=(p_plan->>'releaseId')::uuid;
 j.binding_id:=(p_plan->>'bindingId')::uuid; j.property_id:=p_plan->>'propertyId'; j.automation_key:=p_plan->>'key';
 j.key_id:=p_plan->>'keyId'; j.context_revision:=p_plan->>'contextRevision'; j.recipient_hmac:=p_plan->>'recipientHmac';
 j.target_hmac:=p_plan->>'targetHmac'; j.body_sha256:=p_plan->>'bodySha256';
 j.fire_at:=(p_plan->>'fireAt')::timestamptz; j.expires_at:=(p_plan->>'expiresAt')::timestamptz;
 if j.property_id<>'65_calderwood' or j.automation_key not in ('cleaner_reminder','cleaner_arrival')
 or j.context_revision !~ '^[a-f0-9]{32}$' or j.body_sha256 !~ '^[a-f0-9]{64}$'
 or not isfinite(j.fire_at) or not isfinite(j.expires_at) or j.expires_at<=j.fire_at or j.expires_at>j.fire_at+interval '30 minutes'
 or exists(select 1 from unnest(array['fireAt','expiresAt']) k where p_plan->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$')
 then raise exception 'invalid_cleaner_registration'; end if;
 perform 1 from helm_channex_messages.scope where property_id=j.property_id for share;
 select * into b from public.bookings where id=j.booking_id for update;
 if not found or b.property_id<>j.property_id then raise exception 'cleaner_registration_unavailable'; end if;
 select * into prior from helm_channex_messages.cleaner_jobs where booking_id=j.booking_id and automation_key=j.automation_key;
 if found then
  if (prior.send_id,prior.automation_id,prior.release_id,prior.binding_id,prior.property_id,prior.key_id,prior.context_revision,
   prior.recipient_hmac,prior.target_hmac,prior.body_sha256,prior.fire_at,prior.expires_at) is distinct from
   (j.send_id,j.automation_id,j.release_id,j.binding_id,j.property_id,j.key_id,j.context_revision,
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
 insert into helm_channex_messages.cleaner_jobs(send_id,booking_id,automation_id,release_id,binding_id,property_id,automation_key,
 key_id,context_revision,recipient_hmac,target_hmac,body_sha256,fire_at,expires_at)
 values(j.send_id,j.booking_id,j.automation_id,j.release_id,j.binding_id,j.property_id,j.automation_key,
 j.key_id,j.context_revision,j.recipient_hmac,j.target_hmac,j.body_sha256,j.fire_at,j.expires_at);
 perform set_config('helm.cleaner_registration','',true);
 return jsonb_build_object('state','created','sendId',j.send_id);
end$$;

create function public.helm_channex_cleaner_claim(p_job jsonb,p_attempt_id uuid,p_attempt jsonb) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare j helm_channex_messages.cleaner_jobs; s public.automation_sends; stamp timestamptz;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_attempt_id is null or p_job is null then return false; end if;
 select * into j from helm_channex_messages.cleaner_jobs where send_id=(p_job->>'sendId')::uuid;
 if not found then return false; end if;
 perform 1 from helm_channex_messages.scope where property_id=j.property_id for share;
 perform 1 from public.bookings where id=j.booking_id for update;
 select * into s from public.automation_sends where id=j.send_id for update;
 select * into j from helm_channex_messages.cleaner_jobs where send_id=j.send_id for update;
 lock table public.cleaner_schedule_recipients in share mode;
 perform 1 from public.properties where id=j.property_id for share;
 perform 1 from public.message_automations where id=j.automation_id for share;
 stamp:=clock_timestamp();
 if j.state<>'prepared' or j.held or s.status is distinct from 'scheduled' or s.delivery_used is distinct from 'sms'
 or s.provider_message_id is not null or s.sent_at is not null
 or public.helm_channex_cleaner_read(j.send_id) is distinct from p_job
 or p_attempt is distinct from jsonb_build_object('keyId',j.key_id,'targetHmac',j.target_hmac,'bodySha256',j.body_sha256)
 or j.fire_at>stamp or j.expires_at<=stamp or s.fire_at is distinct from j.fire_at
 or (s.booking_id,s.automation_id,s.property_id,s.automation_key) is distinct from (j.booking_id,j.automation_id,j.property_id,j.automation_key)
 or not helm_channex_messages.cleaner_ready(j.release_id,j.booking_id,j.automation_id,j.binding_id,j.context_revision)
 or helm_channex_messages.cleaner_fire(j.binding_id,j.booking_id,j.automation_key) is distinct from j.fire_at
 or exists(select 1 from public.automation_sends other left join public.message_automations r on r.id=other.automation_id
  where other.booking_id=j.booking_id and other.id<>j.send_id and (other.automation_key=j.automation_key
   or other.automation_key is null or (r.key is not null and r.key<>other.automation_key)))
 then return false; end if;
 update helm_channex_messages.cleaner_jobs set state='attempting',attempt_id=p_attempt_id,attempted_at=stamp where send_id=j.send_id;
 perform set_config('helm.cleaner_transition',j.send_id::text,true);
 update public.automation_sends set status='sending',updated_at=stamp where id=j.send_id;
 if not found then raise exception 'cleaner_claim_ledger_conflict'; end if;
 perform set_config('helm.cleaner_transition','',true);
 return true;
end$$;

create function public.helm_channex_cleaner_finish(p_send_id uuid,p_attempt_id uuid,p_outcome jsonb) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare j helm_channex_messages.cleaner_jobs; target text; pid text; ps text; ts timestamptz; refusal integer; stamp timestamptz;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_attempt_id is null
 or jsonb_typeof(p_outcome) is distinct from 'object' or length(p_outcome::text)>1000 then return false; end if;
 target:=p_outcome->>'state'; pid:=p_outcome->>'providerMessageId'; ps:=p_outcome->>'providerStatus';
 if target is null or target not in ('aborted','unknown','rejected','accepted','delivered','undelivered') then return false; end if;
 if target in ('accepted','delivered','undelivered') then
  if pid is null or pid !~ '^AC[A-Za-z0-9_-]{1,100}$' or ps is null or ps not in ('queued','sent','delivered','undelivered')
   or p_outcome-array['state','providerMessageId','providerStatus','providerUpdatedAt']<>'{}'::jsonb
   or (select count(*) from jsonb_object_keys(p_outcome)) not in (3,4) then return false; end if;
  if p_outcome ? 'providerUpdatedAt' then
   if jsonb_typeof(p_outcome->'providerUpdatedAt')<>'string' or p_outcome->>'providerUpdatedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$' then return false; end if;
   ts:=(p_outcome->>'providerUpdatedAt')::timestamptz;
   if not isfinite(ts) or ts>clock_timestamp()+interval '1 minute' then return false; end if;
  end if;
  if target in ('delivered','undelivered') and (ps<>target or ts is null) then return false; end if;
 elsif target='rejected' then
  if (select count(*) from jsonb_object_keys(p_outcome))<>2 or jsonb_typeof(p_outcome->'rejectionStatus') is distinct from 'number' then return false; end if;
  if p_outcome->>'rejectionStatus' !~ '^(400|401|402|403|404)$' then return false; end if;
  refusal:=(p_outcome->>'rejectionStatus')::integer;
  if refusal not in (400,401,402,403,404) or p_outcome->'rejectionStatus'<>to_jsonb(refusal) then return false; end if;
 elsif p_outcome<>jsonb_build_object('state',target) then return false;
 end if;
 select * into j from helm_channex_messages.cleaner_jobs where send_id=p_send_id;
 if not found then return false; end if;
 perform 1 from public.bookings where id=j.booking_id for update;
 perform 1 from public.automation_sends where id=p_send_id for update;
 select * into j from helm_channex_messages.cleaner_jobs where send_id=p_send_id for update;
 if j.attempt_id is distinct from p_attempt_id or j.state='prepared' then return false; end if;
 if j.state in ('aborted','rejected','delivered','undelivered') then
  return (j.state,j.provider_message_id,j.provider_status,j.provider_updated_at,j.rejection_status) is not distinct from (target,pid,ps,ts,refusal);
 end if;
 if j.state='unknown' and target not in ('unknown','accepted','delivered','undelivered') then return false; end if;
 if j.state='accepted' and (target not in ('accepted','delivered','undelivered') or j.provider_message_id is distinct from pid
  or (j.provider_updated_at is not null and (ts is null or ts<j.provider_updated_at))
  or (j.provider_status<>ps and (j.provider_status in ('delivered','undelivered') or j.provider_status='sent' and ps='queued')))
 then return false; end if;
 stamp:=clock_timestamp();
 update helm_channex_messages.cleaner_jobs set state=target,provider_message_id=pid,provider_status=ps,
 provider_updated_at=ts,rejection_status=refusal,finished_at=coalesce(finished_at,stamp) where send_id=p_send_id;
 perform set_config('helm.cleaner_transition',p_send_id::text,true);
 update public.automation_sends set status=case when target in ('accepted','delivered','undelivered') then 'sent' else 'failed' end,
 provider_message_id=pid,sent_at=case when pid is not null then coalesce(sent_at,stamp) else null end,
 error=case when target in ('accepted','delivered') then null else 'Cleaner SMS '||target end,updated_at=stamp where id=p_send_id;
 if not found then raise exception 'cleaner_receipt_ledger_conflict'; end if;
 perform set_config('helm.cleaner_transition','',true);
 return true;
end$$;

create function public.helm_channex_cleaner_hold(p_send_id uuid,p_held boolean,p_actor text) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare j helm_channex_messages.cleaner_jobs;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_held is null or p_actor is null
  or length(btrim(p_actor)) not between 1 and 200 then return false; end if;
 select * into j from helm_channex_messages.cleaner_jobs where send_id=p_send_id;
 if not found then return false; end if;
 perform 1 from public.bookings where id=j.booking_id for update;
 select * into j from helm_channex_messages.cleaner_jobs where send_id=p_send_id for update;
 if j.state<>'prepared' then return false; end if;
 if j.held=p_held then return true; end if;
 update helm_channex_messages.cleaner_jobs set held=p_held where send_id=p_send_id;
 insert into helm_channex_messages.cleaner_hold_events(send_id,held,actor) values(p_send_id,p_held,btrim(p_actor));
 return true;
end$$;

-- Only the dedicated registration may reserve a frozen cleaner rule. Updates of
-- an existing reserved row are separately fenced by the cleaner history guard.
create or replace function helm_channex_messages.prepared_send_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare rule public.message_automations;
begin
 if tg_op='UPDATE' and exists(select 1 from helm_channex_messages.cleaner_jobs where send_id=old.id) then return new; end if;
 if tg_op='INSERT' and current_setting('helm.cleaner_registration',true)=new.id::text
  and new.delivery_used='sms' and new.status='scheduled' and new.automation_key in ('cleaner_reminder','cleaner_arrival')
  and exists(select 1 from helm_channex_messages.cleaner_releases x where x.property_id=new.property_id
   and helm_channex_messages.cleaner_rule_valid(x.id,new.automation_id)) then return new; end if;
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
   or not helm_channex_messages.released_template_valid(rule) then return null; end if;
 end if;
 return new;
end$$;

create function helm_channex_messages.cleaner_history_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_value public.automation_sends; root uuid; j helm_channex_messages.cleaner_jobs;
begin
 if tg_op='DELETE' then row_value:=old; else row_value:=new; end if;
 if row_value.property_id<>'65_calderwood' or not exists(select 1 from helm_channex_messages.cleaner_jobs) then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 root:=helm_channex_messages.lock_family(row_value.booking_id);
 if root<>row_value.booking_id and exists(select 1 from helm_channex_messages.cleaner_jobs where booking_id=root)
 then raise exception 'cleaner_descendant_history_conflict'; end if;
 if tg_op='INSERT' and exists(select 1 from helm_channex_messages.cleaner_jobs existing_job left join public.message_automations r on r.id=new.automation_id
  where existing_job.booking_id=root and (new.automation_key is null or new.automation_key=existing_job.automation_key or (r.key is not null and r.key<>new.automation_key)))
 then raise exception 'cleaner_history_conflict'; end if;
 if tg_op='UPDATE' then
  select * into j from helm_channex_messages.cleaner_jobs where send_id=old.id;
  if found then
   if (to_jsonb(new)-array['updated_at','status','error','sent_at','provider_message_id'])
    is distinct from (to_jsonb(old)-array['updated_at','status','error','sent_at','provider_message_id']) then return null; end if;
   if current_setting('helm.cleaner_transition',true) is distinct from old.id::text and
    not (new.status='cancelled' and new.sent_at is not distinct from old.sent_at and new.provider_message_id is not distinct from old.provider_message_id
      and (exists(select 1 from public.bookings where id=j.booking_id and status<>'confirmed')
        or exists(select 1 from public.properties where id=j.property_id and not automations_enabled))) then return null; end if;
  end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end$$;
create trigger channex_message_01_cleaner_history before insert or update or delete on public.automation_sends
 for each row execute function helm_channex_messages.cleaner_history_guard();

revoke all on function helm_channex_messages.cleaner_recipient_revision(),helm_channex_messages.cleaner_rule_valid(uuid,uuid),
 helm_channex_messages.cleaner_source_fire(jsonb,text),
 helm_channex_messages.cleaner_fire(uuid,uuid,text),helm_channex_messages.cleaner_ready(uuid,uuid,uuid,uuid,text),
 helm_channex_messages.cleaner_history_guard() from public,anon,authenticated,service_role;
revoke all on function public.helm_channex_cleaner_read(uuid),public.helm_channex_cleaner_register(jsonb),
 public.helm_channex_cleaner_claim(jsonb,uuid,jsonb),public.helm_channex_cleaner_finish(uuid,uuid,jsonb),
 public.helm_channex_cleaner_hold(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.helm_channex_cleaner_read(uuid),public.helm_channex_cleaner_register(jsonb),
 public.helm_channex_cleaner_claim(jsonb,uuid,jsonb),public.helm_channex_cleaner_finish(uuid,uuid,jsonb),
 public.helm_channex_cleaner_hold(uuid,boolean,text) to service_role;
commit;
