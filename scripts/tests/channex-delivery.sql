begin;
select pg_temp.assert_true(helm_channex_delivery_claim(gen_random_uuid())='{"status":"disabled"}'::jsonb,'delivery dormant');
select pg_temp.assert_true(helm_channex_delivery_status()->>'attempts'='0','no seeded attempts');
select pg_temp.assert_true(not has_table_privilege('service_role','helm_airbnb_bookings.delivery_attempts','UPDATE'),'service cannot alter delivery history');
select pg_temp.assert_true(not has_function_privilege('anon','helm_channex_delivery_claim(uuid)','EXECUTE'),'anonymous cannot claim');
select pg_temp.assert_true(not has_function_privilege('authenticated','helm_channex_delivery_begin(uuid,text)','EXECUTE'),'staff cannot send');
select pg_temp.assert_true(not has_function_privilege('service_role','helm_airbnb_bookings.delivery_plan_current(bigint)','EXECUTE'),'private guard not callable');
select channex_synthetic_inventory_setup();
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update helm_airbnb_bookings.delivery_scope set enabled=true;
create temporary table delivery_claim as select helm_channex_delivery_claim(gen_random_uuid()) result;
grant select on delivery_claim to service_role;
select pg_temp.assert_true((select result->>'status' from delivery_claim)='claimed','claim creates one attempt');
select pg_temp.assert_true(helm_channex_delivery_claim(gen_random_uuid())->>'status'='blocked','parallel claim blocked');
select pg_temp.assert_true((select jsonb_array_length((result->'attempt'->>'requestBody')::jsonb->'values') from delivery_claim)=500,'exact full window');
select pg_temp.assert_true(not ((select result->'attempt'->>'requestBody' from delivery_claim) ~ 'rate_plan|price|min_stay|stop_sell|guest'),'availability only');
select pg_temp.assert_true((select helm_channex_delivery_claim((result->'attempt'->>'token')::uuid)->>'status' from delivery_claim)='existing','lost claim response returns same attempt');
set role service_role;
select helm_channex_delivery_begin((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest') from delivery_claim;
reset role;
select pg_temp.assert_true((select helm_channex_delivery_begin((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest')->>'status' from delivery_claim)='blocked','lost begin response cannot grant another send');
-- Simulate a dead worker. Expiry never authorizes a replacement after IO barrier.
update helm_airbnb_bookings.delivery_attempts set expires_at=0;
select pg_temp.assert_true(helm_channex_delivery_claim(gen_random_uuid())->>'status'='blocked','expired in-flight worker remains quarantined');
select pg_temp.assert_true((select state from helm_airbnb_bookings.delivery_attempts)='uncertain','expiry recorded as uncertain');
select helm_channex_delivery_record((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest','{"kind":"uncertain"}') from delivery_claim;
-- Late provider receipt is preserved, even if an operator disabled the scope.
update helm_airbnb_bookings.delivery_scope set enabled=false;
select helm_channex_delivery_record((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest',
 '{"kind":"accepted","taskId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}') from delivery_claim;
select helm_channex_delivery_record((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest',
 '{"kind":"accepted","taskId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}') from delivery_claim;
select pg_temp.assert_true((select state from helm_airbnb_bookings.delivery_attempts)='accepted','acceptance saved idempotently, not called settled');
update helm_airbnb_bookings.delivery_scope set enabled=true,next_attempt_at='-infinity';
select pg_temp.assert_true(helm_channex_delivery_claim(gen_random_uuid())->>'status'='blocked','accepted task blocks lane across disable/enable');
do $$declare a jsonb:=(select result->'attempt' from delivery_claim);begin
 begin perform helm_channex_delivery_record((a->>'token')::uuid,a->>'requestDigest','{"kind":"rate-limited","retryAfterSeconds":60}');
  raise exception 'expected_conflict';exception when others then if sqlerrm='expected_conflict' then raise;end if;end;
 begin perform helm_channex_delivery_record((a->>'token')::uuid,repeat('b',64),'{"kind":"uncertain"}');
  raise exception 'expected_mismatch';exception when others then if sqlerrm='expected_mismatch' then raise;end if;end;
end$$;
rollback;

begin;
select channex_synthetic_inventory_setup();
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update helm_airbnb_bookings.delivery_scope set enabled=true;
create temporary table delivery_claim as select helm_channex_delivery_claim(gen_random_uuid()) result;
-- A real canonical write between prepare and dispatch invalidates the request.
select helm_create_booking('65_calderwood','direct','manual','block','2033-01-01','2033-01-03','{"hold_kind":"owner"}');
select pg_temp.assert_true((select helm_channex_delivery_begin((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest')->>'status' from delivery_claim)='blocked','changed source fences prepared request');
update helm_airbnb_bookings.delivery_attempts set expires_at=0;
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update delivery_claim set result=helm_channex_delivery_claim(gen_random_uuid());
select pg_temp.assert_true((select result->>'status' from delivery_claim)='claimed','only expired pre-IO lease can be replaced');
select helm_channex_delivery_begin((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest') from delivery_claim;
select helm_channex_delivery_record((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest','{"kind":"rate-limited","retryAfterSeconds":120}') from delivery_claim;
select pg_temp.assert_true((select next_attempt_at>clock_timestamp()+interval '119 seconds' from helm_airbnb_bookings.delivery_scope),'server enforces retry-after');
select pg_temp.assert_true(helm_channex_delivery_claim(gen_random_uuid())->>'status'='blocked','rate limit cannot retry immediately');
-- Synthetic clock advance without sleeping. A definitive rejection may retry,
-- but it still receives a new token, fresh source guard and immutable request.
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
update delivery_claim set result=helm_channex_delivery_claim(gen_random_uuid());
select pg_temp.assert_true((select result->>'status' from delivery_claim)='claimed','definite rate limit permits fresh attempt after backoff');
select helm_channex_delivery_begin((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest') from delivery_claim;
select helm_channex_delivery_record((result->'attempt'->>'token')::uuid,result->'attempt'->>'requestDigest','{"kind":"unauthorized"}') from delivery_claim;
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
select pg_temp.assert_true(helm_channex_delivery_claim(gen_random_uuid())->>'status'='blocked','credential failure requires configuration review');
rollback;
select 'PASS: durable delivery, one-use send barrier, ambiguous quarantine, stale-plan rejection, backoff and permissions' as result;
