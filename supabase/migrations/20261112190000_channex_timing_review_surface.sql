-- Read-only, service-only owner review support. No activation, jobs or sends.
begin;
set local lock_timeout='5s';
-- Contexts are compared across readers/connections. Preserve full precision and
-- use one representation, independent of the caller's connection timezone.
alter function public.helm_channex_message_schedule_context(uuid) set timezone='UTC';
create function public.helm_channex_timing_review_snapshot(p_capture_id uuid,p_booking_id uuid)
returns jsonb language sql stable security definer set search_path='' set timezone='UTC' as $$
 select jsonb_build_object(
  'capture',jsonb_build_object('id',c.id,'checkedAt',c.checked_at,'savedAt',c.saved_at,
   'sourceContract',c.source_contract,'row',item),
  'context',public.helm_channex_message_schedule_context(b.id),
  'scope',jsonb_build_object('environment',s.environment,'propertyId',s.remote_property,
   'channelId',s.channel_id,'provider',s.provider),
  'route',jsonb_build_object('remoteBookingId',r.remote_id,'revisionId',r.latest_revision))
 from helm_channex_messages.source_timing_captures c
 cross join lateral jsonb_array_elements(c.rows) item
 join public.bookings b on b.id=p_booking_id and item->>'bookingId'=b.id::text
 join public.guesty_reservations g on g.guesty_reservation_id=item->>'guestyId'
 join helm_channex_messages.scope s on s.property_id=b.property_id
 join helm_airbnb_bookings.bookings r on r.canonical_id=b.id
 where c.id=p_capture_id and c.property_id='65_calderwood'
 and public.helm_channex_message_schedule_context(b.id) is not null
 and b.property_id=c.property_id and b.channel='airbnb' and b.hold_kind is null
 and b.source::text=item->>'source' and b.check_in=(item->>'start')::date
 and b.check_out=(item->>'end')::date and b.external_confirmation_code=item->>'code'
 and b.check_out>(statement_timestamp() at time zone 'America/New_York')::date
 and (select count(*) from public.bookings x where x.property_id=b.property_id
  and x.duplicate_of is null and x.status<>'block'
  and upper(btrim(x.external_confirmation_code))=upper(item->>'code'))=1
 and g.property_id=b.property_id and g.listing_id='66797ba7f51d72001388bc29'
 and g.status='confirmed' and lower(g.channel)='airbnb' and g.confirmation_code=item->>'code'
 and g.check_in=b.check_in and g.check_out=b.check_out
 and (select count(*) from public.guesty_reservations x where x.property_id=b.property_id
  and upper(btrim(x.confirmation_code))=upper(item->>'code'))=1
 and r.environment=s.environment and r.remote_property=s.remote_property
 and r.code=b.external_confirmation_code and r.status=b.status
 and r.check_in=b.check_in and r.check_out=b.check_out
 and (select count(*) from helm_airbnb_bookings.bookings x where x.canonical_id=b.id)=1
 and s.source_stopped_at<=s.source_drained_at and s.source_drained_at<=statement_timestamp();
$$;

-- Minimal owner DTO. Raw capture identities, context hashes, provider routes,
-- actors and credentials never leave the server. Latest capture, at most 12 stays.
create function public.helm_channex_timing_review_overview() returns jsonb
language sql stable security definer set search_path='' set timezone='UTC' as $$
 with latest as (
  select * from helm_channex_messages.source_timing_captures where property_id='65_calderwood'
  order by saved_at desc,id desc limit 1
 ), stays as (
  select item,c.id capture_id,c.checked_at,b.id bid,
   public.helm_channex_timing_review_snapshot(c.id,(item->>'bookingId')::uuid) snapshot,
   v.id binding_id,v.reviewed_at,
   case when v.id is not null then public.helm_channex_timing_binding_read(v.id) is not null else false end current_context
  from latest c cross join lateral jsonb_array_elements(c.rows) item
  left join public.bookings b on b.id=(item->>'bookingId')::uuid and b.property_id='65_calderwood'
  left join lateral (select id,reviewed_at from helm_channex_messages.timing_bindings
   where capture_id=c.id and booking_id=(item->>'bookingId')::uuid order by reviewed_at desc,id desc limit 1) v on true
 )
 select jsonb_build_object('format',1,'observedAt',statement_timestamp(),
  'authority',p.calendar_authority,'automationsEnabled',p.automations_enabled,
  'handoverRecorded',coalesce(s.enabled and s.source_evidence_id is not null
   and s.source_stopped_at<=s.source_drained_at and s.source_drained_at<=statement_timestamp(),false),
  'capture', (select jsonb_build_object('id',id,'checkedAt',checked_at,'savedAt',saved_at) from latest),
  'stays',coalesce((select jsonb_agg(jsonb_build_object(
   'bookingId',item->>'bookingId','start',item->>'start','end',item->>'end',
   'arrival',coalesce(item->'clocks'->>'plannedArrival',item->'clocks'->>'defaultArrival'),
   'departure',coalesce(item->'clocks'->>'plannedDeparture',item->'clocks'->>'defaultDeparture'),
   'confirmedAt',item->'clocks'->>'confirmedAt',
   'state',case when (item->>'end')::date<=(statement_timestamp() at time zone 'America/New_York')::date then 'past'
    when snapshot is not null then 'ready'
    when public.helm_channex_message_schedule_context(bid) is null then 'waiting_handover'
    else 'needs_matching' end,
   'review',case when binding_id is null then null else jsonb_build_object('id',binding_id,
    'reviewedAt',reviewed_at,'currentContext',current_context) end) order by item->>'start',item->>'bookingId') from stays),'[]'::jsonb))
 from public.properties p left join helm_channex_messages.scope s on s.property_id=p.id
 where p.id='65_calderwood';
$$;
revoke all on function public.helm_channex_timing_review_snapshot(uuid,uuid),public.helm_channex_timing_review_overview()
 from public,anon,authenticated;
grant execute on function public.helm_channex_timing_review_snapshot(uuid,uuid),public.helm_channex_timing_review_overview() to service_role;
commit;
