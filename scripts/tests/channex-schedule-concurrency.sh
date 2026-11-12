#!/usr/bin/env bash
set -euo pipefail
[[ "$PGHOST" == 127.0.0.1 && "$PGDATABASE" == helm_synthetic_channex ]]
[[ "$(psql -X -Atc 'select current_database()')" == helm_synthetic_channex ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create table channex_synthetic_registration_results(result jsonb);
SQL
PGAPPNAME=channex_registration_first psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
insert into channex_synthetic_registration_results select helm_channex_message_register(payload) from channex_synthetic_registration_input;
select pg_sleep(2);
commit;
SQL
first=$!
ready=0
for i in $(seq 1 40); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_registration_first' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
insert into channex_synthetic_registration_results select helm_channex_message_register(payload) from channex_synthetic_registration_input;
do $$begin
 if (select count(*) from channex_synthetic_registration_results where result->>'state'='created')<>1
 or (select count(*) from channex_synthetic_registration_results where result->>'state'='existing')<>1
 or (select count(*) from automation_sends)<>1 or (select count(*) from helm_channex_messages.jobs)<>1
 then raise exception 'registration_duplicate'; end if;
end$$;
SQL
wait "$first"
# A cancellation holds the same canonical booking lock ahead of registration.
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
select channex_synthetic_message_setup();
delete from helm_channex_messages.jobs; delete from automation_sends;
update message_automations set delivery='ota_manual';
update channex_synthetic_registration_input set payload=payload||helm_channex_message_schedule_context('90000000-0000-4000-8000-000000000001');
truncate channex_synthetic_registration_results;
create function public.channex_synthetic_registration_try() returns jsonb language plpgsql as $$begin
 return helm_channex_message_register((select payload from channex_synthetic_registration_input));
 exception when raise_exception then
 if sqlerrm<>'message_registration_not_ready' then raise; end if;
 return jsonb_build_object('state','blocked');
end$$;
SQL
PGAPPNAME=channex_registration_cancel psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
select helm_move_booking('90000000-0000-4000-8000-000000000001','2035-01-01','2035-01-03','cancelled','synthetic');
select pg_sleep(2);
commit;
SQL
writer=$!
ready=0
for i in $(seq 1 40); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_registration_cancel' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
insert into channex_synthetic_registration_results select channex_synthetic_registration_try();
do $$begin
 if (select result->>'state' from channex_synthetic_registration_results) is distinct from 'blocked'
 or exists(select 1 from automation_sends) or exists(select 1 from helm_channex_messages.jobs)
 then raise exception 'cancel_race_registered'; end if;
end$$;
SQL
wait "$writer"
echo 'PASS: concurrent registration creates one schedule/job; cancellation wins without partial rows'
