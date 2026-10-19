-- CANDIDATE ONLY. Apply only to the isolated staging project after canonical-schema review.
-- Requires real canonical bookings/RPCs and booking-inventory-events.sql.
-- No property seeds, production migrations, scheduler, message sender or channel writes.
begin;
create schema if not exists helm_channex_revisions;
revoke all on schema helm_channex_revisions from public, anon, authenticated, service_role;

create table if not exists helm_channex_revisions.scope (
  singleton boolean primary key default true check(singleton),
  property_id text not null unique references public.properties(id),
  enabled boolean not null default false,
  check (property_id = 'HELMTEST-calderwood')
);
create table if not exists helm_channex_revisions.bookings (
  remote_id uuid primary key,
  canonical_id uuid not null unique references public.bookings(id),
  code text not null unique,
  latest_at timestamptz not null,
  latest_revision uuid not null
);
create table if not exists helm_channex_revisions.receipts (
  revision_id uuid primary key,
  canonical_id uuid not null references public.bookings(id),
  revision jsonb not null,
  outcome text not null check(outcome in ('applied','stale')),
  committed_at timestamptz not null default clock_timestamp()
);
alter table helm_channex_revisions.scope enable row level security;
alter table helm_channex_revisions.bookings enable row level security;
alter table helm_channex_revisions.receipts enable row level security;
revoke all on all tables in schema helm_channex_revisions from public, anon, authenticated, service_role;

create or replace function public.helm_pilot_revision_receipt(p_id uuid)
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('revision', revision, 'canonicalBookingId', canonical_id,
    'outcome', outcome, 'committed', true)
  from helm_channex_revisions.receipts where revision_id=p_id;
$$;
revoke all on function public.helm_pilot_revision_receipt(uuid) from public, anon, authenticated;
grant execute on function public.helm_pilot_revision_receipt(uuid) to service_role;

create or replace function public.helm_pilot_revision_commit(p_revision jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; v_remote uuid; v_at timestamptz; v_in date; v_out date; v_status public.booking_status;
  v_scope helm_channex_revisions.scope;
  v_map helm_channex_revisions.bookings;
  v_saved helm_channex_revisions.receipts;
  v_row public.bookings; v_outcome text := 'applied'; v_capture boolean;
begin
  if p_revision is null or jsonb_typeof(p_revision) <> 'object'
    or (select count(*) from jsonb_object_keys(p_revision)) <> 10
    or not (p_revision ?& array['id','bookingId','propertyId','roomTypeId','ratePlanId','code','status','checkIn','checkOut','receivedAt'])
    or exists(select 1 from jsonb_each(p_revision) where jsonb_typeof(value) <> 'string')
    or p_revision->>'propertyId' <> '30584a9a-8784-4eb1-a387-e26bd43aec1c'
    or p_revision->>'roomTypeId' <> 'f795ae2c-f47d-4751-86ff-e883b6d30800'
    or p_revision->>'ratePlanId' <> '7f95b731-ff05-4c41-99c9-f39b3e772fec'
    or p_revision->>'code' !~ '^HELMTEST-[A-Za-z0-9_-]{1,100}$'
    or p_revision->>'status' not in ('new','modified','cancelled')
    or p_revision->>'checkIn' !~ '^\d{4}-\d{2}-\d{2}$'
    or p_revision->>'checkOut' !~ '^\d{4}-\d{2}-\d{2}$'
    or p_revision->>'receivedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
  then raise exception 'invalid_synthetic_revision'; end if;
  v_id := (p_revision->>'id')::uuid; v_remote := (p_revision->>'bookingId')::uuid;
  v_at := (p_revision->>'receivedAt')::timestamptz;
  v_in := (p_revision->>'checkIn')::date; v_out := (p_revision->>'checkOut')::date;
  if v_out <= v_in or v_out-v_in > 366 then raise exception 'invalid_revision_span'; end if;
  -- Match capture configuration's table-before-row order. A disable cannot slip
  -- between the prerequisite read and the booking write, leaving an ACK without capture.
  lock table public.bookings in row exclusive mode;
  -- Scope lock serializes revision writers and operator disable, not unrelated properties.
  select * into v_scope from helm_channex_revisions.scope where singleton for update;
  if not found or not v_scope.enabled then raise exception 'revision_import_disabled'; end if;
  perform 1 from public.properties where id=v_scope.property_id and calendar_authority='helm' for share;
  if not found then
    raise exception 'synthetic_helm_property_required';
  end if;
  select enabled into v_capture from public.helm_inventory_capture_scopes where property_id=v_scope.property_id;
  if v_capture is distinct from true then raise exception 'inventory_capture_required'; end if;
  select * into v_saved from helm_channex_revisions.receipts where revision_id=v_id;
  if found then
    if v_saved.revision <> p_revision then raise exception 'revision_identity_conflict'; end if;
    return public.helm_pilot_revision_receipt(v_id);
  end if;
  select * into v_map from helm_channex_revisions.bookings where remote_id=v_remote;
  v_status := case when p_revision->>'status'='cancelled' then 'cancelled'::public.booking_status else 'confirmed'::public.booking_status end;
  if found then
    if v_map.code <> p_revision->>'code' then raise exception 'booking_identity_changed'; end if;
    if v_at = v_map.latest_at then raise exception 'ambiguous_revision_order'; end if;
    select * into v_row from public.bookings where id=v_map.canonical_id for update;
    if v_row.property_id is distinct from v_scope.property_id or v_row.source_ref is distinct from ('channex-staging:' || v_remote)
      or v_row.duplicate_of is not null or v_row.source <> 'manual' or v_row.channel <> 'other' then
      raise exception 'canonical_booking_ownership_changed';
    end if;
    if v_at < v_map.latest_at then v_outcome := 'stale';
    else
      -- Use the ordinary canonical RPC: cancellation pauses waiting automation_sends.
      select * into v_row from public.helm_move_booking(v_map.canonical_id,v_in,v_out,v_status,'channex-staging',false);
      update helm_channex_revisions.bookings set latest_at=v_at,latest_revision=v_id where remote_id=v_remote;
    end if;
  else
    -- Refuse adoption of an unrelated legacy/source row; identity is never inferred from dates.
    if exists(select 1 from public.bookings where source_ref='channex-staging:' || v_remote) then
      raise exception 'unmapped_canonical_booking';
    end if;
    select * into v_row from public.helm_create_booking(v_scope.property_id,'other','manual',v_status,v_in,v_out,
      jsonb_build_object('guest_name','Fictional Channex rehearsal','external_confirmation_code',p_revision->>'code',
        'source_ref','channex-staging:' || v_remote), 'channex-staging',false);
    insert into helm_channex_revisions.bookings values(v_remote,v_row.id,p_revision->>'code',v_at,v_id);
  end if;
  insert into helm_channex_revisions.receipts(revision_id,canonical_id,revision,outcome)
    values(v_id,v_row.id,p_revision,v_outcome);
  return public.helm_pilot_revision_receipt(v_id);
end $$;
revoke all on function public.helm_pilot_revision_commit(jsonb) from public, anon, authenticated;
grant execute on function public.helm_pilot_revision_commit(jsonb) to service_role;
commit;
