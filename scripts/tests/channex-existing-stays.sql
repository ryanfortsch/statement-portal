-- Roll back all synthetic collision fixtures; do not perturb later planner tests.
begin;
create function pg_temp.expect_handoff(revision jsonb) returns void language plpgsql as $$
declare before_bookings bigint; before_receipts bigint; before_events bigint;
begin
 select count(*) into before_bookings from public.bookings;
 select count(*) into before_receipts from helm_airbnb_bookings.receipts;
 select count(*) into before_events from public.helm_booking_inventory_events;
 begin
  perform public.helm_airbnb_revision_commit(revision);
  raise exception 'expected existing-stay rejection';
 exception when others then
  if sqlerrm <> 'existing_airbnb_stay_requires_handoff' then raise; end if;
 end;
 perform pg_temp.assert_true((select count(*)=before_bookings from public.bookings),'no duplicate canonical row');
 perform pg_temp.assert_true((select count(*)=before_receipts from helm_airbnb_bookings.receipts),'no receipt eligible for ACK');
 perform pg_temp.assert_true((select count(*)=before_events from public.helm_booking_inventory_events),'no inventory side effect');
end $$;
insert into bookings(id,property_id,channel,source,status,check_in,check_out,external_confirmation_code,guest_name)
 values('30000000-0000-4000-8000-000000000080','65_calderwood','airbnb','ical_import','confirmed','2027-06-01','2027-06-03','SYNTHETIC80','PRIVATE_SENTINEL');
insert into automation_sends(booking_id,status) values('30000000-0000-4000-8000-000000000080','sent');
create temporary table existing_stay_before as select to_jsonb(b) payload from bookings b where id='30000000-0000-4000-8000-000000000080';
-- Matching dates, changed dates with no overlap, and cancellation all require handoff.
select pg_temp.expect_handoff(channex_synthetic_revision(80,'2026-11-06T15:00:00.000080Z','new',80)||'{"checkIn":"2027-06-01","checkOut":"2027-06-03"}');
select pg_temp.expect_handoff(channex_synthetic_revision(81,'2026-11-06T15:00:00.000081Z','modified',80));
select pg_temp.expect_handoff(channex_synthetic_revision(82,'2026-11-06T15:00:00.000082Z','cancelled',80));
select pg_temp.assert_true((select to_jsonb(b) from bookings b where id='30000000-0000-4000-8000-000000000080')=(select payload from existing_stay_before),'original row untouched');
select pg_temp.assert_true((select status='sent' from automation_sends where booking_id='30000000-0000-4000-8000-000000000080'),'sent message history preserved');
-- Case/whitespace aliases and past/cancelled or duplicate rows cannot evade the guard.
update bookings set external_confirmation_code=' synthetic80 ',status='cancelled',check_in='2024-01-01',check_out='2024-01-03'
 where id='30000000-0000-4000-8000-000000000080';
select pg_temp.expect_handoff(channex_synthetic_revision(83,'2026-11-06T15:00:00.000083Z','new',80));
update bookings set duplicate_of=(select canonical_id from helm_airbnb_bookings.bookings limit 1)
 where id='30000000-0000-4000-8000-000000000080';
select pg_temp.expect_handoff(channex_synthetic_revision(84,'2026-11-06T15:00:00.000084Z','cancelled',80));
-- A same-code row in another property must not block a truly new Calderwood stay.
insert into bookings(property_id,channel,source,status,check_in,check_out,external_confirmation_code)
 values('other_home','airbnb','ical_import','confirmed','2027-07-01','2027-07-03','SYNTHETIC85');
select helm_airbnb_revision_commit(channex_synthetic_revision(85,'2026-11-06T15:00:00.000085Z','new',85)||'{"checkIn":"2027-07-01","checkOut":"2027-07-03"}');
select pg_temp.assert_true((select count(*)=1 from bookings where property_id='65_calderwood' and external_confirmation_code='SYNTHETIC85'),'new identity still imports');
-- A manually edited confirmation code/hold identity on a mapped row also fails closed.
do $$declare original_code text; target uuid;begin
 select canonical_id into target from helm_airbnb_bookings.bookings where code='SYNTHETIC85';
 update bookings set external_confirmation_code='CHANGED' where id=target;
 begin perform helm_airbnb_revision_commit(channex_synthetic_revision(86,'2026-11-06T15:00:00.000086Z','modified',85));raise exception 'expected code mismatch';
 exception when others then if sqlerrm<>'canonical_booking_changed' then raise;end if;end;
 update bookings set external_confirmation_code='SYNTHETIC85',hold_kind='owner' where id=target;
 begin perform helm_airbnb_revision_commit(channex_synthetic_revision(87,'2026-11-06T15:00:00.000087Z','modified',85));raise exception 'expected hold mismatch';
 exception when others then if sqlerrm<>'canonical_booking_changed' then raise;end if;end;
end$$;
select pg_temp.assert_true(not has_function_privilege('anon','public.helm_airbnb_revision_commit(jsonb)','EXECUTE'),'anonymous import remains denied');
rollback;
select 'PASS: existing stays are quarantined across dates/status/duplicates; original records and sent history survive' as result;
