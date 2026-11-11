-- All records below are synthetic; every mutation is rolled back.
begin;
select pg_temp.assert_true(helm_channex_delivery_recover(gen_random_uuid(),gen_random_uuid())->>'status'='disabled','recovery dormant');
select pg_temp.assert_true(not has_function_privilege('anon','helm_channex_delivery_recover(uuid,uuid)','EXECUTE'),'anonymous recovery denied');
select pg_temp.assert_true(not has_function_privilege('authenticated','helm_channex_delivery_recover(uuid,uuid)','EXECUTE'),'staff recovery denied');
select pg_temp.assert_true(has_function_privilege('service_role','helm_channex_delivery_recover(uuid,uuid)','EXECUTE'),'service recovery available');
select channex_synthetic_inventory_setup();
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update helm_airbnb_bookings.delivery_scope set enabled=true;
create temporary table recovery_original as select helm_channex_delivery_claim(gen_random_uuid())->'attempt' a;
select helm_channex_delivery_begin((a->>'token')::uuid,a->>'requestDigest') from recovery_original;
select helm_channex_delivery_record((a->>'token')::uuid,a->>'requestDigest','{"kind":"uncertain"}') from recovery_original;
select pg_temp.assert_true((select helm_channex_delivery_recover((a->>'token')::uuid,gen_random_uuid())->>'status' from recovery_original)='blocked','unexpired worker window cannot be retired');
update helm_airbnb_bookings.delivery_attempts set expires_at=0,started_at=clock_timestamp()-interval '2 minutes';
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
select helm_create_booking('65_calderwood','direct','manual','block','2037-01-01','2037-01-03','{"hold_kind":"owner"}');
select pg_temp.assert_true((select helm_channex_delivery_recover((a->>'token')::uuid,gen_random_uuid())->>'status' from recovery_original)='stale','source change demands fresh recomputation');
select pg_temp.assert_true((select superseded_by is null from helm_airbnb_bookings.delivery_attempts),'stale recovery preserves old quarantine');
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
create temporary table recovery_next as select helm_channex_delivery_recover((a->>'token')::uuid,gen_random_uuid()) result from recovery_original;
select pg_temp.assert_true((select result->>'status' from recovery_next)='claimed','latest fresh state gets one replacement');
select pg_temp.assert_true((select result->'attempt'->>'planVersion' from recovery_next)<>(select a->>'planVersion' from recovery_original),'replacement uses new plan');
select pg_temp.assert_true((select count(*) from helm_airbnb_bookings.delivery_attempts)=2,'old uncertainty kept in history');
select pg_temp.assert_true((select superseded_by::text from helm_airbnb_bookings.delivery_attempts where token=(select (a->>'token')::uuid from recovery_original))=(select result->'attempt'->>'token' from recovery_next),'replacement link is durable');
select pg_temp.assert_true((select helm_channex_delivery_recover((a->>'token')::uuid,(result->'attempt'->>'token')::uuid)->>'status' from recovery_original,recovery_next)='existing','lost claim response reuses exact replacement lease');
select pg_temp.assert_true((select helm_channex_delivery_recover((a->>'token')::uuid,gen_random_uuid())->>'status' from recovery_original)='blocked','competing token cannot claim second replacement');
select pg_temp.assert_true(helm_channex_delivery_claim(gen_random_uuid())->>'status'='blocked','normal claims cannot bypass replacement');
select pg_temp.assert_true((select helm_channex_delivery_claim((a->>'token')::uuid)->>'status' from recovery_original)='blocked','retired token never replays');
-- A late authentic old acceptance fences even the prepared replacement. It does
-- not change that replacement's saved bytes or erase the original uncertainty.
select helm_channex_delivery_record((a->>'token')::uuid,a->>'requestDigest','{"kind":"accepted","taskId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}') from recovery_original;
select pg_temp.assert_true((select recovery_generation from helm_airbnb_bookings.delivery_scope)=2,'late receipt advances ordering generation');
select helm_channex_delivery_record((a->>'token')::uuid,a->>'requestDigest','{"kind":"accepted","taskId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}') from recovery_original;
select pg_temp.assert_true((select recovery_generation from helm_airbnb_bookings.delivery_scope)=2,'late receipt retries are idempotent');
select pg_temp.assert_true((select helm_channex_delivery_begin((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest')->>'status' from recovery_next)='blocked','late receipt fences prepared send');
update helm_airbnb_bookings.delivery_attempts set expires_at=0 where state='leased';
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update recovery_next set result=helm_channex_delivery_claim(gen_random_uuid());
select pg_temp.assert_true((select result->>'status' from recovery_next)='claimed','late response requires fresh reassertion');
select helm_channex_delivery_begin((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest') from recovery_next;
select helm_channex_delivery_record((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest','{"kind":"accepted","taskId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}') from recovery_next;
select pg_temp.assert_true((select consecutive_recoveries from helm_airbnb_bookings.delivery_scope)=0,'current acceptance resets recovery budget');
select pg_temp.assert_true(helm_channex_delivery_status()->>'settlementEnabled'='false','recovery is never OTA delivery proof');
rollback;

-- Repeated timeouts have a hard budget even after the pacing window moves on.
begin;
select channex_synthetic_inventory_setup();
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update helm_airbnb_bookings.delivery_scope set enabled=true;
do $$declare r jsonb:=public.helm_channex_delivery_claim(gen_random_uuid()); a jsonb; n integer; old_token uuid;begin
 for n in 0..3 loop
  a:=r->'attempt'; old_token:=(a->>'token')::uuid;
  perform public.helm_channex_delivery_begin(old_token,a->>'requestDigest');
  perform public.helm_channex_delivery_record(old_token,a->>'requestDigest','{"kind":"uncertain"}');
  update helm_airbnb_bookings.delivery_attempts set expires_at=0,started_at=clock_timestamp()-interval '2 minutes' where token=old_token;
  update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
  r:=public.helm_channex_delivery_recover(old_token,gen_random_uuid());
  perform pg_temp.assert_true(r->>'status'=case when n<3 then 'claimed' else 'blocked' end,'bounded recovery chain');
 end loop;
 perform pg_temp.assert_true((select count(*) from helm_airbnb_bookings.delivery_attempts)=4,'at most three replacement attempts');
 update helm_airbnb_bookings.delivery_attempts set created_at=clock_timestamp()-interval '1 hour';
 perform pg_temp.assert_true(public.helm_channex_delivery_recover(old_token,gen_random_uuid())->>'status'='blocked','rolling rate window cannot reset hard recovery budget');
 perform pg_temp.assert_true(public.helm_channex_delivery_claim(gen_random_uuid())->>'status'='blocked','normal worker cannot bypass recovery exhaustion');
 perform pg_temp.assert_true(public.helm_channex_delivery_status()->>'unresolved'='4','retired unknown outcomes remain visible');
end$$;
rollback;

-- Late rejection after recovery still fences a leased worker and keeps pacing.
begin;
select channex_synthetic_inventory_setup();
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update helm_airbnb_bookings.delivery_scope set enabled=true;
create temporary table recovery_original as select helm_channex_delivery_claim(gen_random_uuid())->'attempt' a;
select helm_channex_delivery_begin((a->>'token')::uuid,a->>'requestDigest') from recovery_original;
update helm_airbnb_bookings.delivery_attempts set expires_at=0,started_at=clock_timestamp()-interval '2 minutes';
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
-- Includes a lost begin/outcome response: submitting has no recorded outcome.
create temporary table recovery_next as select helm_channex_delivery_recover((a->>'token')::uuid,gen_random_uuid()) result from recovery_original;
select pg_temp.assert_true((select result->>'status' from recovery_next)='claimed','expired submitting can recover without inventing a receipt');
select helm_channex_delivery_record((a->>'token')::uuid,a->>'requestDigest','{"kind":"rate-limited","retryAfterSeconds":120}') from recovery_original;
select pg_temp.assert_true((select helm_channex_delivery_begin((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest')->>'status' from recovery_next)='blocked','late rate limit fences prepared recovery');
select pg_temp.assert_true((select next_attempt_at>clock_timestamp()+interval '119 seconds' from helm_airbnb_bookings.delivery_scope),'late rejection preserves retry-after');
update helm_airbnb_bookings.delivery_attempts set expires_at=0 where state='leased';
select pg_temp.assert_true(helm_channex_delivery_claim(gen_random_uuid())->>'status'='blocked','late rate limit prevents normal replacement');
rollback;
-- A late credential rejection cannot be bypassed through a replacement token.
begin;
select channex_synthetic_inventory_setup();
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update helm_airbnb_bookings.delivery_scope set enabled=true;
create temporary table recovery_original as select helm_channex_delivery_claim(gen_random_uuid())->'attempt' a;
select helm_channex_delivery_begin((a->>'token')::uuid,a->>'requestDigest') from recovery_original;
update helm_airbnb_bookings.delivery_attempts set expires_at=0,started_at=clock_timestamp()-interval '2 minutes';
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
create temporary table recovery_next as select helm_channex_delivery_recover((a->>'token')::uuid,gen_random_uuid()) result from recovery_original;
select helm_channex_delivery_record((a->>'token')::uuid,a->>'requestDigest','{"kind":"unauthorized"}') from recovery_original;
select pg_temp.assert_true((select helm_channex_delivery_begin((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest')->>'status' from recovery_next)='blocked','late credential rejection fences recovery');
update helm_airbnb_bookings.delivery_attempts set expires_at=0 where state='leased';
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
select pg_temp.assert_true(helm_channex_delivery_claim(gen_random_uuid())->>'status'='blocked','late credential rejection blocks fresh token');
select pg_temp.assert_true((select helm_channex_delivery_recover((a->>'token')::uuid,gen_random_uuid())->>'status' from recovery_original)='blocked','rejected attempt cannot recover');
rollback;
select 'PASS: current-state recovery, cooldown, immutable history, one-use links, late-receipt fencing, backoff and recovery exhaustion' as result;
