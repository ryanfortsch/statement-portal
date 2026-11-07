-- Entire diagnostic test rolls back; it never activates ingestion.
begin;
truncate public.bookings cascade;
update public.properties set calendar_authority='guesty' where id='65_calderwood';
insert into public.bookings(id,property_id,channel,source,status,check_in,check_out,external_confirmation_code,guest_name,guest_phone,gross_amount)
values('10000000-0000-4000-8000-000000000001','65_calderwood','airbnb','manual','confirmed','2026-11-10','2026-11-12','SYNTHETIC-AUDIT','PRIVATE_SENTINEL','PRIVATE_SENTINEL',99999),
('10000000-0000-4000-8000-000000000002','other_home','airbnb','manual','confirmed','2026-11-10','2026-11-12','OTHER',null,null,0);
set local role service_role;
do $$declare s jsonb; begin
 s:=public.helm_channex_booking_audit_snapshot();
 if s->>'authority'<>'guesty' or jsonb_array_length(s->'rows')<>1 or s#>>'{rows,0,code}'<>'SYNTHETIC-AUDIT'
 or s::text like '%PRIVATE_SENTINEL%' or s::text like '%99999%' or s::text like '%OTHER%' then raise exception 'audit_projection_invalid'; end if;
 if has_function_privilege('anon','public.helm_channex_booking_audit_snapshot()','execute')
 or has_function_privilege('authenticated','public.helm_channex_booking_audit_snapshot()','execute') then raise exception 'audit_permissions_invalid'; end if;
end $$;
reset role;
insert into public.bookings(property_id,channel,source,status,check_in,check_out)
select '65_calderwood','airbnb','manual','cancelled','2026-11-10','2026-11-12' from generate_series(1,5001);
do $$begin
 if jsonb_array_length(public.helm_channex_booking_audit_snapshot()->'rows')<>5001 then raise exception 'audit_truncation_not_observable'; end if;
end $$;
rollback;
