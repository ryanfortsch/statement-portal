#!/usr/bin/env bash
# Disposable CI database only; never point this script at a customer database.
set -euo pipefail
[[ "$(psql -Atc 'select current_database()')" == helm_synthetic_work ]]
psql -v ON_ERROR_STOP=1 <<'SQL'
update work_slips set status='open' where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
select link_work_issue('00000000-0000-4000-8000-000000000001',array['00000000-0000-4000-8000-000000000002']::uuid[],'operator@example.test');
SQL
psql -v ON_ERROR_STOP=1 <<'SQL' &
set statement_timeout='10s';
begin;
update work_slips set status='done',closed_by_email='first@example.test' where id='00000000-0000-4000-8000-000000000001';
select pg_sleep(1);
commit;
SQL
first=$!
psql -v ON_ERROR_STOP=1 <<'SQL'
set statement_timeout='10s';
update work_slips set status='done',closed_by_email='second@example.test' where id='00000000-0000-4000-8000-000000000002';
SQL
wait "$first"
psql -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
 if (select count(*) from work_slips where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002') and status='done' and completed_at is not null) <> 2 then raise exception 'Concurrent completion left a report open'; end if;
 if (select count(distinct closed_by_email) from work_slips where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')) <> 1 then raise exception 'Concurrent retry changed completion attribution'; end if;
end $$;
-- Bulk updates containing multiple reports from one issue must work too.
update work_slips set status='open' where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
update work_slips set status='done' where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
do $$ begin if (select count(*) from work_slips where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002') and status='done') <> 2 then raise exception 'Bulk completion failed'; end if; end $$;
select 'PASS: simultaneous and bulk completion preserve one issue' as result;
SQL
