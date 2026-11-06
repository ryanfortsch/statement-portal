#!/usr/bin/env bash
set -euo pipefail
[[ "$PGHOST" == 127.0.0.1 && "$PGDATABASE" == helm_synthetic_channex ]]
[[ "$(psql -X -Atc 'select current_database()')" == helm_synthetic_channex ]]
# Only this local synthetic fixture persists requests. No hosted data is loaded.
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
select channex_synthetic_inventory_setup();
create table channex_synthetic_plan_request as select channex_synthetic_inventory_request() r;
create table channex_synthetic_plan_results(result jsonb);
SQL
# Both workers prepared the same source/configuration versions. One commits and
# the waiting worker must resolve to the SAME immutable plan, never a second row.
PGAPPNAME=channex_synthetic_plan_first psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
select singleton from helm_airbnb_bookings.inventory_scope for update;
select pg_sleep(2);
insert into channex_synthetic_plan_results select channex_synthetic_inventory_save(r) from channex_synthetic_plan_request;
commit;
SQL
first=$!
ready=0
for i in $(seq 1 30); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_synthetic_plan_first' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
insert into channex_synthetic_plan_results select channex_synthetic_inventory_save(r) from channex_synthetic_plan_request;
SQL
wait "$first"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
do $$begin
 if (select count(distinct result->'version') from channex_synthetic_plan_results)<>1
 or (select count(*) from channex_synthetic_plan_results where result->>'status'='stored')<>1
 or (select count(*) from channex_synthetic_plan_results where result->>'status'='unchanged')<>1
 then raise exception 'Concurrent planners did not converge'; end if;
end$$;
update channex_synthetic_plan_request set r=channex_synthetic_inventory_request();
truncate channex_synthetic_plan_results;
SQL
# A real canonical writer changes captured inventory but has not yet committed.
# The planner waits on its version lock, then rejects its obsolete snapshot.
PGAPPNAME=channex_synthetic_plan_booking psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
select helm_create_booking('65_calderwood','direct','manual','block','2030-02-01','2030-02-03','{"hold_kind":"owner"}');
select pg_sleep(2);
commit;
SQL
writer=$!
ready=0
for i in $(seq 1 30); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_synthetic_plan_booking' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
insert into channex_synthetic_plan_results select channex_synthetic_inventory_save(r) from channex_synthetic_plan_request;
SQL
wait "$writer"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if (select result->>'status' from channex_synthetic_plan_results)<>'superseded'
 then raise exception 'Stale planner crossed concurrent booking write'; end if;
end$$;
select 'PASS: concurrent planners converge; concurrent canonical writes invalidate plans without deadlock' as result;
SQL
