-- Historical, private Guesty timing evidence only. Installs no jobs or runtime
-- callers, changes no booking/rule/authority, and does not authorize cutover.
begin;
set local lock_timeout='5s';
create table if not exists helm_channex_messages.source_timing_captures (
 id uuid primary key default gen_random_uuid(),
 property_id text not null default '65_calderwood' check(property_id='65_calderwood'),
 version integer not null default 1 check(version=1),
 source_contract text not null default 'guesty_v2_clocks_v3_confirmed_at_double_read'
  check(source_contract='guesty_v2_clocks_v3_confirmed_at_double_read'),
 started_at timestamptz not null, checked_at timestamptz not null,
 saved_at timestamptz not null default clock_timestamp(), actor text not null,
 rows jsonb not null check(jsonb_typeof(rows)='array' and jsonb_array_length(rows) between 1 and 12)
);
alter table helm_channex_messages.source_timing_captures enable row level security;
revoke all on helm_channex_messages.source_timing_captures from public,anon,authenticated,service_role;

create or replace function public.helm_channex_capture_source_timing(
 p_rows jsonb, p_started_at timestamptz, p_checked_at timestamptz, p_actor text
) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' as $$
declare
 item jsonb; clocks jsonb; b public.bookings; m public.guesty_reservations;
 bid uuid; start_day date; end_day date; confirmed timestamptz; cid uuid;
 stamp timestamptz:=clock_timestamp(); today date:=(stamp at time zone 'America/New_York')::date;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 12
 or length(p_rows::text)>16000 or p_actor is null or length(btrim(p_actor)) not between 3 and 320
 or p_started_at is null or p_checked_at is null or not isfinite(p_started_at) or not isfinite(p_checked_at)
 or p_started_at>p_checked_at or p_checked_at>stamp or p_checked_at<stamp-interval '60 seconds'
 or p_checked_at-p_started_at>interval '80 seconds'
 or (p_started_at at time zone 'America/New_York')::date<>today
 then raise exception 'source_timing_capture_invalid'; end if;
 if (select count(distinct value->>'bookingId') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows)
 or (select count(distinct value->>'guestyId') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows)
 then raise exception 'source_timing_capture_invalid'; end if;

 -- Serialize with canonical writers and retain mirror identity uniqueness through
 -- commit. SHARE also blocks a new message scope/mirror row appearing mid-capture.
 lock table helm_channex_messages.scope in share mode;
 perform pg_advisory_xact_lock(hashtext('helm_bookings:65_calderwood'));
 -- Guesty legacy backfill also writes bookings directly, outside the advisory
 -- lock. This short commit-only table lock covers those inserts/identity changes.
 lock table public.bookings, public.guesty_reservations in share mode;
 perform 1 from public.properties where id='65_calderwood'
  and calendar_authority='guesty' and automations_enabled=false for share;
 if not found or exists(select 1 from helm_channex_messages.scope)
 or exists(select 1 from helm_channex_messages.jobs)
 then raise exception 'source_timing_capture_not_dormant'; end if;
 if (select count(*) from public.bookings where property_id='65_calderwood' and duplicate_of is null
  and status in ('confirmed','completed') and check_out>today and check_in<today+500)<>jsonb_array_length(p_rows)
 then raise exception 'source_timing_capture_scope_changed'; end if;

 for item in select value from jsonb_array_elements(p_rows) order by value->>'bookingId' loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>8
  or not item ?& array['bookingId','guestyId','code','start','end','source','status','clocks']
  or exists(select 1 from unnest(array['bookingId','guestyId','code','start','end','source','status']) k
   where jsonb_typeof(item->k) is distinct from 'string')
  or item->>'guestyId' !~ '^[a-f0-9]{24}$' or item->>'code' !~ '^[A-Za-z0-9_-]{1,160}$'
  or item->>'source' not in ('ical_import','guesty_legacy') or item->>'status'<>'confirmed'
  or item->>'start' !~ '^\d{4}-\d{2}-\d{2}$' or item->>'end' !~ '^\d{4}-\d{2}-\d{2}$'
  then raise exception 'source_timing_capture_invalid'; end if;
  bid:=(item->>'bookingId')::uuid; start_day:=(item->>'start')::date; end_day:=(item->>'end')::date;
  if start_day>=end_day or end_day<=today or start_day>=today+500 then raise exception 'source_timing_capture_invalid'; end if;
  clocks:=item->'clocks';
  if jsonb_typeof(clocks) is distinct from 'object' or (select count(*) from jsonb_object_keys(clocks))<>6
  or not clocks ?& array['timezone','plannedArrival','plannedDeparture','defaultArrival','defaultDeparture','confirmedAt']
  or clocks->>'timezone' is distinct from 'America/New_York'
  or exists(select 1 from unnest(array['plannedArrival','plannedDeparture']) k where
   jsonb_typeof(clocks->k) not in ('string','null') or (clocks->>k is not null and clocks->>k !~ '^([01]\d|2[0-3]):[0-5]\d$'))
  or exists(select 1 from unnest(array['defaultArrival','defaultDeparture']) k where
   jsonb_typeof(clocks->k) is distinct from 'string' or clocks->>k !~ '^([01]\d|2[0-3]):[0-5]\d$')
  or jsonb_typeof(clocks->'confirmedAt') is distinct from 'string'
  or clocks->>'confirmedAt' !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$'
  then raise exception 'source_timing_capture_invalid'; end if;
  confirmed:=(clocks->>'confirmedAt')::timestamptz;
  if not isfinite(confirmed) or confirmed>p_started_at then raise exception 'source_timing_capture_invalid'; end if;

  select * into b from public.bookings where id=bid for share;
  if not found or b.property_id is distinct from '65_calderwood' or b.channel::text is distinct from 'airbnb'
  or b.source::text is distinct from item->>'source' or b.status::text is distinct from 'confirmed'
  or b.duplicate_of is not null or b.hold_kind is not null
  or b.check_in is distinct from start_day or b.check_out is distinct from end_day
  or b.external_confirmation_code is distinct from item->>'code'
  then raise exception 'source_timing_capture_booking_changed'; end if;
  if (select count(*) from public.bookings where property_id='65_calderwood' and duplicate_of is null
   and status<>'block' and upper(btrim(external_confirmation_code))=upper(item->>'code'))<>1
  then raise exception 'source_timing_capture_identity_ambiguous'; end if;
  select * into m from public.guesty_reservations where guesty_reservation_id=item->>'guestyId';
  if not found or m.property_id is distinct from '65_calderwood' or m.listing_id is distinct from '66797ba7f51d72001388bc29'
  or m.status is distinct from 'confirmed' or lower(m.channel) is distinct from 'airbnb'
  or m.confirmation_code is distinct from item->>'code' or m.check_in is distinct from start_day or m.check_out is distinct from end_day
  then raise exception 'source_timing_capture_mirror_changed'; end if;
  if (select count(*) from public.guesty_reservations where property_id='65_calderwood'
   and upper(btrim(confirmation_code))=upper(item->>'code'))<>1
  then raise exception 'source_timing_capture_identity_ambiguous'; end if;
 end loop;
 if p_checked_at<clock_timestamp()-interval '60 seconds' then raise exception 'source_timing_capture_expired'; end if;
 insert into helm_channex_messages.source_timing_captures(started_at,checked_at,actor,rows)
 values(p_started_at,p_checked_at,btrim(p_actor),p_rows) returning id into cid;
 return jsonb_build_object('captureId',cid,'saved',jsonb_array_length(p_rows));
end$$;
revoke all on function public.helm_channex_capture_source_timing(jsonb,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.helm_channex_capture_source_timing(jsonb,timestamptz,timestamptz,text) to service_role;
comment on table helm_channex_messages.source_timing_captures is
 'Private historical observations of existing Guesty stay clocks. No current-clock or queue-drain guarantee. Future scheduling requires separate identity/revision revalidation and handover.';
commit;
