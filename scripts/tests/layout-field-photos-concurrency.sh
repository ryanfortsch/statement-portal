#!/usr/bin/env bash
# Synthetic CI database only. Every psql failure must fail the check.
set -euo pipefail
[[ "$(psql -Atc 'select current_database()')" == helm_synthetic_layout ]]
# Hold the slip row in one transaction; the second append must wait and preserve both photos.
psql -v ON_ERROR_STOP=1 <<'SQL' &
begin;
select helm_edit_field_slip('00000000-0000-0000-0000-000000000020','home-a','Concurrent edit',null,array['https://synthetic.test/concurrent-a.jpg']);
select pg_sleep(1);
commit;
SQL
first=$!
psql -v ON_ERROR_STOP=1 <<'SQL'
select helm_edit_field_slip('00000000-0000-0000-0000-000000000020','home-a','Concurrent edit',null,array['https://synthetic.test/concurrent-b.jpg']);
SQL
wait "$first"
psql -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
if not (select photo_urls @> array['https://synthetic.test/old.jpg','https://synthetic.test/new.jpg','https://synthetic.test/concurrent-a.jpg','https://synthetic.test/concurrent-b.jpg'] and cardinality(photo_urls)=4 and status='open' from work_slips) then raise exception 'Concurrent photo append lost data'; end if;
raise notice 'PASS: concurrent appends preserve both additions and original photos';
end$$;
SQL
