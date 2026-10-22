-- DRAFT, NOT APPLIED. Existing Helm schema + automation-holds.sql required.
-- Install/review with the matching worker and native-dispatch exclusions before
-- registering jobs. Install channex-message-schedule.sql immediately afterward.
-- No credentials, routes, jobs, activations or customer rows.
begin;
create table public.automation_channex_routes (
 property_id text primary key references public.properties(id),
 environment text not null check(environment in ('staging','production')),
 channex_property_id uuid not null,
 channel_id uuid not null,
 provider text not null check(provider in ('Airbnb','BookingCom')),
 generation uuid not null default gen_random_uuid(),
 enabled boolean not null default false,
 source_stopped_at timestamptz,
 source_drained_at timestamptz,
 check(not enabled or (source_stopped_at is not null and source_drained_at is not null and source_drained_at >= source_stopped_at))
);
-- Receipts retain the exact route used at send time, even after disabling it.
create function public.automation_channex_route_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.property_id,new.environment,new.channex_property_id,new.channel_id,new.provider)
    is distinct from (old.property_id,old.environment,old.channex_property_id,old.channel_id,old.provider) then
   raise exception 'Message route identity is immutable';
 end if;
 return new;
end;
$$;
create trigger automation_channex_route_guard before update on public.automation_channex_routes
for each row execute function public.automation_channex_route_guard();
-- This extends a canonical automation_sends row, not a second schedule. One
-- permanent identity per stay/key survives rule replacement and process restart.
create table public.automation_channex_jobs (
 send_id uuid primary key references public.automation_sends(id),
 booking_id uuid not null references public.bookings(id),
 property_id text not null references public.automation_channex_routes(property_id),
 automation_key text not null check(btrim(automation_key) <> ''),
 route_generation uuid not null,
 channex_booking_id uuid not null,
 thread_id uuid not null,
 body_sha256 text not null check(body_sha256 ~ '^[a-f0-9]{64}$'),
 context_revision text not null check(context_revision ~ '^[a-f0-9]{32}$'),
 fire_at timestamptz not null,
 expires_at timestamptz not null,
 source_evidence_at timestamptz not null,
 source_evidence_id text not null check(btrim(source_evidence_id) <> ''),
 prepared_at timestamptz not null default clock_timestamp(),
 state text not null default 'prepared' check(state in ('prepared','attempting','unknown','rejected','accepted','recorded')),
 attempt_id uuid unique,
 attempted_at timestamptz,
 provider_message_id uuid unique,
 rejection_status integer check(rejection_status in (401,403,404,422)),
 finished_at timestamptz,
 recorded_at timestamptz,
 unique(booking_id, automation_key),
 check(source_evidence_at <= prepared_at and prepared_at < fire_at and fire_at < expires_at),
 check((state='prepared' and attempt_id is null and attempted_at is null) or
       (state<>'prepared' and attempt_id is not null and attempted_at is not null)),
 check((state in ('accepted','recorded')) = (provider_message_id is not null)),
 check((state='rejected') = (rejection_status is not null))
);
alter table public.automation_channex_routes enable row level security;
alter table public.automation_channex_jobs enable row level security;
revoke all on public.automation_channex_routes, public.automation_channex_jobs from public, anon, authenticated, service_role;
-- Writes/registration/enablement are deliberately not exposed to the worker.
grant select on public.automation_channex_routes, public.automation_channex_jobs to service_role;

-- An optimistic context token, not an authentication hash. Only the digest leaves
-- SQL. Include guest-facing times (property policy + rate plan), adjustments,
-- templates, guest identity and access sources; do not store their clear values.
create function public.automation_channex_context(p_send_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object(
 'booking',to_jsonb(b), 'property',to_jsonb(p),
 'rules',(select jsonb_agg(to_jsonb(r) order by r.id) from public.message_automations r where r.property_id=b.property_id or r.property_id is null),
 'plan',(select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.property_rate_plans r where r.property_id=b.property_id),
 'adjustments',(select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text) from public.checkout_adjustments a where a.property_id=b.property_id and a.stay_check_in=b.check_in),
 'access',(select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text) from public.property_access a where a.property_id=b.property_id),
 'codes',(select jsonb_agg(to_jsonb(c) order by c.id) from public.guest_access_codes c where c.booking_id=b.id),
 'locks',(select jsonb_agg(to_jsonb(l) order by l.device_id) from public.lock_devices l where l.property_id=b.property_id),
 'guest',(select to_jsonb(g) from public.guests g where g.id=b.guest_id)
 )::text)
 from public.automation_sends s join public.bookings b on b.id=s.booking_id
 join public.properties p on p.id=b.property_id where s.id=p_send_id;
$$;

