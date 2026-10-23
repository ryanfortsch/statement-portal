-- Candidate upgrade, NOT INSTALLED. Isolated synthetic staging only.
-- User approved 2026-10-23: new booking confirmation = first durable Helm receipt
-- + 30 minutes. Keep actual Guesty confirmation for migrated stays. No backfill.
-- Install after message-timing-bootstrap.sql. No seed, activation or sending.
begin;
create table helm_channex_revisions.message_receipt_policy (
 singleton boolean primary key default true check(singleton),
 connection text not null,
 generation bigint not null check(generation>0),
 starts_at timestamptz not null check(isfinite(starts_at)),
 expires_at timestamptz not null check(isfinite(expires_at) and expires_at>starts_at),
 enabled boolean not null default false
);
create table helm_channex_revisions.message_receipt_anchors (
 booking_id uuid primary key references public.bookings(id),
 revision_id uuid not null unique references helm_channex_revisions.receipts(revision_id),
 remote_id uuid not null unique,
 received_at timestamptz not null check(isfinite(received_at)),
 connection text not null,
 generation bigint not null,
 basis text not null default 'helm-first-durable-receipt'
   check(basis='helm-first-durable-receipt')
);
alter table helm_channex_revisions.message_receipt_policy enable row level security;
alter table helm_channex_revisions.message_receipt_anchors enable row level security;
revoke all on helm_channex_revisions.message_receipt_policy,
 helm_channex_revisions.message_receipt_anchors from public,anon,authenticated,service_role;

-- Receipt and anchor commit in the same transaction. Rollback means neither was
-- received durably. Retries/updates never overwrite an anchor or restart a timer.
create function helm_channex_revisions.capture_message_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
declare p helm_channex_revisions.message_receipt_policy%rowtype;
 b public.bookings%rowtype; m helm_channex_revisions.bookings%rowtype;
begin
 select * into p from helm_channex_revisions.message_receipt_policy where singleton for share;
 if not found or not p.enabled or new.outcome<>'applied' or new.revision->>'status' is distinct from 'new'
   or new.committed_at<p.starts_at or new.committed_at>=p.expires_at
   or new.committed_at>clock_timestamp()
   or (new.revision->>'receivedAt')::timestamptz<p.starts_at
   or (new.revision->>'receivedAt')::timestamptz>new.committed_at
   or exists(select 1 from helm_channex_revisions.receipts
     where canonical_id=new.canonical_id and revision_id<>new.revision_id)
 then return new; end if;
 perform helm_channex_revisions.lock_route(p.connection,p.generation);
 select * into b from public.bookings where id=new.canonical_id;
 select * into m from helm_channex_revisions.bookings where canonical_id=new.canonical_id;
 if b.property_id is distinct from 'HELMTEST-calderwood' or b.status::text is distinct from 'confirmed'
   or b.duplicate_of is not null or b.source is distinct from 'manual' or b.channel::text is distinct from 'other'
   or m.remote_id is null or b.source_ref is distinct from 'channex-staging:'||m.remote_id::text
   or m.latest_revision is distinct from new.revision_id
   or m.remote_id::text is distinct from new.revision->>'bookingId'
   or exists(select 1 from public.automation_channex_stay_times where booking_id=b.id)
   or exists(select 1 from public.automation_sends where booking_id=b.id)
 then return new; end if;
 insert into helm_channex_revisions.message_receipt_anchors
   (booking_id,revision_id,remote_id,received_at,connection,generation)
 values(b.id,new.revision_id,m.remote_id,new.committed_at,p.connection,p.generation)
 on conflict(booking_id) do nothing;
 return new;
end $$;
revoke all on function helm_channex_revisions.capture_message_receipt() from public,anon,authenticated,service_role;
create trigger capture_message_receipt after insert on helm_channex_revisions.receipts
 for each row execute function helm_channex_revisions.capture_message_receipt();

-- Receipt provenance is separate: never write receipt time into confirmed_at.
-- Existing timing observations remain required by render_input and queue guards.
create function public.automation_message_confirmation_anchor(p_booking_id uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
 select coalesce(t.confirmed_at,(
   select a.received_at from helm_channex_revisions.message_receipt_anchors a
   join helm_channex_revisions.message_receipt_policy p on p.singleton and p.enabled
     and p.connection=a.connection and p.generation=a.generation
     and statement_timestamp()>=p.starts_at and statement_timestamp()<p.expires_at
   join helm_channex_revisions.bookings m on m.canonical_id=a.booking_id and m.remote_id=a.remote_id
   where a.booking_id=b.id and b.property_id='HELMTEST-calderwood'
     and b.source='manual' and b.channel::text='other'
     and b.source_ref='channex-staging:'||a.remote_id::text
 )) from public.bookings b left join public.automation_channex_stay_times t on t.booking_id=b.id
 where b.id=p_booking_id and b.status::text='confirmed' and b.duplicate_of is null;
$$;
revoke all on function public.automation_message_confirmation_anchor(uuid) from public,anon,authenticated,service_role;

create or replace function public.automation_message_schedule_candidates(p_send_id uuid,p_flow text)
returns table(calendar_at timestamptz,elapsed_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare input jsonb; zone text; anchor_wall timestamp; anchor_instant timestamptz;
 wall timestamp; instant timestamptz; days_before integer;
begin
 input:=public.automation_channex_render_input(p_send_id);
 if input is null or p_flow is null or p_flow not in
   ('confirmation','pre_arrival','key_code','pre_checkout','cleaner_advance','cleaner_arrival') then return; end if;
 if p_flow='confirmation' then
   select public.automation_message_confirmation_anchor(s.booking_id)+interval '30 minutes'
     into instant from public.automation_sends s where s.id=p_send_id;
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

commit;
