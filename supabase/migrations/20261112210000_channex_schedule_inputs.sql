-- One consistent, service-only read of existing-stay scheduling inputs.
-- No rule archive/release, scope activation, records, jobs or provider calls.
begin;
set local lock_timeout='5s';
create function public.helm_channex_message_schedule_inputs(p_booking_id uuid,p_binding_id uuid)
returns jsonb language sql stable security definer set search_path='' set timezone='UTC' as $$
 with recursive family(id) as (
  select id from public.bookings where id=p_booking_id
  union
  select b.id from public.bookings b join family f on b.duplicate_of=f.id
 ), bound as materialized (
  select public.helm_channex_timing_binding_read(p_binding_id) value
 ), rules as materialized (
  select id,key,property_id,audience,trigger,offset_days,at_local,timezone,channel_exclusions,
   delivery,send_mode,min_nights,subject,body,enabled,configured_in_ota,migration_policy
  from public.message_automations where property_id='65_calderwood' or property_id is null
  order by id limit 201
 ), history as materialized (
  -- Do not filter by status, workflow, automation ID, or property: an unexpected
  -- row must fail validation, not disappear and allow a replacement message.
  select id,booking_id,property_id,automation_id,automation_key,fire_at,status,
   planned_check_in,planned_check_out,sent_at,provider_message_id
  from public.automation_sends where booking_id=p_booking_id order by id limit 5001
 )
 select jsonb_build_object('format',1,'observedAt',statement_timestamp(),
  'context',public.helm_channex_message_schedule_context(b.id),'binding',bound.value,
  'booking',jsonb_build_object('id',b.id,'propertyId',b.property_id,'status',b.status,
   'duplicateOf',b.duplicate_of,'start',b.check_in,'end',b.check_out,'guestName',b.guest_name),
  'property',jsonb_build_object('id',p.id,'name',p.name,'wifiName',p.wifi_name),
  'access',case when a.property_id is null then null else jsonb_build_object(
   'smartLockCode',a.smart_lock_code,'wifiPassword',a.wifi_password) end,
  'lockMapped',exists(select 1 from public.lock_devices l where l.property_id=b.property_id and l.active),
  'currentRules',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from rules r),'[]'::jsonb),
  'ledger',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from history h),'[]'::jsonb))
 from public.bookings b join public.properties p on p.id=b.property_id
 left join public.property_access a on a.property_id=b.property_id cross join bound
 where b.id=p_booking_id and b.property_id='65_calderwood' and b.status='confirmed'
 and b.duplicate_of is null and b.hold_kind is null and b.channel='airbnb'
 and p.kind='managed' and p.is_active and p.calendar_authority='helm' and p.automations_enabled
 and bound.value is not null and bound.value->'evidence'->'row'->>'bookingId'=b.id::text
 and bound.value->'evidence'->'row'->>'source'=b.source::text
 and bound.value->'evidence'->'binding'->>'contextRevision'=helm_channex_messages.booking_context(b.id)
 and (select count(*) from rules)<=200 and (select count(*) from history)<=5000
 -- Old duplicate/merged records can contain prior sends. Do not silently assign
 -- their history to a different stay or ignore it. Reconciliation is required.
 and not exists(select 1 from public.automation_sends s join family f on f.id=s.booking_id
  where f.id<>p_booking_id);
$$;
revoke all on function public.helm_channex_message_schedule_inputs(uuid,uuid) from public,anon,authenticated;
grant execute on function public.helm_channex_message_schedule_inputs(uuid,uuid) to service_role;
comment on function public.helm_channex_message_schedule_inputs(uuid,uuid) is
 'Private read-only scheduling inputs from one database snapshot. Includes secrets for server rendering only. Does not certify current provider clocks or release captured templates.';
commit;
