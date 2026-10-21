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
 from public.automation_channex_jobs j join public.automation_sends s on s.id=j.send_id
 join public.bookings b on b.id=j.booking_id join public.properties p on p.id=b.property_id
 join public.automation_channex_stay_times t on t.booking_id=b.id and t.check_in=b.check_in and t.check_out=b.check_out
 join public.message_automations r on r.id=s.automation_id
 left join public.property_rate_plans plan on plan.property_id=b.property_id
 left join public.checkout_adjustments a on a.property_id=b.property_id and a.stay_check_in=b.check_in
 left join public.property_access pa on pa.property_id=b.property_id
 left join public.guests g on g.id=b.guest_id
 where j.send_id=p_send_id and t.observed_at<=statement_timestamp();
$$;

-- Calendar-day offsets preserve Guesty's relative ETA/ETD semantics across DST.
-- Missing clocks and nonexistent local wall times block, without default clocks.
create function public.automation_channex_schedule(p_send_id uuid) returns timestamptz
language plpgsql stable security definer set search_path='' as $$
declare input jsonb; flow text; confirmation timestamptz; wall timestamp; instant timestamptz; zone text;
begin
 input:=public.automation_channex_render_input(p_send_id);
 if input is null then return null; end if;
 select j.workflow,t.confirmed_at into flow,confirmation from public.automation_channex_jobs j
 join public.automation_channex_stay_times t on t.booking_id=j.booking_id where j.send_id=p_send_id;
 if flow='confirmation' then return confirmation+interval '30 minutes'; end if;
 zone:=input->>'timeZone';
 if zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then return null; end if;
 if flow='pre_checkout' then
   wall:=((input->'booking'->>'check_out')::date-1)+(input->'plan'->>'checkout_time')::time;
 else
   wall:=((input->'booking'->>'check_in')::date-case when flow='pre_arrival' then 1 else 0 end)
     +(input->'plan'->>'checkin_time')::time;
 end if;
 instant:=wall at time zone zone;
 if instant at time zone zone is distinct from wall then return null; end if;
 -- Ambiguous fall-back wall clocks also require a source-specific resolution.
 if (instant-interval '1 hour') at time zone zone=wall or (instant+interval '1 hour') at time zone zone=wall then return null; end if;
 return instant-case when flow='key_code' then interval '1 hour' else interval '0' end;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end;
$$;

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
