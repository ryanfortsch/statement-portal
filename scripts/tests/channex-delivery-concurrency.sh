#!/usr/bin/env bash
set -euo pipefail
[[ "$PGHOST" == 127.0.0.1 && "$PGDATABASE" == helm_synthetic_channex ]]
[[ "$(psql -X -Atc 'select current_database()')" == helm_synthetic_channex ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
select channex_synthetic_inventory_setup();
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update helm_airbnb_bookings.delivery_scope set enabled=true;
create table channex_synthetic_delivery_claim as select helm_channex_delivery_claim(gen_random_uuid())->'attempt' a;
create table channex_synthetic_delivery_results(result jsonb);
SQL
PGAPPNAME=channex_delivery_first psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
insert into channex_synthetic_delivery_results select helm_channex_delivery_begin((a->>'token')::uuid,a->>'requestDigest') from channex_synthetic_delivery_claim;
select pg_sleep(2);
commit;
SQL
first=$!
ready=0
for i in $(seq 1 30); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_delivery_first' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
insert into channex_synthetic_delivery_results select helm_channex_delivery_begin((a->>'token')::uuid,a->>'requestDigest') from channex_synthetic_delivery_claim;
SQL
wait "$first"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
do $$begin
 if (select count(*) from channex_synthetic_delivery_results where result->>'status'='started')<>1
 or (select count(*) from channex_synthetic_delivery_results where result->>'status'='blocked')<>1
 then raise exception 'Concurrent dispatch was not fenced'; end if;
end$$;
select helm_channex_delivery_record((a->>'token')::uuid,a->>'requestDigest',
 '{"kind":"accepted","taskId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}') from channex_synthetic_delivery_claim;
select helm_create_booking('65_calderwood','direct','manual','block','2036-03-01','2036-03-03','{"hold_kind":"owner"}');
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
truncate channex_synthetic_delivery_results;
SQL
PGAPPNAME=channex_delivery_next psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
insert into channex_synthetic_delivery_results select helm_channex_delivery_claim(gen_random_uuid());
select pg_sleep(2);
commit;
SQL
next_worker=$!
ready=0
for i in $(seq 1 30); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_delivery_next' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
insert into channex_synthetic_delivery_results select helm_channex_delivery_claim(gen_random_uuid());
SQL
wait "$next_worker"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
do $$begin
 if (select count(*) from channex_synthetic_delivery_results where result->>'status'='claimed')<>1
 or (select count(*) from channex_synthetic_delivery_results where result->>'status'='blocked')<>1
 or (select count(*) from helm_airbnb_bookings.delivery_attempts where state='accepted')<>1
 or (select count(*) from helm_airbnb_bookings.delivery_attempts where state='leased')<>1
 then raise exception 'Post-acceptance concurrent claims were not serialized'; end if;
end$$;
-- Only this guarded disposable DB retires synthetic attempts directly.
delete from helm_airbnb_bookings.delivery_attempts;
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update channex_synthetic_delivery_claim set a=helm_channex_delivery_claim(gen_random_uuid())->'attempt';
truncate channex_synthetic_delivery_results;
SQL
PGAPPNAME=channex_delivery_writer psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
select helm_create_booking('65_calderwood','direct','manual','block','2034-02-01','2034-02-03','{"hold_kind":"owner"}');
select pg_sleep(2);
commit;
SQL
writer=$!
ready=0
for i in $(seq 1 30); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_delivery_writer' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
insert into channex_synthetic_delivery_results select helm_channex_delivery_begin((a->>'token')::uuid,a->>'requestDigest') from channex_synthetic_delivery_claim;
SQL
wait "$writer"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if (select result->>'status' from channex_synthetic_delivery_results)<>'blocked'
 then raise exception 'Concurrent booking write failed to fence dispatch'; end if;
end$$;
select 'PASS: concurrent workers produce one send permit; concurrent canonical writes fence stale dispatch without deadlock' as result;
SQL
# Explicit timeout recovery: two workers can retire only one original attempt.
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
delete from helm_airbnb_bookings.delivery_attempts;
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity',consecutive_recoveries=0;
select channex_synthetic_inventory_save(channex_synthetic_inventory_request());
update channex_synthetic_delivery_claim set a=helm_channex_delivery_claim(gen_random_uuid())->'attempt';
select helm_channex_delivery_begin((a->>'token')::uuid,a->>'requestDigest') from channex_synthetic_delivery_claim;
select helm_channex_delivery_record((a->>'token')::uuid,a->>'requestDigest','{"kind":"uncertain"}') from channex_synthetic_delivery_claim;
update helm_airbnb_bookings.delivery_attempts set expires_at=0,started_at=clock_timestamp()-interval '2 minutes';
update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
truncate channex_synthetic_delivery_results;
SQL
PGAPPNAME=channex_recovery_first psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
insert into channex_synthetic_delivery_results select helm_channex_delivery_recover((a->>'token')::uuid,gen_random_uuid()) from channex_synthetic_delivery_claim;
select pg_sleep(2);
commit;
SQL
recovery_first=$!
ready=0
for i in $(seq 1 30); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_recovery_first' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
insert into channex_synthetic_delivery_results select helm_channex_delivery_recover((a->>'token')::uuid,gen_random_uuid()) from channex_synthetic_delivery_claim;
SQL
wait "$recovery_first"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
do $$begin
 if (select count(*) from channex_synthetic_delivery_results where result->>'status'='claimed')<>1
 or (select count(*) from channex_synthetic_delivery_results where result->>'status'='blocked')<>1
 or (select count(*) from helm_airbnb_bookings.delivery_attempts)<>2
 or (select consecutive_recoveries from helm_airbnb_bookings.delivery_scope)<>1
 then raise exception 'Concurrent recovery created duplicate replacements'; end if;
end$$;
SQL
# An authentic late old response wins the lock before the new send checkpoint.
PGAPPNAME=channex_recovery_late psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
select helm_channex_delivery_record((a->>'token')::uuid,a->>'requestDigest',
 '{"kind":"accepted","taskId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}') from channex_synthetic_delivery_claim;
select pg_sleep(2);
commit;
SQL
late_receipt=$!
ready=0
for i in $(seq 1 30); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_recovery_late' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
do $$declare a jsonb:=(select result->'attempt' from channex_synthetic_delivery_results where result->>'status'='claimed');begin
 if helm_channex_delivery_begin((a->>'token')::uuid,a->>'requestDigest')->>'status'<>'blocked'
 then raise exception 'Late receipt failed to fence the concurrent replacement'; end if;
end$$;
SQL
wait "$late_receipt"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if (select count(*) from helm_airbnb_bookings.delivery_attempts where state='submitting')<>0
 or (select count(*) from helm_airbnb_bookings.delivery_attempts where state='accepted')<>1
 then raise exception 'Late receipt released an old send permit'; end if;
end$$;
select 'PASS: competing recoveries create one replacement; late receipts fence prepared sends without deadlock' as result;
SQL
