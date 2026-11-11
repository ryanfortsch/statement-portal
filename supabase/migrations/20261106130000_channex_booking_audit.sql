-- Read-only, owner-triggered production migration diagnostic. No coverage grant,
-- links, activation, booking writes, ACK or provider publication.
begin;
set local lock_timeout = '5s';
create or replace function public.helm_channex_booking_audit_snapshot()
returns jsonb language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('format',1,'propertyId',p.id,'authority',p.calendar_authority,
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
   'id',b.id,'channel',b.channel,'source',b.source,'status',b.status,
   'checkIn',to_char(b.check_in,'YYYY-MM-DD'),'checkOut',to_char(b.check_out,'YYYY-MM-DD'),
   'duplicateOf',b.duplicate_of,'holdKind',b.hold_kind,'code',b.external_confirmation_code
  ) order by b.id) from (select id,channel,source,status,check_in,check_out,duplicate_of,hold_kind,external_confirmation_code
    from public.bookings where property_id='65_calderwood' order by id limit 5001) b),'[]'::jsonb))
 from public.properties p where p.id='65_calderwood';
$$;
comment on function public.helm_channex_booking_audit_snapshot() is
 'Bounded single-statement snapshot for Calderwood comparison only. 5001st row forces truncation refusal. No upstream coverage or activation.';
revoke all on function public.helm_channex_booking_audit_snapshot() from public,anon,authenticated;
grant execute on function public.helm_channex_booking_audit_snapshot() to service_role;
commit;
