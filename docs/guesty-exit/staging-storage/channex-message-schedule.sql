-- DRAFT, NOT APPLIED. Install directly after channex-message-worker.sql and
-- before registering any jobs. No seed, credentials, activation or customer data.
begin;
-- A provider-normalized timing observation, bound to the canonical stay dates.
-- NULL ETA/ETD means the source explicitly has no override, not "not fetched".
-- Confirmation is the actual event, never imported_at/first_seen_at.
create table public.automation_channex_stay_times (
 booking_id uuid primary key references public.bookings(id),
 check_in date not null,
 check_out date not null check(check_out>check_in),
 arrival_time time,
 departure_time time,
 confirmed_at timestamptz,
 observed_at timestamptz not null,
 source_evidence_id text not null check(btrim(source_evidence_id)<>''),
 check(confirmed_at is null or confirmed_at<=observed_at)
);
alter table public.automation_channex_stay_times enable row level security;
revoke all on public.automation_channex_stay_times from public,anon,authenticated,service_role;
grant select on public.automation_channex_stay_times to service_role;
alter table public.automation_channex_jobs add column workflow text not null
 check(workflow in ('confirmation','pre_arrival','key_code','pre_checkout'));
alter table public.automation_channex_jobs add column last_checked_at timestamptz;

-- Return only the fields the existing renderer needs. One statement snapshot
-- covers the context token, schedule and values; clear values stay in memory.
create function public.automation_channex_render_input(p_send_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'booking',jsonb_build_object('guest_name',to_jsonb(b)->>'guest_name','check_in',b.check_in,
    'check_out',coalesce(a.adjusted_check_out,b.check_out)),
  'guest',jsonb_build_object('first_name',to_jsonb(g)->>'first_name','full_name',to_jsonb(g)->>'full_name'),
  'property',jsonb_build_object('name',to_jsonb(p)->>'name','title',to_jsonb(p)->>'title',
    'address',to_jsonb(p)->>'address','wifi_name',to_jsonb(p)->>'wifi_name','parking',to_jsonb(p)->>'parking'),
  'plan',jsonb_build_object('checkin_time',coalesce(t.arrival_time::text,plan.checkin_time::text),
    'checkout_time',coalesce(a.adjusted_checkout_time::text,t.departure_time::text,p.default_checkout_time::text)),
  'access',jsonb_build_object('smart_lock_code',to_jsonb(pa)->>'smart_lock_code',
    'key_code_location',to_jsonb(pa)->>'key_code_location','wifi_password',to_jsonb(pa)->>'wifi_password'),
  'stayCode',(select c.code from public.guest_access_codes c where c.booking_id=b.id
    and to_jsonb(c)->>'removed_at' is null order by to_jsonb(c)->>'created_at' desc nulls last,c.id desc limit 1),
  'lockMapped',exists(select 1 from public.lock_devices l where l.property_id=b.property_id and l.active),
  'trashDay',to_jsonb(p)->>'trash_day', 'timeZone',r.timezone)
 from public.automation_sends s
 join public.bookings b on b.id=s.booking_id join public.properties p on p.id=b.property_id
 join public.automation_channex_stay_times t on t.booking_id=b.id and t.check_in=b.check_in and t.check_out=b.check_out
 join public.message_automations r on r.id=s.automation_id
 left join public.property_rate_plans plan on plan.property_id=b.property_id
 left join public.checkout_adjustments a on a.property_id=b.property_id and a.stay_check_in=b.check_in
 left join public.property_access pa on pa.property_id=b.property_id
 left join public.guests g on g.id=b.guest_id
 where s.id=p_send_id and t.observed_at<=statement_timestamp();
$$;

-- A reviewed queue timestamp is a per-message handoff fact, never a universal
-- Guesty DST policy. Only the owner-only handoff can insert it. Its observation
-- FK is installed by message-handoff-registration.sql after provenance exists.
create table public.automation_message_schedule_resolutions (
 send_id uuid primary key references public.automation_sends(id),
 workflow text not null check(workflow in ('pre_arrival','pre_checkout','cleaner_advance')),
 observation_revision uuid not null,
 context_revision text not null,
 timing_digest text not null,
 calendar_at timestamptz not null,
 elapsed_at timestamptz not null,
 scheduled_at timestamptz not null,
 source_evidence_id text not null,
 source_observed_at timestamptz not null,
 check(isfinite(calendar_at) and isfinite(elapsed_at) and calendar_at<>elapsed_at),
 check(scheduled_at in (calendar_at,elapsed_at))
);
alter table public.automation_message_schedule_resolutions enable row level security;
revoke all on public.automation_message_schedule_resolutions from public,anon,authenticated,service_role;

