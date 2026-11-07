-- Dormant Calderwood-only automatic-message ledger. No seeds, activation,
-- source handoff, credentials, scheduler or message sends in this migration.
begin;
set local lock_timeout='5s';
create schema helm_channex_messages;
revoke all on schema helm_channex_messages from public,anon,authenticated,service_role;
create table helm_channex_messages.scope (
 property_id text primary key references public.properties(id) check(property_id='65_calderwood'),
 environment text not null check(environment='production'),
 remote_property uuid not null check(remote_property='320c5cb5-91e0-46af-b9b3-a3fc20b4631e'),
 channel_id uuid not null, provider text not null check(provider='Airbnb'),
 generation uuid not null default gen_random_uuid(), enabled boolean not null default false,
 source_stopped_at timestamptz, source_drained_at timestamptz, source_evidence_id uuid,
 check(not enabled or (source_stopped_at is not null and source_drained_at is not null
   and source_evidence_id is not null and isfinite(source_stopped_at) and isfinite(source_drained_at)
   and source_drained_at>=source_stopped_at))
);
-- Extends the canonical send row; never a second schedule or a plaintext body.
create table helm_channex_messages.jobs (
 send_id uuid primary key references public.automation_sends(id),
 booking_id uuid not null references public.bookings(id),
 property_id text not null references helm_channex_messages.scope(property_id),
 automation_key text not null check(automation_key in ('booking_confirmed','pre_arrival','checkin_day','pre_checkout')),
 route_generation uuid not null, remote_booking uuid not null, thread_id uuid not null,
 body_sha256 text not null check(body_sha256 ~ '^[a-f0-9]{64}$'),
 context_revision text not null check(context_revision ~ '^[a-f0-9]{32}$'),
 fire_at timestamptz not null check(isfinite(fire_at)),
 expires_at timestamptz not null check(isfinite(expires_at)),
 source_evidence_at timestamptz not null check(isfinite(source_evidence_at)), source_evidence_id uuid not null,
 prepared_at timestamptz not null default clock_timestamp(),
 held boolean not null default false, version bigint not null default 1 check(version>0),
 state text not null default 'prepared' check(state in ('prepared','attempting','unknown','rejected','accepted','recorded')),
 attempt_id uuid unique, attempted_at timestamptz, provider_message_id uuid unique,
 rejection_status integer check(rejection_status in (401,403,404,422)), finished_at timestamptz, recorded_at timestamptz,
 unique(booking_id,automation_key),
 check(source_evidence_at<=prepared_at and isfinite(prepared_at) and prepared_at<fire_at
   and fire_at<expires_at and expires_at<=fire_at+interval '1 day'),
 check((state='prepared' and attempt_id is null and attempted_at is null) or
       (state<>'prepared' and attempt_id is not null and attempted_at is not null)),
 check((state in ('accepted','recorded'))=(provider_message_id is not null)),
 check((state='rejected')=(rejection_status is not null))
);
create table helm_channex_messages.hold_events (
 id bigint generated always as identity primary key, send_id uuid not null references helm_channex_messages.jobs(send_id),
 held boolean not null, actor text not null check(length(actor) between 1 and 200),
 happened_at timestamptz not null default clock_timestamp()
);
alter table helm_channex_messages.scope enable row level security;
alter table helm_channex_messages.jobs enable row level security;
alter table helm_channex_messages.hold_events enable row level security;
revoke all on all tables in schema helm_channex_messages from public,anon,authenticated,service_role;
revoke all on all sequences in schema helm_channex_messages from public,anon,authenticated,service_role;

-- Optimistic change token only, never a credential or send authorization. Include
-- every renderer dependency, with stable ordering/time zone; clear values do not
-- leave SQL. The final claim rechecks it. Later edits cannot recall a claimed POST.
create function helm_channex_messages.context(p_send_id uuid) returns text
language sql stable security definer set search_path='' set timezone='UTC' as $$
 select md5(jsonb_build_object('booking',to_jsonb(b),'property',to_jsonb(p),
 'rules',(select jsonb_agg(to_jsonb(r) order by r.id) from public.message_automations r where r.property_id=b.property_id or r.property_id is null),
 'plan',(select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.property_rate_plans r where r.property_id=b.property_id),
 'adjustments',(select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text) from public.checkout_adjustments a where a.property_id=b.property_id and a.stay_check_in=b.check_in),
 'access',(select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text) from public.property_access a where a.property_id=b.property_id),
 'codes',(select jsonb_agg(to_jsonb(c) order by c.id) from public.guest_access_codes c where c.booking_id=b.id),
 'locks',(select jsonb_agg(to_jsonb(l) order by l.device_id) from public.lock_devices l where l.property_id=b.property_id),
 'guest',(select to_jsonb(g) from public.guests g where g.id=b.guest_id))::text)
 from public.automation_sends s join public.bookings b on b.id=s.booking_id
 join public.properties p on p.id=b.property_id where s.id=p_send_id;
