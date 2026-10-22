-- Candidate, unapplied. Isolated staging only, after canonical-revision-routing.sql
-- and message-handoff-registration.sql. No registration, activation or provider I/O.
-- Channex owns dates; the owner explicitly retains reviewed local message clocks.
-- An OTA arrival estimate is not a change to the property's check-in policy.
begin;
create table helm_channex_revisions.message_timing_policies (
 booking_id uuid primary key references public.bookings(id),
 policy_id uuid not null unique default gen_random_uuid(),
 remote_id uuid not null unique references helm_channex_revisions.bookings(remote_id),
 connection text not null,
 generation bigint not null,
 source_observation uuid not null references public.automation_message_observation_history(revision),
 latest_observation uuid not null references public.automation_message_observation_history(revision),
 latest_provider_revision uuid not null references helm_channex_revisions.receipts(revision_id),
 arrival_time time not null,
 departure_time time not null,
 confirmed_at timestamptz not null,
 evidence_id text not null,
 expires_at timestamptz not null,
 enabled boolean not null default false,
 last_checked_at timestamptz not null default '-infinity'
);
alter table helm_channex_revisions.message_timing_policies enable row level security;
revoke all on helm_channex_revisions.message_timing_policies from public,anon,authenticated,service_role;

-- One-time owner registration. Runtime callers cannot choose clocks, confirmation,
-- identity, authority or expiry. Changing a reviewed clock needs a new owner review.
create function public.helm_pilot_message_times_register(p_booking_id uuid,p_observation uuid,
 p_connection text,p_generation bigint,p_evidence_id text,p_expires_at timestamptz,p_enabled boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.bookings; m helm_channex_revisions.bookings;
 o public.automation_message_observations; t public.automation_channex_stay_times;
 policy helm_channex_revisions.message_timing_policies;
begin
 perform helm_channex_revisions.lock_route(p_connection,p_generation);
 select * into b from public.bookings where id=p_booking_id for update;
 select * into m from helm_channex_revisions.bookings where canonical_id=p_booking_id;
 select * into o from public.automation_message_observations where booking_id=p_booking_id;
 select * into t from public.automation_channex_stay_times where booking_id=p_booking_id;
 if b.id is null or m.remote_id is null or b.property_id is distinct from 'HELMTEST-calderwood'
  or b.source_ref is distinct from ('channex-staging:'||m.remote_id) or b.source is distinct from 'manual'
  or b.channel::text is distinct from 'other' or b.status::text is distinct from 'confirmed' or b.duplicate_of is not null
  or p_observation is null or o.revision is distinct from p_observation
  or not public.automation_message_observation_current(b.id)
  or o.observed_at<clock_timestamp()-interval '5 minutes'
  or t.arrival_time is null or t.departure_time is null or t.confirmed_at is null
  or p_evidence_id is null or p_evidence_id !~ '^[A-Za-z0-9_.:-]{1,160}$'
  or p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '366 days'
  or not exists(select 1 from helm_channex_revisions.receipts rc where rc.revision_id=m.latest_revision
   and rc.canonical_id=b.id and rc.outcome='applied' and rc.revision->>'checkIn'=b.check_in::text
   and rc.revision->>'checkOut'=b.check_out::text and rc.revision->>'status' in ('new','modified'))
  or p_enabled is null
 then raise exception 'Reviewed message clock policy required'; end if;
 select * into policy from helm_channex_revisions.message_timing_policies where booking_id=b.id;
 if found then
  if (policy.remote_id,policy.connection,policy.generation,policy.source_observation,policy.evidence_id,policy.expires_at,policy.enabled)
   is not distinct from (m.remote_id,p_connection,p_generation,p_observation,p_evidence_id,p_expires_at,p_enabled)
  then return policy.policy_id; end if;
  raise exception 'Message clock policy identity conflict';
 end if;
 insert into helm_channex_revisions.message_timing_policies(booking_id,remote_id,connection,generation,
 source_observation,latest_observation,latest_provider_revision,arrival_time,departure_time,confirmed_at,evidence_id,expires_at,enabled)
 values(b.id,m.remote_id,p_connection,p_generation,o.revision,o.revision,m.latest_revision,t.arrival_time,t.departure_time,
 t.confirmed_at,p_evidence_id,p_expires_at,p_enabled) returning * into policy;
 return policy.policy_id;
end $$;

-- Run after durable revision ingestion, including empty backup polls. Receipts,
-- not the ephemeral ACK feed, are the restart/retry source. A single bounded
-- transaction advances policy cursors and observations together. No send rows,
-- holds, source history, recipient decisions or sender controls are changed.
create function public.helm_pilot_message_times_refresh(p_connection text,p_generation bigint,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare policy helm_channex_revisions.message_timing_policies; b public.bookings;
 m helm_channex_revisions.bookings; receipt helm_channex_revisions.receipts;
 o public.automation_message_observations; t public.automation_channex_stay_times;
 revision uuid; scanned integer:=0; refreshed integer:=0; unchanged integer:=0;
 blocked integer:=0; inactive integer:=0;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Invalid timing batch limit'; end if;
 perform helm_channex_revisions.lock_route(p_connection,p_generation);
 for policy in select * from helm_channex_revisions.message_timing_policies where enabled
  order by last_checked_at,booking_id limit p_limit for update
 loop
  scanned:=scanned+1;
  select * into b from public.bookings where id=policy.booking_id for update;
  -- Route lock serializes refresh/registration; the booking lock fences owner
  -- observation writes and canonical cancellation/moves before checking the cursor.
  update helm_channex_revisions.message_timing_policies set last_checked_at=clock_timestamp() where booking_id=b.id;
  if policy.expires_at<=clock_timestamp() or b.status::text='cancelled' then inactive:=inactive+1;continue; end if;
  select * into m from helm_channex_revisions.bookings where remote_id=policy.remote_id;
  select * into receipt from helm_channex_revisions.receipts where revision_id=m.latest_revision;
  select * into o from public.automation_message_observations where booking_id=b.id;
  select * into t from public.automation_channex_stay_times where booking_id=b.id;
  if policy.connection is distinct from p_connection or policy.generation is distinct from p_generation
   or b.property_id is distinct from 'HELMTEST-calderwood' or b.duplicate_of is not null or b.status::text is distinct from 'confirmed'
   or b.source_ref is distinct from ('channex-staging:'||policy.remote_id) or b.source is distinct from 'manual' or b.channel::text is distinct from 'other'
   or m.canonical_id is distinct from b.id or receipt.canonical_id is distinct from b.id or receipt.outcome is distinct from 'applied'
   or receipt.revision->>'bookingId' is distinct from policy.remote_id::text or receipt.revision->>'code' is distinct from m.code
   or receipt.revision->>'checkIn' is distinct from b.check_in::text or receipt.revision->>'checkOut' is distinct from b.check_out::text
   or coalesce(receipt.revision->>'status','') not in ('new','modified')
   or o.revision is distinct from policy.latest_observation
   or (t.arrival_time,t.departure_time,t.confirmed_at) is distinct from (policy.arrival_time,policy.departure_time,policy.confirmed_at)
   or o.timing_digest is distinct from public.automation_message_timing_digest(t)
  then blocked:=blocked+1;continue; end if;
  -- A competing call may start before waiting on the route lock. Compare with
  -- the current clock, not its pre-wait statement timestamp. Timing digest and
  -- policy cursor have already been checked under the booking lock.
  if not o.invalidated and o.canonical_revision=public.automation_message_stay_revision(b.id)
    and o.observed_at<=clock_timestamp() then
   update helm_channex_revisions.message_timing_policies set latest_provider_revision=m.latest_revision where booking_id=b.id;
   unchanged:=unchanged+1;continue;
  end if;
  -- A local edit/revert without a new provider receipt cannot refresh provenance.
  if m.latest_revision=policy.latest_provider_revision then blocked:=blocked+1;continue; end if;
  revision:=public.automation_message_observe_times(b.id,public.automation_message_stay_revision(b.id),o.revision,
   jsonb_build_object('check_in',b.check_in,'check_out',b.check_out,
    'arrival_time',to_char(policy.arrival_time,'HH24:MI'),'departure_time',to_char(policy.departure_time,'HH24:MI'),
    'confirmed_at',policy.confirmed_at,'observed_at',clock_timestamp(),
    'source_revision','channex-date:'||m.latest_revision,'evidence_id','clock-policy:'||policy.policy_id));
  update helm_channex_revisions.message_timing_policies set latest_observation=revision,latest_provider_revision=m.latest_revision where booking_id=b.id;
  refreshed:=refreshed+1;
 end loop;
 return jsonb_build_object('scanned',scanned,'refreshed',refreshed,'unchanged',unchanged,'blocked',blocked,'inactive',inactive,'canSend',false);
end $$;
revoke all on function public.helm_pilot_message_times_register(uuid,uuid,text,bigint,text,timestamptz,boolean),
 public.helm_pilot_message_times_refresh(text,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.helm_pilot_message_times_refresh(text,bigint,integer) to service_role;
commit;