-- Reserve the existing row for the dedicated worker. Registration must use a
-- reviewed future-unsent source manifest, exact target and masked render. This
-- trigger cannot itself establish external Guesty history/queue completeness.
create function public.automation_channex_register() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.automation_sends%rowtype;
begin
 perform 1 from public.bookings where id=new.booking_id for update;
 select * into s from public.automation_sends where id=new.send_id for update;
 if not found or s.booking_id<>new.booking_id or s.property_id<>new.property_id
   or s.automation_key is distinct from new.automation_key or s.status not in ('scheduled','held')
   or s.fire_at<>new.fire_at or s.fire_at<=clock_timestamp() or new.prepared_at>=s.fire_at or new.state<>'prepared'
   or s.provider_message_id is not null or s.sent_at is not null
   or new.context_revision is distinct from public.automation_channex_context(s.id) then
   raise exception 'Message registration context mismatch';
 end if;
 update public.automation_sends set delivery_used='channex', updated_at=clock_timestamp() where id=s.id;
 return new;
end;
$$;
create trigger automation_channex_register before insert on public.automation_channex_jobs
for each row execute function public.automation_channex_register();

-- A legacy sender or operator paste cannot consume or reroute a reserved job.
create function public.automation_channex_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare j public.automation_channex_jobs%rowtype;
begin
 select * into j from public.automation_channex_jobs where send_id=old.id;
 if not found then return new; end if;
 if new.delivery_used is distinct from 'channex' or new.booking_id<>old.booking_id
   or new.property_id<>old.property_id or new.automation_key is distinct from old.automation_key then
   raise exception 'Reserved Channex message cannot be rerouted';
 end if;
 if new.status='sending' and old.status<>'sending' and
   (j.state<>'attempting' or current_setting('helm.channex_claim',true) is distinct from j.attempt_id::text) then
   raise exception 'Channex message requires durable claim';
 end if;
 if new.status='sent' and (j.state not in ('accepted','recorded') or
   new.provider_message_id is distinct from j.provider_message_id::text) then
   raise exception 'Channex acceptance receipt required';
 end if;
 return new;
end;
$$;
create trigger automation_channex_guard before update on public.automation_sends
for each row execute function public.automation_channex_guard();