-- Timestamp instants hash identically across owner/worker session time zones.
create function public.automation_message_timing_digest(t public.automation_channex_stay_times) returns text
language sql immutable set search_path='' as $$
 select md5(jsonb_build_object('booking',t.booking_id,'check_in',t.check_in,'check_out',t.check_out,
 'arrival',t.arrival_time,'departure',t.departure_time,'confirmed',extract(epoch from t.confirmed_at),
 'observed',extract(epoch from t.observed_at),'evidence',t.source_evidence_id)::text);
$$;

-- Both clocks are computed from the same verified anchor. No result for a
-- missing, nonexistent or ambiguous local anchor/target. Hour offsets are elapsed.
create function public.automation_message_schedule_candidates(p_send_id uuid,p_flow text)
returns table(calendar_at timestamptz,elapsed_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare input jsonb; zone text; anchor_wall timestamp; anchor_instant timestamptz;
 wall timestamp; instant timestamptz; days_before integer;
begin
 input:=public.automation_channex_render_input(p_send_id);
 if input is null or p_flow is null or p_flow not in
   ('confirmation','pre_arrival','key_code','pre_checkout','cleaner_advance','cleaner_arrival') then return; end if;
 if p_flow='confirmation' then
   select t.confirmed_at+interval '30 minutes' into instant from public.automation_channex_stay_times t
     join public.automation_sends s on s.booking_id=t.booking_id where s.id=p_send_id;
   if instant is not null and isfinite(instant) then return query select instant,instant; end if;
   return;
 end if;
 zone:=input->>'timeZone';
 if zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then return; end if;
 if p_flow='pre_checkout' then
   anchor_wall:=(input->'booking'->>'check_out')::date+(input->'plan'->>'checkout_time')::time;
 else
   anchor_wall:=(input->'booking'->>'check_in')::date+(input->'plan'->>'checkin_time')::time;
 end if;
 anchor_instant:=anchor_wall at time zone zone;
 if anchor_instant is null or not isfinite(anchor_instant)
   or anchor_instant at time zone zone is distinct from anchor_wall
   or (anchor_instant-interval '1 hour') at time zone zone=anchor_wall
   or (anchor_instant+interval '1 hour') at time zone zone=anchor_wall then return; end if;
 days_before:=case p_flow when 'pre_arrival' then 1 when 'pre_checkout' then 1 when 'cleaner_advance' then 10 else 0 end;
 wall:=anchor_wall-days_before*interval '1 day'; instant:=wall at time zone zone;
 if instant at time zone zone is distinct from wall
   or (instant-interval '1 hour') at time zone zone=wall
   or (instant+interval '1 hour') at time zone zone=wall then return; end if;
 if days_before=0 then
   instant:=anchor_instant-case when p_flow='key_code' then interval '1 hour' else interval '7 hours' end;
   return query select instant,instant;
 else
   return query select instant,anchor_instant-days_before*interval '24 hours';
 end if;
exception when invalid_datetime_format or datetime_field_overflow then return;
end;
$$;

create function public.automation_message_resolved_schedule(p_send_id uuid,p_flow text) returns timestamptz
language plpgsql stable security definer set search_path='' as $$
declare c record; proof public.automation_message_schedule_resolutions%rowtype; digest text;
begin
 select * into c from public.automation_message_schedule_candidates(p_send_id,p_flow);
 if not found then return null; end if;
 select * into proof from public.automation_message_schedule_resolutions where send_id=p_send_id;
 if found then
   select public.automation_message_timing_digest(t) into digest from public.automation_channex_stay_times t
     join public.automation_sends s on s.booking_id=t.booking_id where s.id=p_send_id;
   if proof.workflow is distinct from p_flow or proof.context_revision is distinct from public.automation_channex_context(p_send_id)
     or proof.timing_digest is distinct from digest or proof.calendar_at is distinct from c.calendar_at
     or proof.elapsed_at is distinct from c.elapsed_at then return null; end if;
   return proof.scheduled_at;
 end if;
 if c.calendar_at=c.elapsed_at then return c.calendar_at; end if;
 return null;
end;
$$;

create function public.automation_channex_schedule(p_send_id uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
 select public.automation_message_resolved_schedule(p_send_id,j.workflow)
 from public.automation_channex_jobs j where j.send_id=p_send_id;
$$;
revoke all on function public.automation_message_timing_digest(public.automation_channex_stay_times),
 public.automation_message_schedule_candidates(uuid,text),public.automation_message_resolved_schedule(uuid,text)
 from public,anon,authenticated,service_role;

-- Use the local DATE, not the instant: refresh on a new day for "today/tomorrow"
-- merge fields without invalidating every claim between database statements.
create function public.automation_channex_schedule_context(p_send_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object('base',public.automation_channex_context(p_send_id),
   'timing',to_jsonb(t),'workflow',j.workflow,
   'render_day',case when exists(select 1 from pg_catalog.pg_timezone_names where name=r.timezone)
     then (statement_timestamp() at time zone r.timezone)::date else null end)::text)
 from public.automation_channex_jobs j join public.automation_sends s on s.id=j.send_id
 join public.message_automations r on r.id=s.automation_id
 left join public.automation_channex_stay_times t on t.booking_id=j.booking_id where j.send_id=p_send_id;
$$;

create function public.automation_channex_snapshot(p_send_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('propertyId',j.property_id,'environment',route.environment,
   'status',s.status,'revision',public.automation_channex_schedule_context(j.send_id),
   'fireAt',public.automation_channex_schedule(j.send_id),'renderAt',statement_timestamp(),
   'body',r.body,'input',public.automation_channex_render_input(j.send_id))
 from public.automation_channex_jobs j join public.automation_sends s on s.id=j.send_id
 join public.automation_channex_routes route on route.property_id=j.property_id
 left join public.message_automations r on r.id=s.automation_id where j.send_id=p_send_id;
$$;

create function public.automation_channex_refresh(p_send_id uuid,p_revision text,p_body_sha256 text,p_fire_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.automation_channex_jobs%rowtype; s public.automation_sends%rowtype; b public.bookings%rowtype;
 stamp timestamptz;
begin
 if p_revision is null or p_body_sha256 is null or p_body_sha256!~'^[a-f0-9]{64}$' or p_fire_at is null then return false; end if;
 select * into j from public.automation_channex_jobs where send_id=p_send_id;
 if not found then return false; end if;
 select * into b from public.bookings where id=j.booking_id for update;
 select * into s from public.automation_sends where id=p_send_id for update;
 select * into j from public.automation_channex_jobs where send_id=p_send_id for update;
 stamp:=clock_timestamp();
 if j.state<>'prepared' or j.attempt_id is not null or s.status not in ('scheduled','held')
   or s.delivery_used is distinct from 'channex' or s.sent_at is not null or s.provider_message_id is not null
   or b.status is distinct from 'confirmed' or b.duplicate_of is not null or b.property_id<>j.property_id
   or p_revision is distinct from public.automation_channex_schedule_context(p_send_id)
   or p_fire_at is distinct from public.automation_channex_schedule(p_send_id)
   or p_fire_at<=j.prepared_at or p_fire_at>=j.expires_at or j.expires_at<=stamp
   -- Due work may refresh content, but moving a schedule into the past is not
   -- permission to replay a historical event or revive a cancelled message.
   or (p_fire_at is distinct from j.fire_at and p_fire_at<=stamp)
 then return false; end if;
 update public.automation_channex_jobs set context_revision=p_revision,body_sha256=p_body_sha256,fire_at=p_fire_at where send_id=p_send_id;
 update public.automation_sends set fire_at=p_fire_at,planned_check_in=b.check_in,
   planned_check_out=b.check_out,updated_at=stamp where id=p_send_id;
 return true;
end;
$$;

-- Bounded property-scoped work for the EXISTING automation cron. Prepared jobs
-- refresh at least daily and when source facts change; held work never sends.
create function public.automation_channex_candidates(p_property_id text,p_environment text,p_limit integer default 10) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(q.send_id),'[]'::jsonb) from (
 select j.send_id from public.automation_channex_jobs j
 join public.automation_channex_routes r using(property_id) join public.automation_sends s on s.id=j.send_id
 where j.property_id=p_property_id and r.environment=p_environment and r.enabled
 and (j.state='accepted' or (j.state='prepared' and s.status in ('scheduled','held') and
   (j.fire_at<=statement_timestamp() or j.context_revision is distinct from public.automation_channex_schedule_context(j.send_id))))
 order by j.last_checked_at nulls first,(j.state='accepted') desc,j.fire_at,j.send_id limit greatest(0,least(coalesce(p_limit,10),10))) q;
$$;
-- Fair rotation: a blocked item must not starve other due messages. No send
-- eligibility, schedule, body, receipt or hold state is changed by this stamp.
create function public.automation_channex_checked(p_send_id uuid) returns void
language sql security definer set search_path='' as $$
 update public.automation_channex_jobs set last_checked_at=clock_timestamp() where send_id=p_send_id;
$$;
revoke all on function public.automation_channex_render_input(uuid),public.automation_channex_schedule(uuid),
 public.automation_channex_schedule_context(uuid),public.automation_channex_snapshot(uuid),
 public.automation_channex_refresh(uuid,text,text,timestamptz),public.automation_channex_candidates(text,text,integer),public.automation_channex_checked(uuid)
 from public,anon,authenticated;
grant execute on function public.automation_channex_snapshot(uuid),
 public.automation_channex_refresh(uuid,text,text,timestamptz),public.automation_channex_candidates(text,text,integer),public.automation_channex_checked(uuid) to service_role;
commit;
