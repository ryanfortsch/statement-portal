-- DRAFT, NOT APPLIED. Install after holds, guest worker, guest schedule, cleaner
-- worker. Owner-only reviewed ingestion; no provider calls, seeds or activation.
begin;
create table public.automation_message_observations (
 booking_id uuid primary key references public.bookings(id),
 revision uuid not null unique default gen_random_uuid(),
 canonical_revision text not null,
 source_revision text not null,
 evidence_id text not null,
 observed_at timestamptz not null,
 timing_digest text not null,
 invalidated boolean not null default false
);
-- Immutable provenance survives later timing refreshes; no guest/access fields.
create table public.automation_message_observation_history (
 revision uuid primary key,
 booking_id uuid not null references public.bookings(id),
 canonical_revision text not null,
 source_revision text not null,
 evidence_id text not null,
 observed_at timestamptz not null,
 timing_digest text not null
);
create table public.automation_message_thread_bindings (
 booking_id uuid primary key references public.bookings(id),
 property_id text not null references public.automation_channex_routes(property_id),
 route_generation uuid not null,
 environment text not null,
 channel_id uuid not null,
 channex_booking_id uuid not null,
 thread_id uuid not null,
 evidence_id text not null,
 verified_at timestamptz not null,
 unique(environment,channel_id,channex_booking_id),
 unique(environment,channel_id,thread_id)
);
create table public.automation_message_handoffs (
 send_id uuid primary key references public.automation_sends(id),
 review_id uuid not null unique,
 review_digest text not null,
 observation_revision uuid not null references public.automation_message_observation_history(revision),
 source_evidence_id text not null,
 source_evidence_at timestamptz not null,
 source_stopped_at timestamptz not null,
 source_drained_at timestamptz not null,
 registered_at timestamptz not null default clock_timestamp()
);
alter table public.automation_message_observations enable row level security;
alter table public.automation_message_observation_history enable row level security;
alter table public.automation_message_thread_bindings enable row level security;
alter table public.automation_message_handoffs enable row level security;
revoke all on public.automation_message_observations,public.automation_message_observation_history,public.automation_message_thread_bindings,
 public.automation_message_handoffs from public,anon,authenticated,service_role;

-- Digest of canonical identity, status and dates, not money or contact details.
-- A trigger below also invalidates on changes that later return to old values.
create function public.automation_message_stay_revision(p_booking_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object('id',b.id,'property',b.property_id,'channel',b.channel,
 'status',b.status,'duplicate',b.duplicate_of,'check_in',b.check_in,'check_out',b.check_out,
 'external_booking_id',to_jsonb(b)->>'external_booking_id',
 'confirmation',to_jsonb(b)->>'external_confirmation_code')::text)
 from public.bookings b where b.id=p_booking_id;
$$;
create function public.automation_message_invalidate_observation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (new.property_id,new.channel,new.status,new.duplicate_of,new.check_in,new.check_out,
     to_jsonb(new)->>'external_booking_id',to_jsonb(new)->>'external_confirmation_code')
 is distinct from (old.property_id,old.channel,old.status,old.duplicate_of,old.check_in,old.check_out,
     to_jsonb(old)->>'external_booking_id',to_jsonb(old)->>'external_confirmation_code') then
   update public.automation_message_observations set invalidated=true where booking_id=new.id;
 end if;
 return new;
end;
$$;
create trigger automation_message_invalidate_observation after update on public.bookings
for each row execute function public.automation_message_invalidate_observation();

-- Timestamp instants hash identically across owner/worker session time zones.
create function public.automation_message_timing_digest(t public.automation_channex_stay_times) returns text
language sql immutable set search_path='' as $$
 select md5(jsonb_build_object('booking',t.booking_id,'check_in',t.check_in,'check_out',t.check_out,
 'arrival',t.arrival_time,'departure',t.departure_time,'confirmed',extract(epoch from t.confirmed_at),
 'observed',extract(epoch from t.observed_at),'evidence',t.source_evidence_id)::text);
$$;

create function public.automation_message_observation_current(p_booking_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select not o.invalidated and o.canonical_revision=public.automation_message_stay_revision(o.booking_id)
   and o.timing_digest=public.automation_message_timing_digest(t) and o.observed_at<=statement_timestamp()
 from public.automation_message_observations o join public.automation_channex_stay_times t using(booking_id)
 where o.booking_id=p_booking_id),false);
$$;

