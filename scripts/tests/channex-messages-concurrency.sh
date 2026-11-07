#!/usr/bin/env bash
set -euo pipefail
[[ "$PGHOST" == 127.0.0.1 && "$PGDATABASE" == helm_synthetic_channex ]]
[[ "$(psql -X -Atc 'select current_database()')" == helm_synthetic_channex ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
select channex_synthetic_message_setup();
create table channex_synthetic_message_results(result boolean);
SQL
PGAPPNAME=channex_message_first psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
insert into channex_synthetic_message_results select helm_channex_message_claim('90000000-0000-4000-8000-000000000002',gen_random_uuid(),channex_synthetic_message_attempt());
select pg_sleep(2);
commit;
SQL
first=$!
ready=0
for i in $(seq 1 40); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_message_first' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
insert into channex_synthetic_message_results select helm_channex_message_claim('90000000-0000-4000-8000-000000000002',gen_random_uuid(),channex_synthetic_message_attempt());
SQL
wait "$first"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
do $$begin
 if (select count(*) from channex_synthetic_message_results where result)<>1
 or (select count(*) from channex_synthetic_message_results where not result)<>1 then raise exception 'duplicate_claim'; end if;
end$$;
select channex_synthetic_message_setup();
truncate channex_synthetic_message_results;
SQL
PGAPPNAME=channex_message_cancel psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
select helm_move_booking('90000000-0000-4000-8000-000000000001','2035-01-01','2035-01-03','cancelled','synthetic');
select pg_sleep(2);
commit;
SQL
writer=$!
ready=0
for i in $(seq 1 40); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_message_cancel' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
insert into channex_synthetic_message_results select helm_channex_message_claim('90000000-0000-4000-8000-000000000002',gen_random_uuid(),channex_synthetic_message_attempt());
SQL
wait "$writer"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if (select result from channex_synthetic_message_results) is distinct from false then raise exception 'cancel_race_sent'; end if;
 if (select status from automation_sends where id='90000000-0000-4000-8000-000000000002')<>'cancelled' then raise exception 'cancel_missing'; end if;
end$$;
select 'PASS: two simultaneous workers get one send permit; canonical cancellation wins without deadlock' as result;
SQL

# Two installers race on the same complete bundle. Both must observe the same six
# canonical IDs, with one insert and one idempotent read, never twelve rows.
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
delete from helm_channex_messages.hold_events; delete from helm_channex_messages.jobs;
delete from helm_channex_messages.scope; delete from public.automation_sends; delete from public.message_automations;
update public.properties set calendar_authority='guesty',automations_enabled=false where id='65_calderwood';
create table channex_synthetic_template_results(result jsonb);
SQL
PGAPPNAME=channex_template_first psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
insert into channex_synthetic_template_results select helm_channex_prepare_templates(payload) from channex_synthetic_template_input;
select pg_sleep(2);
commit;
SQL
first=$!
ready=0
for i in $(seq 1 40); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_template_first' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
insert into channex_synthetic_template_results select helm_channex_prepare_templates(payload) from channex_synthetic_template_input;
SQL
wait "$first"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if (select count(*) from channex_synthetic_template_results where result->>'reused'='false')<>1
 or (select count(*) from channex_synthetic_template_results where result->>'reused'='true')<>1
 or (select count(*) from public.message_automations)<>6
 or exists(select 1 from public.automation_sends) then raise exception 'template_install_race'; end if;
end$$;
select 'PASS: simultaneous template installs create exactly six disabled canonical rules and zero sends' as result;
SQL