create function public.automation_channex_read(p_send_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('sendId',j.send_id,'environment',r.environment,
 'propertyId',r.channex_property_id,'channelId',r.channel_id,'provider',r.provider,
 'bookingId',j.channex_booking_id,'threadId',j.thread_id,'bodySha256',j.body_sha256,
 'contextRevision',j.context_revision,'state',j.state,'attemptId',j.attempt_id,
 'providerMessageId',j.provider_message_id)
 from public.automation_channex_jobs j join public.automation_channex_routes r using(property_id)
 where j.send_id=p_send_id;
$$;

create function public.automation_channex_claim(p_send_id uuid,p_attempt_id uuid,p_attempt jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare
 j public.automation_channex_jobs%rowtype; r public.automation_channex_routes%rowtype;
 s public.automation_sends%rowtype; b public.bookings%rowtype;
 p public.properties%rowtype; rule public.message_automations%rowtype; stamp timestamptz;
begin
 if p_attempt_id is null or p_attempt is null then return false; end if;
 select * into j from public.automation_channex_jobs where send_id=p_send_id;
 if not found then return false; end if;
 -- Booking before send matches cancellation and hold writers. Locks end before
 -- HTTP; once a claim wins, a subsequent hold cannot recall an in-flight POST.
 select * into r from public.automation_channex_routes where property_id=j.property_id for share;
 select * into b from public.bookings where id=j.booking_id for update;
 select * into s from public.automation_sends where id=p_send_id for update;
 select * into j from public.automation_channex_jobs where send_id=p_send_id for update;
 select * into p from public.properties where id=j.property_id for share;
 select * into rule from public.message_automations where id=s.automation_id for share;
 stamp:=clock_timestamp();
 if j.state<>'prepared' or not r.enabled or r.generation<>j.route_generation
   or r.source_stopped_at is null or r.source_drained_at is null or r.source_drained_at>j.source_evidence_at
   or j.source_evidence_at>stamp or s.status<>'scheduled' or s.delivery_used is distinct from 'channex'
   or s.provider_message_id is not null or s.sent_at is not null
   or s.booking_id<>j.booking_id or s.property_id<>j.property_id or s.automation_key is distinct from j.automation_key
   or b.status is distinct from 'confirmed' or b.duplicate_of is not null or b.property_id<>j.property_id
   or b.check_in is distinct from s.planned_check_in or b.check_out is distinct from s.planned_check_out
   or s.fire_at<>j.fire_at or s.fire_at>stamp or j.expires_at<=stamp
   or p.automations_enabled is distinct from true or p.calendar_authority is distinct from 'helm'
   or rule.id is null or not rule.enabled or rule.audience<>'guest' or rule.send_mode<>'auto' or rule.configured_in_ota
   or rule.key<>j.automation_key or (rule.property_id is not null and rule.property_id<>j.property_id)
   or b.channel is null
   or (r.provider='Airbnb' and lower(b.channel::text) is distinct from 'airbnb')
   or (r.provider='BookingCom' and lower(b.channel::text) not in ('booking.com','booking_com','bookingcom'))
   or lower(b.channel::text)=any(select lower(x) from unnest(rule.channel_exclusions) x)
   or exists(select 1 from public.message_automations o where rule.property_id is null and o.property_id=j.property_id and o.key=rule.key)
   or exists(select 1 from public.automation_sends other where other.booking_id=j.booking_id and other.automation_key=j.automation_key and other.id<>s.id)
   or j.context_revision is distinct from public.automation_channex_schedule_context(s.id)
   or j.fire_at is distinct from public.automation_channex_schedule(s.id)
   or rule.trigger is distinct from (case j.workflow when 'confirmation' then 'booking_confirmed'
      when 'key_code' then 'checkin_day' when 'pre_arrival' then 'pre_arrival' when 'pre_checkout' then 'pre_checkout' end)
   or (rule.min_nights is not null and b.check_out-b.check_in<rule.min_nights)
   or p_attempt is distinct from jsonb_build_object('environment',r.environment,'propertyId',r.channex_property_id,
      'channelId',r.channel_id,'provider',r.provider,'bookingId',j.channex_booking_id,'threadId',j.thread_id,'bodySha256',j.body_sha256)
 then return false; end if;
 update public.automation_channex_jobs set state='attempting',attempt_id=p_attempt_id,attempted_at=stamp where send_id=p_send_id;
 perform set_config('helm.channex_claim',p_attempt_id::text,true);
 update public.automation_sends set status='sending',updated_at=stamp where id=p_send_id;
 return true; -- ONLY a newly committed claim permits one POST; replay returns false.
end;
$$;

create function public.automation_channex_finish(p_send_id uuid,p_attempt_id uuid,p_state text,
 p_provider_id uuid default null,p_rejection_status integer default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.automation_channex_jobs%rowtype; stamp timestamptz;
begin
 -- Match booking -> send -> job lock order used by claim/holds/cancellation.
 select * into j from public.automation_channex_jobs where send_id=p_send_id;
 if not found then return false; end if;
 perform 1 from public.bookings where id=j.booking_id for update;
 perform 1 from public.automation_sends where id=p_send_id for update;
 select * into j from public.automation_channex_jobs where send_id=p_send_id for update;
 if p_attempt_id is null or j.attempt_id is distinct from p_attempt_id
   or p_state is null or p_state not in ('unknown','rejected','accepted','recorded')
   or ((p_state in ('accepted','recorded')) <> (p_provider_id is not null))
   or ((p_state='rejected') <> (p_rejection_status is not null))
   or (p_rejection_status is not null and p_rejection_status not in (401,403,404,422)) then return false; end if;
 -- Result writes can be replayed; a claim never can. Do not downgrade acceptance.
 if j.state=p_state then return j.provider_message_id is not distinct from p_provider_id
   and j.rejection_status is not distinct from p_rejection_status; end if;
 if (p_state='recorded' and (j.state<>'accepted' or j.provider_message_id is distinct from p_provider_id))
   or (p_state<>'recorded' and j.state<>'attempting') then return false; end if;
 stamp:=clock_timestamp();
 update public.automation_channex_jobs set state=p_state,provider_message_id=p_provider_id,
 rejection_status=p_rejection_status,finished_at=coalesce(finished_at,stamp),
 recorded_at=case when p_state='recorded' then stamp else recorded_at end where send_id=p_send_id;
 -- Preserve a cancellation arriving after the claim. The attempt receipt remains
 -- authoritative even if the schedule row is now cancelled/parked.
 if p_state in ('accepted','recorded') then
  update public.automation_sends set status='sent',provider_message_id=p_provider_id::text,
   sent_at=coalesce(sent_at,stamp),updated_at=stamp,error=null where id=p_send_id and status='sending';
 elsif p_state in ('unknown','rejected') then
  update public.automation_sends set status='failed',updated_at=stamp,
   error=case when p_state='unknown' then 'Channex outcome unknown; do not resend' else 'Channex rejected; retry requires review' end
   where id=p_send_id and status='sending';
 end if;
 return true;
end;
$$;
revoke all on function public.automation_channex_context(uuid), public.automation_channex_register(),
 public.automation_channex_guard(), public.automation_channex_route_guard(), public.automation_channex_read(uuid),
 public.automation_channex_claim(uuid,uuid,jsonb),public.automation_channex_finish(uuid,uuid,text,uuid,integer)
 from public, anon, authenticated;
grant execute on function public.automation_channex_context(uuid), public.automation_channex_read(uuid),
 public.automation_channex_claim(uuid,uuid,jsonb),public.automation_channex_finish(uuid,uuid,text,uuid,integer) to service_role;
commit;