-- Null overrides must be explicitly present in the reviewed observation. Missing
-- fields never masquerade as verified absence. Expected revision is compare/swap.
-- An exact lost-ack replay returns the original revision without a second write.
create function public.automation_message_observe_times(p_booking_id uuid,p_canonical_revision text,
 p_expected_revision uuid,p_observation jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; old public.automation_message_observations%rowtype;
 t public.automation_channex_stay_times%rowtype; stamp timestamptz; result uuid; digest text;
begin
 select * into b from public.bookings where id=p_booking_id for update;
 if not found or b.duplicate_of is not null or b.status::text<>'confirmed'
   or p_canonical_revision is distinct from public.automation_message_stay_revision(b.id)
   or jsonb_typeof(p_observation) is distinct from 'object'
   or not (p_observation ?& array['check_in','check_out','arrival_time','departure_time','confirmed_at','observed_at','source_revision','evidence_id'])
   or exists(select 1 from jsonb_object_keys(p_observation) k where k not in
     ('check_in','check_out','arrival_time','departure_time','confirmed_at','observed_at','source_revision','evidence_id'))
   or (p_observation->>'check_in')::date is distinct from b.check_in
   or (p_observation->>'check_out')::date is distinct from b.check_out
   or coalesce(p_observation->>'source_revision','') !~ '^[A-Za-z0-9_.:-]{1,160}$'
   or coalesce(p_observation->>'evidence_id','') !~ '^[A-Za-z0-9_.:-]{1,160}$'
   or coalesce(p_observation->>'observed_at','') !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
   or (p_observation->>'confirmed_at' is not null and p_observation->>'confirmed_at' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$')
   or (p_observation->>'arrival_time' is not null and p_observation->>'arrival_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$')
   or (p_observation->>'departure_time' is not null and p_observation->>'departure_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$')
 then raise exception 'Verified stay observation mismatch'; end if;
 stamp:=(p_observation->>'observed_at')::timestamptz;
 if stamp>clock_timestamp() or stamp<clock_timestamp()-interval '5 minutes'
 then raise exception 'Stay observation is not fresh'; end if;
 t.booking_id:=b.id;t.check_in:=b.check_in;t.check_out:=b.check_out;
 t.arrival_time:=(p_observation->>'arrival_time')::time;t.departure_time:=(p_observation->>'departure_time')::time;
 t.confirmed_at:=(p_observation->>'confirmed_at')::timestamptz;
 t.observed_at:=stamp;t.source_evidence_id:=p_observation->>'evidence_id';
 if t.confirmed_at>stamp then raise exception 'Confirmation event is in the future'; end if;
 digest:=public.automation_message_timing_digest(t);
 select * into old from public.automation_message_observations where booking_id=b.id;
 if found and not old.invalidated and old.canonical_revision=p_canonical_revision and old.timing_digest=digest
    and old.source_revision=p_observation->>'source_revision' and public.automation_message_observation_current(b.id)
 then return old.revision; end if;
 if old.revision is distinct from p_expected_revision or (old.observed_at is not null and stamp<=old.observed_at)
 then raise exception 'Stay observation revision conflict'; end if;
 insert into public.automation_channex_stay_times select t.*
 on conflict(booking_id) do update set check_in=excluded.check_in,check_out=excluded.check_out,
 arrival_time=excluded.arrival_time,departure_time=excluded.departure_time,confirmed_at=excluded.confirmed_at,
 observed_at=excluded.observed_at,source_evidence_id=excluded.source_evidence_id;
 result:=gen_random_uuid();
 insert into public.automation_message_observation_history values(result,b.id,p_canonical_revision,
   p_observation->>'source_revision',t.source_evidence_id,stamp,digest);
 insert into public.automation_message_observations values(b.id,result,p_canonical_revision,
 p_observation->>'source_revision',t.source_evidence_id,stamp,digest,false)
 on conflict(booking_id) do update set revision=excluded.revision,canonical_revision=excluded.canonical_revision,
 source_revision=excluded.source_revision,evidence_id=excluded.evidence_id,observed_at=excluded.observed_at,
 timing_digest=excluded.timing_digest,invalidated=false;
 return result;
end;
$$;

-- Explicit verified mapping, never fuzzy guest-name/date matching. One provider
-- booking/thread cannot be assigned to two canonical stays. No remap RPC exists.
create function public.automation_message_bind_thread(p_booking_id uuid,p_binding jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype;r public.automation_channex_routes%rowtype;
 old public.automation_message_thread_bindings%rowtype; stamp timestamptz;
begin
 select * into b from public.bookings where id=p_booking_id;
 select * into r from public.automation_channex_routes where property_id=b.property_id for share;
 select * into b from public.bookings where id=p_booking_id for update;
 if b.id is null or r.property_id is distinct from b.property_id or b.duplicate_of is not null or b.status::text<>'confirmed'
   or p_binding->>'canonical_revision' is distinct from public.automation_message_stay_revision(b.id)
   or p_binding->>'route_generation' is distinct from r.generation::text
   or (r.provider='Airbnb' and b.channel::text<>'airbnb')
   or (r.provider='BookingCom' and b.channel::text not in ('booking.com','booking_com','bookingcom'))
   or not public.automation_message_observation_current(b.id)
   or coalesce(p_binding->>'evidence_id','') !~ '^[A-Za-z0-9_.:-]{1,160}$'
   or coalesce(p_binding->>'verified_at','') !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
   or p_binding->>'channex_booking_id' is null or p_binding->>'thread_id' is null
 then raise exception 'Verified thread binding mismatch'; end if;
 stamp:=(p_binding->>'verified_at')::timestamptz;
 if stamp>clock_timestamp() or stamp<clock_timestamp()-interval '5 minutes'
 then raise exception 'Thread verification is not fresh'; end if;
 select * into old from public.automation_message_thread_bindings where booking_id=b.id;
 if found then
   if old.property_id=r.property_id and old.route_generation=r.generation
     and old.channex_booking_id=(p_binding->>'channex_booking_id')::uuid and old.thread_id=(p_binding->>'thread_id')::uuid
   then return true; end if;
   raise exception 'Thread binding identity conflict';
 end if;
 insert into public.automation_message_thread_bindings values(b.id,r.property_id,r.generation,r.environment,r.channel_id,
 (p_binding->>'channex_booking_id')::uuid,(p_binding->>'thread_id')::uuid,p_binding->>'evidence_id',stamp);
 return true;
end;
$$;

-- Register one existing canonical schedule row. This records a reviewer assertion,
-- not a claim that SQL inspected Guesty's remote queue. Source evidence is mandatory.
-- Caller may wrap all six workflow reviews in one transaction for all-or-nothing.
create function public.automation_message_register_handoff(p_send_id uuid,p_review jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare s public.automation_sends%rowtype; b public.bookings%rowtype;
 r public.automation_channex_routes%rowtype; binding public.automation_message_thread_bindings%rowtype;
 o public.automation_message_observations%rowtype; old public.automation_message_handoffs%rowtype;
 evidence timestamptz; stopped timestamptz; drained timestamptz; expiry timestamptz; flow text;
begin
 select * into s from public.automation_sends where id=p_send_id;
 select * into r from public.automation_channex_routes where property_id=s.property_id for share;
 select * into b from public.bookings where id=s.booking_id for update;
 select * into s from public.automation_sends where id=p_send_id for update;
 select * into old from public.automation_message_handoffs where send_id=p_send_id;
 if found then
   if old.review_id=(p_review->>'review_id')::uuid and old.review_digest=md5(p_review::text) then return true; end if;
   raise exception 'Message handoff identity conflict';
 end if;
 select * into o from public.automation_message_observations where booking_id=b.id;
 if s.id is null or b.id is null or s.property_id is distinct from b.property_id or b.status::text<>'confirmed'
   or b.duplicate_of is not null or s.status not in ('scheduled','held') or s.sent_at is not null or s.provider_message_id is not null
   or s.planned_check_in is distinct from b.check_in or s.planned_check_out is distinct from b.check_out
   or s.fire_at<=clock_timestamp() or s.delivery_used in ('channex','quo_cleaner')
   or p_review->>'context_revision' is distinct from public.automation_channex_context(s.id)
   or p_review->>'observation_revision' is distinct from o.revision::text or o.revision is null
   or not public.automation_message_observation_current(b.id)
   or p_review->'complete' is distinct from 'true'::jsonb or p_review->'sent' is distinct from 'false'::jsonb
   or p_review->'queued' is distinct from 'false'::jsonb or p_review->'uncertain' is distinct from 'false'::jsonb
   or coalesce(p_review->>'evidence_id','') !~ '^[A-Za-z0-9_.:-]{1,160}$'
   or p_review->>'review_id' is null
   or exists(select 1 from unnest(array['observed_at','stopped_at','drained_at','expires_at']) k
       where coalesce(p_review->>k,'') !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$')
 then raise exception 'Verified future-unsent handoff required'; end if;
 evidence:=(p_review->>'observed_at')::timestamptz;stopped:=(p_review->>'stopped_at')::timestamptz;
 drained:=(p_review->>'drained_at')::timestamptz;expiry:=(p_review->>'expires_at')::timestamptz;flow:=p_review->>'workflow';
 if not (stopped<=drained and drained<=evidence and evidence<=clock_timestamp()
   and evidence>=clock_timestamp()-interval '5 minutes' and evidence>=o.observed_at
   and isfinite(expiry) and expiry>s.fire_at)
 then raise exception 'Source handoff timing mismatch'; end if;
 if not exists(select 1 from public.message_automations m where m.id=s.automation_id
   and m.key=s.automation_key and (m.property_id is null or m.property_id=s.property_id)
   and m.audience=case when flow in ('cleaner_advance','cleaner_arrival') then 'cleaner' else 'guest' end
   and m.trigger=case flow when 'confirmation' then 'booking_confirmed' when 'pre_arrival' then 'pre_arrival'
     when 'key_code' then 'checkin_day' when 'pre_checkout' then 'pre_checkout'
     when 'cleaner_advance' then 'pre_arrival' when 'cleaner_arrival' then 'checkin_day' end)
 then raise exception 'Workflow rule binding mismatch'; end if;
 if flow in ('confirmation','pre_arrival','key_code','pre_checkout') then
   select * into binding from public.automation_message_thread_bindings where booking_id=b.id;
   if binding.booking_id is null or binding.property_id is distinct from s.property_id or binding.route_generation is distinct from r.generation
      or r.source_stopped_at is distinct from stopped or r.source_drained_at is distinct from drained
   then raise exception 'Source route or thread binding mismatch'; end if;
   insert into public.automation_channex_jobs(send_id,booking_id,property_id,automation_key,route_generation,
     channex_booking_id,thread_id,body_sha256,context_revision,fire_at,expires_at,source_evidence_at,source_evidence_id,workflow)
   values(s.id,b.id,s.property_id,s.automation_key,r.generation,binding.channex_booking_id,binding.thread_id,
     repeat('0',64),public.automation_channex_context(s.id),s.fire_at,expiry,evidence,p_review->>'evidence_id',flow);
   if public.automation_channex_schedule(s.id) is distinct from s.fire_at then raise exception 'Verified source schedule mismatch'; end if;
   update public.automation_channex_jobs set context_revision=public.automation_channex_schedule_context(s.id) where send_id=s.id;
 elsif flow in ('cleaner_advance','cleaner_arrival') then
   if jsonb_typeof(p_review->'recipient_phones') is distinct from 'array' or p_review->>'from_number' is null
   then raise exception 'Cleaner recipient binding required'; end if;
   insert into public.automation_cleaner_batches(send_id,booking_id,property_id,automation_key,workflow,from_number,
     recipient_phones,source_stopped_at,source_drained_at,source_evidence_at,source_evidence_id,fire_at,expires_at)
   values(s.id,b.id,s.property_id,s.automation_key,flow,p_review->>'from_number',
     array(select jsonb_array_elements_text(p_review->'recipient_phones')),stopped,drained,evidence,p_review->>'evidence_id',s.fire_at,expiry);
   if public.automation_cleaner_schedule(s.id) is distinct from s.fire_at then raise exception 'Verified source schedule mismatch'; end if;
 else raise exception 'Explicit supported workflow required'; end if;
 insert into public.automation_message_handoffs(send_id,review_id,review_digest,observation_revision,
   source_evidence_id,source_evidence_at,source_stopped_at,source_drained_at)
 values(s.id,(p_review->>'review_id')::uuid,md5(p_review::text),o.revision,p_review->>'evidence_id',evidence,stopped,drained);
 return true;
end;
$$;

-- Final render gate: stale/edited/unverified timing cannot reach either sender.
create or replace function public.automation_channex_render_input(p_send_id uuid) returns jsonb
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
 where s.id=p_send_id and t.observed_at<=statement_timestamp()
   and public.automation_message_observation_current(b.id);
$$;
revoke all on function public.automation_message_timing_digest(public.automation_channex_stay_times) from public,anon,authenticated,service_role;
revoke all on function public.automation_message_stay_revision(uuid) from public,anon,authenticated,service_role;
revoke all on function public.automation_message_invalidate_observation() from public,anon,authenticated,service_role;
revoke all on function public.automation_message_observation_current(uuid) from public,anon,authenticated,service_role;
revoke all on function public.automation_message_observe_times(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.automation_message_bind_thread(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.automation_message_register_handoff(uuid,jsonb) from public,anon,authenticated,service_role;
commit;
