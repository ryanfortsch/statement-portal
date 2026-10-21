-- Candidate only: isolated Calderwood staging, after canonical-revisions.sql.
-- A conflict is NOT a receipt or permission to acknowledge the provider.
begin;
create table if not exists helm_channex_revisions.conflicts (
 revision_id uuid primary key,
 revision jsonb not null,
 reason text not null check(reason in ('booking_overlap','revision_identity_conflict','booking_identity_changed',
   'ambiguous_revision_order','canonical_booking_ownership_changed','unmapped_canonical_booking')),
 observations bigint not null default 1 check(observations between 1 and 9007199254740991),
 first_seen_at timestamptz not null default clock_timestamp(),
 last_seen_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz
);
alter table helm_channex_revisions.conflicts enable row level security;
revoke all on helm_channex_revisions.conflicts from public,anon,authenticated,service_role;

create or replace function public.helm_pilot_revision_observe(p_revision jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_id uuid; v_remote uuid; v_at timestamptz; v_in date; v_out date;
 v_prior helm_channex_revisions.conflicts; v_result jsonb; v_reason text;
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
 -- Same lock order as the original importer, retained across the inner rollback.
 lock table public.bookings in row exclusive mode;
 perform 1 from helm_channex_revisions.scope where singleton and enabled for update;
 if not found then raise exception 'revision_import_disabled'; end if;
 perform 1 from public.properties where id='HELMTEST-calderwood' and calendar_authority='helm' for share;
 if not found then raise exception 'synthetic_helm_property_required'; end if;
 perform 1 from public.helm_inventory_capture_scopes where property_id='HELMTEST-calderwood' and enabled;
 if not found then raise exception 'inventory_capture_required'; end if;
 select * into v_prior from helm_channex_revisions.conflicts where revision_id=v_id;
 if found and v_prior.revision is distinct from p_revision and not exists(
   select 1 from helm_channex_revisions.receipts where revision_id=v_id and revision=p_revision
 ) then
   v_reason := 'revision_identity_conflict';
 else
   begin
     v_result := public.helm_pilot_revision_commit(p_revision);
   exception
     when sqlstate 'P0002' then
       if sqlerrm <> 'booking_overlap' then raise; end if;
       v_reason := 'booking_overlap';
     when sqlstate 'P0001' then
       if sqlerrm not in ('revision_identity_conflict','booking_identity_changed','ambiguous_revision_order',
         'canonical_booking_ownership_changed','unmapped_canonical_booking') then raise; end if;
       v_reason := sqlerrm;
   end;
 end if;
 if v_reason is null then
   update helm_channex_revisions.conflicts set resolved_at=coalesce(resolved_at,clock_timestamp()) where revision_id=v_id;
   return v_result;
 end if;
 -- Inner failure rolled back bookings, audit, automation changes and receipts.
 -- Only the allowlisted synthetic revision and fixed classification survive.
 insert into helm_channex_revisions.conflicts(revision_id,revision,reason) values(v_id,p_revision,v_reason)
 on conflict(revision_id) do update set reason=excluded.reason,
   observations=least(helm_channex_revisions.conflicts.observations+1,9007199254740991),
   last_seen_at=clock_timestamp(),resolved_at=null;
 return jsonb_build_object('committed',false,'conflict',jsonb_build_object(
   'revisionId',v_id,'bookingId',v_remote,'reason',v_reason));
end $$;

create or replace function public.helm_pilot_revision_conflicts()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'openCount',(select count(*) from helm_channex_revisions.conflicts where resolved_at is null),
   'resolvedCount',(select count(*) from helm_channex_revisions.conflicts where resolved_at is not null),
   'open',coalesce((select jsonb_agg(jsonb_build_object(
     'revisionId',revision_id,'bookingId',revision->>'bookingId','checkIn',revision->>'checkIn','checkOut',revision->>'checkOut',
     'reason',reason,'observations',observations,
     'firstSeenAt',floor(extract(epoch from first_seen_at)*1000)::bigint,
     'lastSeenAt',floor(extract(epoch from last_seen_at)*1000)::bigint) order by first_seen_at,revision_id)
     from (select * from helm_channex_revisions.conflicts where resolved_at is null order by first_seen_at,revision_id limit 100) c),'[]'::jsonb));
$$;
revoke all on function public.helm_pilot_revision_observe(jsonb),public.helm_pilot_revision_conflicts() from public,anon,authenticated,service_role;
grant execute on function public.helm_pilot_revision_observe(jsonb),public.helm_pilot_revision_conflicts() to service_role;
commit;
