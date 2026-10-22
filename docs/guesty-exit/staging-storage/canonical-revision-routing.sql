-- Candidate only. Isolated staging, after inventory-routes.sql and canonical-conflicts.sql.
-- No seeds, enablement, production changes, provider calls or message delivery.
-- The legacy importer stays fixed to Calderwood; these wrappers add route fencing.
begin;
create or replace function helm_channex_revisions.require_route(p_connection text,p_generation bigint)
returns jsonb language plpgsql set search_path='' as $$
declare r jsonb;
begin
 r := public.helm_staging_inventory_route_read('HELMTEST-calderwood',p_connection,p_generation);
 if r is null or r->>'propertyId' is distinct from '30584a9a-8784-4eb1-a387-e26bd43aec1c'
   or r->>'roomTypeId' is distinct from 'f795ae2c-f47d-4751-86ff-e883b6d30800'
   or r->>'ratePlanId' is distinct from '7f95b731-ff05-4c41-99c9-f39b3e772fec'
 then raise exception 'reviewed_revision_route_required'; end if;
 return r;
end $$;

create or replace function helm_channex_revisions.lock_route(p_connection text,p_generation bigint)
returns jsonb language plpgsql set search_path='' as $$
begin
 -- Match legacy import and capture-disable ordering. Never lock the consumer
 -- before a booking write: its capture trigger must precede the planner's consumer lock.
 lock table public.bookings in row exclusive mode;
 perform 1 from helm_channex_revisions.scope where singleton and enabled for update;
 if not found then raise exception 'revision_import_disabled'; end if;
 perform 1 from public.properties where id='HELMTEST-calderwood' and calendar_authority='helm' for share;
 if not found then raise exception 'synthetic_helm_property_required'; end if;
 perform 1 from public.helm_inventory_capture_scopes where property_id='HELMTEST-calderwood' and enabled for share;
 if not found then raise exception 'inventory_capture_required'; end if;
 perform 1 from public.helm_booking_inventory_consumers where property_id='HELMTEST-calderwood'
   and configuration->>'timeZone'='America/New_York' for share;
 if not found then raise exception 'reviewed_revision_route_required'; end if;
 return helm_channex_revisions.require_route(p_connection,p_generation);
end $$;

create or replace function public.helm_pilot_revision_route()
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.helm_staging_inventory_routes;
begin
 select * into r from public.helm_staging_inventory_routes where property_id='HELMTEST-calderwood';
 if not found then raise exception 'reviewed_revision_route_required'; end if;
 return helm_channex_revisions.lock_route(r.connection,r.generation);
end $$;

create or replace function public.helm_pilot_revision_receipt_mapped(p_id uuid,p_connection text,p_generation bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r helm_channex_revisions.receipts;
begin
 perform helm_channex_revisions.lock_route(p_connection,p_generation);
 select * into r from helm_channex_revisions.receipts where revision_id=p_id;
 if not found then return null; end if;
 -- Old receipts remain valid after a newer date/status revision, but may not be
 -- used to acknowledge a stay reassigned to another property or source identity.
 if not exists(select 1 from helm_channex_revisions.bookings m join public.bookings b on b.id=m.canonical_id
   where m.remote_id=(r.revision->>'bookingId')::uuid and m.canonical_id=r.canonical_id
     and m.code=r.revision->>'code' and b.property_id='HELMTEST-calderwood'
     and b.source_ref='channex-staging:' || m.remote_id and b.duplicate_of is null
     and b.source='manual' and b.channel='other')
 then raise exception 'canonical_booking_ownership_changed'; end if;
 return public.helm_pilot_revision_receipt(p_id);
end $$;

create or replace function public.helm_pilot_revision_observe_mapped(p_revision jsonb,p_connection text,p_generation bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 -- Fast rejection before work, then a locked postcondition in this same
 -- transaction. A configuration change during import rolls back every write.
 perform helm_channex_revisions.require_route(p_connection,p_generation);
 r := public.helm_pilot_revision_observe(p_revision);
 perform helm_channex_revisions.lock_route(p_connection,p_generation);
 if r->'committed'='true'::jsonb then
   return public.helm_pilot_revision_receipt_mapped((p_revision->>'id')::uuid,p_connection,p_generation);
 end if;
 return r;
end $$;
revoke all on function helm_channex_revisions.require_route(text,bigint),helm_channex_revisions.lock_route(text,bigint),
 public.helm_pilot_revision_route(),public.helm_pilot_revision_receipt_mapped(uuid,text,bigint),
 public.helm_pilot_revision_observe_mapped(jsonb,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.helm_pilot_revision_route(),public.helm_pilot_revision_receipt_mapped(uuid,text,bigint),
 public.helm_pilot_revision_observe_mapped(jsonb,text,bigint) to service_role;
commit;