$$;
create function helm_channex_messages.scope_guard() returns trigger
language plpgsql set search_path='' as $$begin
 if (new.property_id,new.environment,new.remote_property,new.channel_id,new.provider)
 is distinct from (old.property_id,old.environment,old.remote_property,old.channel_id,old.provider)
 then raise exception 'message_scope_identity_immutable'; end if;
 return new;
end$$;
create trigger channex_message_scope_guard before update on helm_channex_messages.scope
 for each row execute function helm_channex_messages.scope_guard();

-- Registration/enablement remain privileged reviewed operations; no public RPC
-- can mint a source proof, route, job or historical send. The real source evidence
-- and exact future Guesty timing must be established by the later handoff flow.
create function helm_channex_messages.register_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.automation_sends; r helm_channex_messages.scope;
begin
 select * into r from helm_channex_messages.scope where property_id=new.property_id for share;
 perform 1 from public.bookings where id=new.booking_id for update;
 select * into s from public.automation_sends where id=new.send_id for update;
 if not found or s.booking_id is distinct from new.booking_id or s.property_id is distinct from new.property_id
 or s.automation_key is distinct from new.automation_key or s.status is distinct from 'scheduled'
 or s.fire_at is distinct from new.fire_at or s.fire_at<=clock_timestamp() or new.state<>'prepared'
 or s.provider_message_id is not null or s.sent_at is not null
 or new.route_generation is distinct from r.generation
 or new.context_revision is distinct from helm_channex_messages.context(s.id)
 or not exists(select 1 from helm_airbnb_bookings.bookings m where m.canonical_id=new.booking_id
   and m.remote_id=new.remote_booking and m.remote_property=r.remote_property and m.environment=r.environment)
 or exists(select 1 from public.automation_sends other where other.booking_id=new.booking_id
   and other.automation_key=new.automation_key and other.id<>new.send_id)
 then raise exception 'message_registration_mismatch'; end if;
 update public.automation_sends set delivery_used='channex',updated_at=clock_timestamp() where id=s.id;
 return new;
end$$;
create trigger channex_message_register before insert on helm_channex_messages.jobs
 for each row execute function helm_channex_messages.register_guard();

-- An override rule must not create a second legacy send for a reserved stay/key.
-- Inserts and registration serialize on the booking; unrelated homes are untouched.
create function helm_channex_messages.insert_guard() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from helm_channex_messages.scope where property_id=new.property_id) then return new; end if;
 perform 1 from public.bookings where id=new.booking_id for update;
 if exists(select 1 from helm_channex_messages.jobs where booking_id=new.booking_id
   and automation_key=new.automation_key and send_id<>new.id) then return null; end if;
 return new;
end$$;
create trigger channex_message_insert_guard before insert on public.automation_sends
 for each row execute function helm_channex_messages.insert_guard();

-- A legacy worker must neither claim a reserved row nor stop a batch containing
-- unrelated rows. Identity/rerouting errors still fail closed. This also protects
-- old deployments in the skew window, independent of their query exclusions.
create function helm_channex_messages.send_guard() returns trigger
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
 return new;
end$$;
create trigger channex_message_send_guard before update on public.automation_sends
 for each row execute function helm_channex_messages.send_guard();

