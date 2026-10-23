-- CANDIDATE ONLY. Not installed or wired to any worker.
-- Requires canonical Helm booking RPCs and inventory capture. No seeds or activation.
begin;
create schema if not exists helm_airbnb_bookings;
revoke all on schema helm_airbnb_bookings from public,anon,authenticated,service_role;
create table if not exists helm_airbnb_bookings.scope (
 singleton boolean primary key default true check(singleton),
 property_id text not null references public.properties(id),
 environment text not null check(environment in ('staging','production')),
 remote_property uuid not null, room_type uuid not null, rate_plan uuid not null,
 generation bigint not null check(generation between 1 and 9007199254740991),
 enabled boolean not null default false
);
create table if not exists helm_airbnb_bookings.bookings (
 remote_id uuid primary key, canonical_id uuid not null unique references public.bookings(id),
 code text not null unique, environment text not null, remote_property uuid not null, generation bigint not null,
 latest_at timestamptz not null, latest_revision uuid not null,
 check_in date not null, check_out date not null, status public.booking_status not null,
 first_received_at timestamptz not null default clock_timestamp()
);
create table if not exists helm_airbnb_bookings.receipts (
 revision_id uuid primary key, canonical_id uuid not null references public.bookings(id),
 revision jsonb not null, outcome text not null check(outcome in ('applied','stale')),
 first_received_at timestamptz not null, committed_at timestamptz not null default clock_timestamp()
);
alter table helm_airbnb_bookings.scope enable row level security;
alter table helm_airbnb_bookings.bookings enable row level security;
alter table helm_airbnb_bookings.receipts enable row level security;
revoke all on all tables in schema helm_airbnb_bookings from public,anon,authenticated,service_role;
create or replace function public.helm_airbnb_revision_receipt(p_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('revision',revision,'canonicalBookingId',canonical_id,'outcome',outcome,'committed',true,
 'committedAt',to_char(committed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'firstReceivedAt',to_char(first_received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
 from helm_airbnb_bookings.receipts where revision_id=p_id;
$$;
create or replace function public.helm_airbnb_revision_commit(p_revision jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 s helm_airbnb_bookings.scope; m helm_airbnb_bookings.bookings; saved helm_airbnb_bookings.receipts;
 b public.bookings; rid uuid; remote uuid; at_time timestamptz; din date; dout date;
 status_value public.booking_status; result text:='applied'; source_key text;
begin
 if p_revision is null or jsonb_typeof(p_revision)<>'object'
 or (select count(*) from jsonb_object_keys(p_revision))<>13
 or not(p_revision ?& array['revisionId','bookingId','propertyId','roomTypeId','ratePlanId','reservationCode','status','checkIn','checkOut','providerReceivedAt','environment','mappingGeneration','channel'])
 or exists(select 1 from jsonb_each(p_revision) where key<>'mappingGeneration' and jsonb_typeof(value)<>'string')
 or jsonb_typeof(p_revision->'mappingGeneration')<>'number'
 or p_revision->>'mappingGeneration' !~ '^[1-9][0-9]*$'
 or p_revision->>'channel'<>'airbnb' or p_revision->>'environment' not in ('staging','production')
 or p_revision->>'reservationCode' !~ '^[A-Za-z0-9_-]{1,160}$' or p_revision->>'reservationCode' ~* '^HELMTEST-'
 or p_revision->>'status' not in ('new','modified','cancelled')
 or p_revision->>'checkIn' !~ '^\d{4}-\d{2}-\d{2}$' or p_revision->>'checkOut' !~ '^\d{4}-\d{2}-\d{2}$'
 or p_revision->>'providerReceivedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
 then raise exception 'invalid_airbnb_revision'; end if;
 rid:=(p_revision->>'revisionId')::uuid; remote:=(p_revision->>'bookingId')::uuid;
 at_time:=(p_revision->>'providerReceivedAt')::timestamptz;
 if to_char(at_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>p_revision->>'providerReceivedAt' then raise exception 'invalid_revision_timestamp'; end if;
 din:=(p_revision->>'checkIn')::date; dout:=(p_revision->>'checkOut')::date;
 if dout<=din or dout-din>366 then raise exception 'invalid_revision_dates'; end if;
 lock table public.bookings in row exclusive mode;
 select * into s from helm_airbnb_bookings.scope where singleton for update;
 if not found or not s.enabled then raise exception 'airbnb_import_disabled'; end if;
 if s.environment<>p_revision->>'environment' or s.remote_property<>(p_revision->>'propertyId')::uuid
 or s.room_type<>(p_revision->>'roomTypeId')::uuid or s.rate_plan<>(p_revision->>'ratePlanId')::uuid
 or s.generation<>(p_revision->>'mappingGeneration')::bigint then raise exception 'airbnb_mapping_changed'; end if;
 perform 1 from public.properties where id=s.property_id and calendar_authority='helm' for share;
 if not found then raise exception 'helm_authority_required'; end if;
 perform 1 from public.helm_inventory_capture_scopes where property_id=s.property_id and enabled for share;
 if not found then raise exception 'inventory_capture_required'; end if;
 select * into saved from helm_airbnb_bookings.receipts where revision_id=rid;
 if found then
  if saved.revision<>p_revision then raise exception 'revision_identity_conflict'; end if;
  return public.helm_airbnb_revision_receipt(rid);
 end if;
 source_key:='channex-airbnb:'||s.environment||':'||s.remote_property||':'||remote;
 status_value:=case when p_revision->>'status'='cancelled' then 'cancelled'::public.booking_status else 'confirmed'::public.booking_status end;
 select * into m from helm_airbnb_bookings.bookings where remote_id=remote;
 if found then
  if m.code<>p_revision->>'reservationCode' or m.environment<>s.environment or m.remote_property<>s.remote_property or m.generation<>s.generation then raise exception 'booking_identity_changed'; end if;
  select * into b from public.bookings where id=m.canonical_id for update;
  if b.property_id is distinct from s.property_id or b.source_ref is distinct from source_key
  or b.duplicate_of is not null or b.source is distinct from 'manual'::public.booking_source or b.channel is distinct from 'airbnb'::public.booking_channel
  or b.check_in is distinct from m.check_in or b.check_out is distinct from m.check_out or b.status is distinct from m.status then raise exception 'canonical_booking_changed'; end if;
  if at_time=m.latest_at then raise exception 'ambiguous_revision_order'; end if;
  if at_time<m.latest_at then result:='stale';
  else
   if m.status='cancelled' and status_value<>'cancelled' then raise exception 'cancelled_booking_requires_review'; end if;
   select * into b from public.helm_move_booking(m.canonical_id,din,dout,status_value,'channex-airbnb',false);
   update helm_airbnb_bookings.bookings set latest_at=at_time,latest_revision=rid,check_in=din,check_out=dout,status=status_value where remote_id=remote;
  end if;
 else
  if exists(select 1 from public.bookings where source_ref=source_key) then raise exception 'unmapped_canonical_booking'; end if;
  select * into b from public.helm_create_booking(s.property_id,'airbnb','manual',status_value,din,dout,
   jsonb_build_object('external_confirmation_code',p_revision->>'reservationCode','source_ref',source_key),'channex-airbnb',false);
  insert into helm_airbnb_bookings.bookings(remote_id,canonical_id,code,environment,remote_property,generation,latest_at,latest_revision,check_in,check_out,status)
  values(remote,b.id,p_revision->>'reservationCode',s.environment,s.remote_property,s.generation,at_time,rid,din,dout,status_value) returning * into m;
 end if;
 insert into helm_airbnb_bookings.receipts(revision_id,canonical_id,revision,outcome,first_received_at)
 values(rid,b.id,p_revision,result,m.first_received_at);
 return public.helm_airbnb_revision_receipt(rid);
end $$;
revoke all on function public.helm_airbnb_revision_receipt(uuid),public.helm_airbnb_revision_commit(jsonb) from public,anon,authenticated;
grant execute on function public.helm_airbnb_revision_receipt(uuid),public.helm_airbnb_revision_commit(jsonb) to service_role;
commit;
