create function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception '%',msg; end if;end$$;
create function public.channex_synthetic_revision(n integer,at_time text,revision_status text default 'new',booking_n integer default 1)
returns jsonb language sql as $$select jsonb_build_object(
 'revisionId','10000000-0000-4000-8000-'||lpad(n::text,12,'0'),
 'bookingId','20000000-0000-4000-8000-'||lpad(booking_n::text,12,'0'),
 'propertyId','320c5cb5-91e0-46af-b9b3-a3fc20b4631e',
 'roomTypeId','e8673d84-4bea-48b1-a160-214b016a8c05',
 'ratePlanId','ce53790a-7b7d-4cec-91a6-a128589f9dd2',
 'environment','production','mappingGeneration',1,'channel','airbnb',
 'guestDetails',jsonb_build_object('name','Synthetic','surname',null,'mail','guest@example.invalid','phone',null,'address',null,'city',null,'country',null,'zip',null,'notes',null),
 'reservationCode','SYNTHETIC'||booking_n,'status',revision_status,
 'checkIn','2027-02-01','checkOut','2027-02-04','providerReceivedAt',at_time)$$;

select pg_temp.assert_true((helm_channex_storage_status()->>'importEnabled')::boolean=false,'import must start disabled');
select pg_temp.assert_true((helm_channex_storage_status()->>'captureEnabled')::boolean=false,'capture must start disabled');
do $$begin
 begin perform helm_airbnb_revision_commit(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z'));raise exception 'expected disabled';
 exception when others then if sqlerrm<>'airbnb_import_disabled' then raise;end if;end;
end$$;
update helm_airbnb_bookings.scope set enabled=true;
do $$begin
 begin perform helm_airbnb_revision_commit(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z'));raise exception 'expected authority';
 exception when others then if sqlerrm<>'helm_authority_required' then raise;end if;end;
end$$;
update properties set calendar_authority='helm' where id='65_calderwood';
do $$begin
 begin perform helm_airbnb_revision_commit(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z'));raise exception 'expected capture';
 exception when others then if sqlerrm<>'inventory_capture_required' then raise;end if;end;
end$$;
update helm_inventory_capture_scopes set enabled=true where property_id='65_calderwood';
create temporary table original_receipt as select helm_airbnb_revision_commit(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z')) receipt;
select pg_temp.assert_true((select receipt from original_receipt)=helm_airbnb_revision_commit(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z')),'duplicate must return identical receipt');
select pg_temp.assert_true((select count(*)=1 from bookings),'one canonical booking');
select pg_temp.assert_true((select count(*)=2 from helm_booking_inventory_events),'enable and booking events');
select pg_temp.assert_true((select count(*)=1 from booking_events),'one canonical audit event');
-- Unprojected customer/payment payloads must never enter receipt storage.
do $$begin
 begin perform helm_airbnb_revision_commit(channex_synthetic_revision(2,'2026-11-06T15:00:00.000002Z')||'{"customer":"PRIVATE_SENTINEL"}'::jsonb);raise exception 'expected payload reject';
 exception when others then if sqlerrm<>'invalid_airbnb_revision' then raise;end if;end;
 begin perform helm_airbnb_revision_commit(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z')||'{"checkOut":"2027-02-05"}'::jsonb);raise exception 'expected identity reject';
 exception when others then if sqlerrm<>'revision_identity_conflict' then raise;end if;end;
 begin perform helm_airbnb_revision_commit(channex_synthetic_revision(2,'2026-11-06T15:00:00.000001Z'));raise exception 'expected ambiguous';
 exception when others then if sqlerrm<>'ambiguous_revision_order' then raise;end if;end;
end$$;
-- True canonical mutation + inventory invalidation + receipt are a single transaction.
select helm_airbnb_revision_commit(channex_synthetic_revision(2,'2026-11-06T15:00:00.000002Z','modified')||'{"checkOut":"2027-02-05"}'::jsonb);
select pg_temp.assert_true((select check_out='2027-02-05' from bookings),'date change applied');
select pg_temp.assert_true((select count(*)=3 from helm_booking_inventory_events),'date change invalidated inventory');
insert into automation_sends(booking_id,status) select id,'scheduled' from bookings;
select helm_airbnb_revision_commit(channex_synthetic_revision(3,'2026-11-06T15:00:00.000003Z','cancelled'));
select pg_temp.assert_true((select status='cancelled' from bookings),'cancelled canonical booking');
select pg_temp.assert_true((select status='cancelled' from automation_sends),'waiting automation cancelled by canonical writer');
select pg_temp.assert_true(helm_airbnb_revision_commit(channex_synthetic_revision(4,'2026-11-06T15:00:00.000000Z'))->>'outcome'='stale','older revision held stale');
select pg_temp.assert_true((select status='cancelled' from bookings),'stale revision cannot resurrect');
select pg_temp.assert_true((select count(*)=4 from helm_booking_inventory_events),'stale has no inventory mutation');
do $$begin
 begin perform helm_airbnb_revision_commit(channex_synthetic_revision(5,'2026-11-06T15:00:00.000004Z'));raise exception 'expected resurrection rejected';
 exception when others then if sqlerrm<>'cancelled_booking_requires_review' then raise;end if;end;
end$$;
-- An overlapping independent hold aborts canonical write, receipt and event together.
select helm_create_booking('65_calderwood','direct','manual','block','2027-03-01','2027-03-05','{"hold_kind":"owner"}');
do $$declare before_events bigint;begin
 select count(*) into before_events from helm_booking_inventory_events;
 begin perform helm_airbnb_revision_commit(channex_synthetic_revision(6,'2026-11-06T15:00:01.000001Z','new',2)||'{"checkIn":"2027-03-02","checkOut":"2027-03-04"}'::jsonb);raise exception 'expected overlap';
 exception when sqlstate 'P0002' then null;end;
 perform pg_temp.assert_true((select count(*)=before_events from helm_booking_inventory_events),'overlap event rollback');
 perform pg_temp.assert_true(not exists(select 1 from helm_airbnb_bookings.receipts where revision_id='10000000-0000-4000-8000-000000000006'),'overlap has no receipt');
end$$;
-- Actual availability inputs are journaled; prices/minimums remain PriceLabs-owned.
insert into property_rate_plans values('65_calderwood',24,365,0,'16:00',100,2);
create temporary table before_price as select count(*) n from helm_booking_inventory_events;
update property_rate_plans set base_nightly_cents=22200,min_nights_default=4 where property_id='65_calderwood';
select pg_temp.assert_true((select count(*) from helm_booking_inventory_events)=(select n from before_price),'price/min-stay must not enqueue availability');
update property_rate_plans set turnover_buffer_days=1 where property_id='65_calderwood';
select pg_temp.assert_true((select count(*) from helm_booking_inventory_events)=(select n+1 from before_price),'buffer change must enqueue');
select pg_temp.assert_true(not has_schema_privilege('service_role','helm_airbnb_bookings','USAGE'),'service cannot directly edit private tables');
select pg_temp.assert_true(has_function_privilege('service_role','public.helm_airbnb_revision_commit(jsonb)','EXECUTE'),'server RPC available');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.helm_airbnb_revision_commit(jsonb)','EXECUTE'),'authenticated RPC denied');
select pg_temp.assert_true(not has_function_privilege('anon','public.helm_channex_runtime_checkpoint(boolean,text)','EXECUTE'),'anonymous health mutation denied');
select helm_channex_runtime_checkpoint(true,'OK');
select helm_channex_runtime_checkpoint(false,'ACCESS_DENIED');
select pg_temp.assert_true((helm_channex_runtime_status()->>'consecutiveFailures')::integer=1,'failure is visible');
select pg_temp.assert_true(helm_channex_runtime_status()->>'lastSuccessAt' is not null,'failure preserves last success');
select helm_channex_runtime_checkpoint(true,'OK');
select pg_temp.assert_true((helm_channex_runtime_status()->>'consecutiveFailures')::integer=0,'recovery resets failures');
select 'PASS: durable receipts, ordering, overlap rollback, capture, permissions, runtime health' as result;

-- Dated closures and seasonal windows invalidate, but price-only edits do not.
create temporary table before_inputs as select count(*) n from helm_booking_inventory_events;
insert into property_rate_days values('65_calderwood','2027-04-01',false,10000,2);
update property_rate_days set nightly_cents=12000,min_nights=3 where property_id='65_calderwood';
select pg_temp.assert_true((select count(*) from helm_booking_inventory_events)=(select n+1 from before_inputs),'daily price-only edit ignored');
update property_rate_days set closed=true where property_id='65_calderwood';
insert into property_rental_periods(property_id,start_month,start_day,end_month,end_day) values('65_calderwood',5,1,10,31);
select pg_temp.assert_true((select count(*) from helm_booking_inventory_events)=(select n+3 from before_inputs),'closures and seasonal windows invalidate');
-- The event journal refuses direct edits and truncation.
do $$begin
 begin delete from helm_booking_inventory_events; raise exception 'expected immutable';
 exception when others then if sqlerrm<>'Inventory event history is append-only' then raise;end if;end;
 begin truncate helm_booking_inventory_events;raise exception 'expected immutable truncate';
 exception when others then if sqlerrm<>'Inventory event history is append-only' then raise;end if;end;
end$$;
-- Exercise SECURITY DEFINER through the actual service role, without private table access.
set role service_role;
select public.helm_channex_storage_status();
select public.helm_airbnb_revision_receipt('10000000-0000-4000-8000-000000000001');
reset role;

-- Guest projection is independently readable, immutable on masked replay.
do $$declare before_receipt jsonb; bad jsonb; begin
 before_receipt:=helm_airbnb_revision_receipt('10000000-0000-4000-8000-000000000001');
 perform pg_temp.assert_true(before_receipt#>>'{revision,guestDetails,mail}'='guest@example.invalid','durable guest contact');
 foreach bad in array array[
   jsonb_set(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z'),'{guestDetails,state}','"***"'),
   jsonb_set(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z'),'{guestDetails,unexpected}','null'),
   jsonb_set(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z'),'{guestDetails,mail}','"***"'),
   jsonb_set(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z'),'{guestDetails,notes}','"4111 1111 1111 1111"'),
   jsonb_set(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z'),'{guestDetails,phone}','"+1234567890123456"'),
   jsonb_set(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z'),'{guestDetails,phone}','"***"'),
   jsonb_set(channex_synthetic_revision(1,'2026-11-06T15:00:00.000001Z'),'{guestDetails}','{}')] loop
  begin perform helm_airbnb_revision_commit(bad); raise exception 'expected guest rejection';
  exception when others then if sqlerrm<>'invalid_guest_details' then raise;end if;end;
 end loop;
 perform pg_temp.assert_true(before_receipt=helm_airbnb_revision_receipt('10000000-0000-4000-8000-000000000001'),'masked retry never overwrites');
end$$;

begin;
select pg_temp.assert_true(helm_airbnb_revision_commit(
 jsonb_set(channex_synthetic_revision(989,'2026-11-06T14:00:00.000000Z'),'{guestDetails,phone}','"+123456789012345"')
 )#>>'{revision,guestDetails,phone}'='+123456789012345','international phone retained without alteration');
select pg_temp.assert_true(helm_airbnb_revision_commit(
 jsonb_set(channex_synthetic_revision(990,'2026-11-06T14:00:00.000001Z'),'{guestDetails,state}','"MA"')
 )#>>'{revision,guestDetails,state}'='MA','populated state retained');
select pg_temp.assert_true(helm_airbnb_revision_commit(
 jsonb_set(channex_synthetic_revision(991,'2026-11-06T14:00:00.000002Z'),'{guestDetails,state}','null')
 )#>'{revision,guestDetails,state}'='null'::jsonb,'explicit state null retained');
rollback;
