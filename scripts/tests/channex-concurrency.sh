#!/usr/bin/env bash
set -euo pipefail
[[ "$PGHOST" == 127.0.0.1 && "$PGDATABASE" == helm_synthetic_channex ]]
[[ "$(psql -X -Atc 'select current_database()')" == helm_synthetic_channex ]]
# A manual writer owns the canonical advisory lock BEFORE touching captured rows.
# A simultaneous importer must not hold a capture lock while waiting for it.
PGAPPNAME=channex_synthetic_manual psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
select pg_advisory_xact_lock(hashtext('helm_bookings:65_calderwood'));
select pg_sleep(2);
select helm_create_booking('65_calderwood','direct','manual','block','2028-01-05','2028-01-07','{"hold_kind":"owner"}');
commit;
SQL
first=$!
ready=0
for i in $(seq 1 30); do
  if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_synthetic_manual' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
  sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
select helm_airbnb_revision_commit(channex_synthetic_revision(10,'2026-11-06T15:00:10.000001Z','new',3)||'{"checkIn":"2028-01-01","checkOut":"2028-01-04"}'::jsonb);
SQL
wait "$first"
# Two deliveries of the same revision must converge to one immutable receipt.
for i in 1 2; do
 psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
set statement_timeout='12s';
select helm_airbnb_revision_commit(channex_synthetic_revision(11,'2026-11-06T15:00:11.000001Z','new',4)||'{"checkIn":"2028-02-01","checkOut":"2028-02-04"}'::jsonb);
SQL
 if [[ $i == 1 ]]; then one=$!; else two=$!; fi
done
wait "$one"
wait "$two"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if (select count(*) from helm_airbnb_bookings.receipts where revision_id='10000000-0000-4000-8000-000000000011')<>1
 or (select count(*) from bookings where external_confirmation_code='SYNTHETIC4')<>1
 then raise exception 'Concurrent duplicate created multiple records';end if;
end$$;
select 'PASS: concurrent manual and provider writes; concurrent duplicate delivery' as result;
SQL

# Existing manual moves lock the booking row BEFORE the canonical advisory lock.
# Importing a modification to that same booking must use that order too.
PGAPPNAME=channex_synthetic_move psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
select id from bookings where external_confirmation_code='SYNTHETIC4' for update;
select pg_sleep(2);
select helm_move_booking(id,check_in,check_out,status,'synthetic-manual',false)
from bookings where external_confirmation_code='SYNTHETIC4';
commit;
SQL
manual=$!
ready=0
for i in $(seq 1 30); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_synthetic_move' and wait_event='PgSleep'")" == 1 ]];then ready=1;break;fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
select helm_airbnb_revision_commit(channex_synthetic_revision(12,'2026-11-06T15:00:12.000001Z','modified',4)||'{"checkIn":"2028-02-01","checkOut":"2028-02-05"}'::jsonb);
SQL
wait "$manual"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if (select check_out from bookings where external_confirmation_code='SYNTHETIC4') is distinct from '2028-02-05'::date
 then raise exception 'Concurrent same-booking modification was lost';end if;
end$$;
select 'PASS: concurrent manual and provider modification of the same booking' as result;
SQL

# A canonical creator can commit the identity while import is waiting for the
# property lock. The importer must inspect identity AFTER acquiring that lock,
# even when its incoming cancellation/changed dates would not overlap the stay.
PGAPPNAME=channex_synthetic_identity psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null &
begin;
set local statement_timeout='12s';
select pg_advisory_xact_lock(hashtext('helm_bookings:65_calderwood'));
select pg_sleep(2);
select helm_create_booking('65_calderwood','airbnb','ical_import','confirmed','2028-06-01','2028-06-03',
 '{"external_confirmation_code":"SYNTHETIC90"}');
commit;
SQL
identity_writer=$!
ready=0
for i in $(seq 1 30); do
 if [[ "$(psql -X -Atc "select count(*) from pg_stat_activity where application_name='channex_synthetic_identity' and wait_event='PgSleep'")" == 1 ]];then ready=1;break;fi
 sleep 0.1
done
[[ $ready == 1 ]]
psql -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
set statement_timeout='12s';
do $$begin
 begin
  perform helm_airbnb_revision_commit(channex_synthetic_revision(90,'2026-11-06T15:01:30.000001Z','cancelled',90)
   ||'{"checkIn":"2028-07-01","checkOut":"2028-07-03"}');
  raise exception 'expected identity collision';
 exception when others then if sqlerrm<>'existing_airbnb_stay_requires_handoff' then raise;end if;end;
end$$;
SQL
wait "$identity_writer"
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if (select count(*) from bookings where external_confirmation_code='SYNTHETIC90')<>1
 or exists(select 1 from helm_airbnb_bookings.receipts where revision_id='10000000-0000-4000-8000-000000000090')
 then raise exception 'Existing stay duplicated or acknowledged';end if;
end$$;
select 'PASS: concurrent canonical creation is observed before first revision import' as result;
SQL
