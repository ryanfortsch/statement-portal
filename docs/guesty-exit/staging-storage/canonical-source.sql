-- Candidate only. Exact fictional route, no seeds, no publishing or channel changes.
-- Requires canonical-revisions.sql and booking-inventory-planning.sql.
begin;
create or replace function public.helm_pilot_source_read()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'property',s.property_id,'captureEnabled',c.enabled,'importEnabled',s.enabled,'authority',p.calendar_authority,
  'captureVersion',c.version,'configurationVersion',i.configuration_version,
  'connection',i.configuration->'connection','listing',i.configuration->'listing','generation',i.configuration->'generation',
  'requiredSources',i.configuration->'requiredSources',
  'unmappedRemoteRows',(select count(*) from public.bookings b where b.property_id=s.property_id
    and b.source_ref like 'channex-staging:%' and not exists(select 1 from helm_channex_revisions.bookings m where m.canonical_id=b.id)),
  'bindings',coalesce((select jsonb_agg(jsonb_build_object('booking',jsonb_build_object(
    'bookingId',m.remote_id,'revisionId',m.latest_revision,'propertyId',r.revision->'propertyId',
    'roomTypeId',r.revision->'roomTypeId','ratePlanId',r.revision->'ratePlanId','code',m.code,
    'status',r.revision->'status','checkIn',r.revision->'checkIn','checkOut',r.revision->'checkOut'),
    'valid',coalesce(r.outcome='applied' and r.canonical_id=m.canonical_id and r.revision->>'id'=m.latest_revision::text
      and r.revision->>'bookingId'=m.remote_id::text and r.revision->>'code'=m.code
      and (r.revision->>'receivedAt')::timestamptz=m.latest_at
      and b.property_id=s.property_id and b.source_ref='channex-staging:'||m.remote_id::text
      and b.source='manual' and b.channel='other' and b.duplicate_of is null and b.hold_kind is null
      and b.check_in::text=r.revision->>'checkIn' and b.check_out::text=r.revision->>'checkOut'
      and b.status::text=case when r.revision->>'status'='cancelled' then 'cancelled' else 'confirmed' end,false)) order by m.remote_id)
    from (select * from helm_channex_revisions.bookings order by remote_id limit 101) m
    left join helm_channex_revisions.receipts r on r.revision_id=m.latest_revision
    left join public.bookings b on b.id=m.canonical_id),'[]'::jsonb))
 from helm_channex_revisions.scope s
 join public.properties p on p.id=s.property_id
 join public.helm_inventory_capture_scopes c on c.property_id=s.property_id
 join public.helm_booking_inventory_consumers i on i.property_id=s.property_id where s.singleton;
$$;
create or replace function public.helm_pilot_source_certify(p_expected jsonb,p_bookings jsonb,p_observed_at bigint,p_start date,p_end date)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_state jsonb; stamp bigint; config jsonb; next_coverage jsonb; prior_observed bigint;
begin
 -- Short database-only transaction: block booking row/identity changes, including
 -- source_ref edits that do not affect availability capture. Same table-before-scope
 -- order as revision import. No HTTP occurs while these locks are held.
 lock table public.bookings in share mode;
 perform 1 from helm_channex_revisions.scope where singleton for share;
 perform 1 from public.properties where id='HELMTEST-calderwood' for share;
 perform 1 from public.helm_inventory_capture_scopes where property_id='HELMTEST-calderwood' for share;
 select configuration into config from public.helm_booking_inventory_consumers where property_id='HELMTEST-calderwood' for update;
 if not found then return false; end if;
 current_state := public.helm_pilot_source_read();
 stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if current_state is null or p_expected is distinct from current_state
   or current_state->>'property' is distinct from 'HELMTEST-calderwood'
   or current_state->'captureEnabled' is distinct from 'true'::jsonb or current_state->'importEnabled' is distinct from 'true'::jsonb
   or current_state->>'authority' is distinct from 'helm' or (current_state->>'captureVersion')::bigint<1
   or config->>'environment' is distinct from 'staging' or config->>'topology' is distinct from 'single-unit'
   or config->>'timeZone' is distinct from 'America/New_York'
   or config->>'connection' is distinct from 'calderwood-hosted-inventory'
   or config->>'listing' is distinct from 'f795ae2c-f47d-4751-86ff-e883b6d30800'
   or config->'generation' is distinct from '1'::jsonb
   or config->'requiredSources' is distinct from '["channex-staging-bookings"]'::jsonb
   or current_state->'unmappedRemoteRows' is distinct from '0'::jsonb
   or p_observed_at is null or p_observed_at>stamp or stamp-p_observed_at>60000
   or p_start is null or p_end is null or p_end-p_start not between 1 and 426
 then return false; end if;
 if jsonb_typeof(p_bookings) is distinct from 'array' or jsonb_array_length(p_bookings)>100
   or jsonb_array_length(current_state->'bindings')>100 then return false; end if;
 if exists(select 1 from jsonb_array_elements(current_state->'bindings') b
   where b->'valid' is distinct from 'true'::jsonb
     or b->'booking'->>'propertyId' is distinct from '30584a9a-8784-4eb1-a387-e26bd43aec1c'
     or b->'booking'->>'roomTypeId' is distinct from 'f795ae2c-f47d-4751-86ff-e883b6d30800'
     or b->'booking'->>'ratePlanId' is distinct from '7f95b731-ff05-4c41-99c9-f39b3e772fec') then return false; end if;
 -- Cancelled local rehearsal history may remain after provider fixtures disappear.
 -- Require a valid saved cancellation; an absent active stay always blocks.
 if exists(select 1 from jsonb_array_elements(current_state->'bindings') b
   where b->'booking'->>'status' is distinct from 'cancelled'
    and not exists(select 1 from jsonb_array_elements(p_bookings) r where r->>'bookingId'=b->'booking'->>'bookingId')) then return false; end if;
 if p_bookings is distinct from (select coalesce(jsonb_agg(b->'booking' order by b->'booking'->>'bookingId'),'[]'::jsonb)
   from jsonb_array_elements(current_state->'bindings') b
   where exists(select 1 from jsonb_array_elements(p_bookings) r where r->>'bookingId'=b->'booking'->>'bookingId')) then return false; end if;
 -- Observations cannot regress or replay a lost response into a fresh lease.
 select max((v->>'observedAt')::bigint) into prior_observed from jsonb_array_elements(config->'coverage') v;
 if prior_observed is not null and p_observed_at<=prior_observed then return false; end if;
 next_coverage := jsonb_build_array(jsonb_build_object('source','channex-staging-bookings','start',p_start,'end',p_end,
   'complete',true,'observedAt',p_observed_at,'freshUntil',p_observed_at+900000));
 update public.helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{coverage}',next_coverage)
 where property_id='HELMTEST-calderwood';
 return true;
end $$;
revoke all on function public.helm_pilot_source_read(),public.helm_pilot_source_certify(jsonb,jsonb,bigint,date,date) from public,anon,authenticated,service_role;
grant execute on function public.helm_pilot_source_read(),public.helm_pilot_source_certify(jsonb,jsonb,bigint,date,date) to service_role;
commit;