create function public.helm_channex_message_read(p_send_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('sendId',j.send_id,'environment',r.environment,'propertyId',r.remote_property,
 'channelId',r.channel_id,'provider',r.provider,'bookingId',j.remote_booking,'threadId',j.thread_id,
 'bodySha256',j.body_sha256,'contextRevision',j.context_revision,'state',j.state,
 'attemptId',j.attempt_id,'providerMessageId',j.provider_message_id)
 from helm_channex_messages.jobs j join helm_channex_messages.scope r using(property_id) where j.send_id=p_send_id;
$$;
create function public.helm_channex_message_claim(p_send_id uuid,p_attempt_id uuid,p_attempt jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare j helm_channex_messages.jobs; r helm_channex_messages.scope; s public.automation_sends;
 b public.bookings; p public.properties; rule public.message_automations; stamp timestamptz;
begin
 if p_attempt_id is null or p_attempt is null then return false; end if;
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
 or r.source_drained_at>j.source_evidence_at or j.source_evidence_at>stamp
 or s.status is distinct from 'scheduled' or s.delivery_used is distinct from 'channex'
 or s.provider_message_id is not null or s.sent_at is not null
 or (s.booking_id,s.property_id,s.automation_key) is distinct from (j.booking_id,j.property_id,j.automation_key)
 or b.status is distinct from 'confirmed' or b.duplicate_of is not null or b.property_id<>j.property_id
 or b.channel is distinct from 'airbnb'::public.booking_channel
 or b.check_in is distinct from s.planned_check_in or b.check_out is distinct from s.planned_check_out
 or s.fire_at is distinct from j.fire_at or s.fire_at>stamp or j.expires_at<=stamp
 or p.automations_enabled is distinct from true or p.calendar_authority is distinct from 'helm'
 or rule.id is null or not rule.enabled or rule.audience<>'guest' or rule.send_mode<>'auto' or rule.configured_in_ota
 or rule.key<>j.automation_key or rule.trigger<>j.automation_key
 or (rule.property_id is not null and rule.property_id<>j.property_id)
 or (rule.min_nights is not null and b.check_out-b.check_in<rule.min_nights)
 or 'airbnb'=any(select lower(x) from unnest(rule.channel_exclusions) x)
 or exists(select 1 from public.message_automations o where rule.property_id is null and o.property_id=j.property_id and o.key=rule.key)
 or exists(select 1 from public.automation_sends other where other.booking_id=j.booking_id and other.automation_key=j.automation_key and other.id<>s.id)
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
create function public.helm_channex_message_finish(p_send_id uuid,p_attempt_id uuid,p_state text,
 p_provider_id uuid default null,p_rejection_status integer default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare j helm_channex_messages.jobs; stamp timestamptz;
begin
 select * into j from helm_channex_messages.jobs where send_id=p_send_id;
 if not found then return false; end if;
 perform 1 from public.bookings where id=j.booking_id for update;
 perform 1 from public.automation_sends where id=p_send_id for update;
 select * into j from helm_channex_messages.jobs where send_id=p_send_id for update;
 if p_attempt_id is null or j.attempt_id is distinct from p_attempt_id
 or p_state is null or p_state not in ('unknown','rejected','accepted','recorded')
 or ((p_state in ('accepted','recorded'))<>(p_provider_id is not null))
 or ((p_state='rejected')<>(p_rejection_status is not null))
 or (p_rejection_status is not null and p_rejection_status not in (401,403,404,422)) then return false; end if;
 if j.state=p_state then return j.provider_message_id is not distinct from p_provider_id
   and j.rejection_status is not distinct from p_rejection_status; end if;
 if (p_state='recorded' and (j.state<>'accepted' or j.provider_message_id is distinct from p_provider_id))
 or (p_state<>'recorded' and j.state<>'attempting') then return false; end if;
 stamp:=clock_timestamp();
 update helm_channex_messages.jobs set state=p_state,provider_message_id=p_provider_id,rejection_status=p_rejection_status,
 finished_at=coalesce(finished_at,stamp),recorded_at=case when p_state='recorded' then stamp else recorded_at end,
 version=version+1 where send_id=p_send_id;
 -- Receipt survives a later cancellation; never resurrect its schedule row.
 if p_state in ('accepted','recorded') then
  update public.automation_sends set status='sent',provider_message_id=p_provider_id::text,sent_at=coalesce(sent_at,stamp),
  updated_at=stamp,error=null where id=p_send_id and status='sending';
 else
  update public.automation_sends set status='failed',updated_at=stamp,
  error=case when p_state='unknown' then 'Channex outcome unknown; do not resend' else 'Channex rejected; retry requires review' end
  where id=p_send_id and status='sending';
 end if;
 return true;
end$$;
create function public.helm_channex_message_set_hold(p_send_id uuid,p_expected_version bigint,p_hold boolean,p_actor text) returns boolean
language plpgsql security definer set search_path='' as $$
declare j helm_channex_messages.jobs; b public.bookings; s public.automation_sends;
begin
 if p_hold is null or p_expected_version is null or p_actor is null or length(btrim(p_actor)) not between 1 and 200 then return false; end if;
 select * into j from helm_channex_messages.jobs where send_id=p_send_id;
 if not found then return false; end if;
 select * into b from public.bookings where id=j.booking_id for update;
 select * into s from public.automation_sends where id=p_send_id for update;
 select * into j from helm_channex_messages.jobs where send_id=p_send_id for update;
 if j.version<>p_expected_version or j.state<>'prepared' or j.held=p_hold or s.status is distinct from 'scheduled'
 or (not p_hold and (b.status is distinct from 'confirmed' or b.duplicate_of is not null
   or b.check_in is distinct from s.planned_check_in or b.check_out is distinct from s.planned_check_out
   or j.expires_at<=clock_timestamp() or j.context_revision is distinct from helm_channex_messages.context(s.id))) then return false; end if;
 update helm_channex_messages.jobs set held=p_hold,version=version+1 where send_id=p_send_id;
 insert into helm_channex_messages.hold_events(send_id,held,actor) values(p_send_id,p_hold,btrim(p_actor));
 return true;
end$$;
revoke all on all functions in schema helm_channex_messages from public,anon,authenticated,service_role;
revoke all on function public.helm_channex_message_read(uuid),public.helm_channex_message_claim(uuid,uuid,jsonb),
 public.helm_channex_message_finish(uuid,uuid,text,uuid,integer),public.helm_channex_message_set_hold(uuid,bigint,boolean,text)
 from public,anon,authenticated;
grant execute on function public.helm_channex_message_read(uuid),public.helm_channex_message_claim(uuid,uuid,jsonb),
 public.helm_channex_message_finish(uuid,uuid,text,uuid,integer),public.helm_channex_message_set_hold(uuid,bigint,boolean,text) to service_role;
commit;
