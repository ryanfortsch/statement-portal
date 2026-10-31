-- Disposable database only. Run with: psql -v ON_ERROR_STOP=1 -f scripts/tests/linked-work-issues.sql
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.work_slips (
 id uuid primary key, property_id text not null, title text not null default 'Synthetic report',
 status text not null default 'open', completed_at timestamptz, closed_at timestamptz, closed_by_email text,
 from_supply_key text, from_prep_rule_key text, from_guest_request_key text,
 snoozed_until date, snoozed_by_email text, snoozed_at timestamptz,
 description text, resolution_notes text, expense_cents integer
);
grant all on public.work_slips to service_role;
\ir ../../supabase/migrations/20261031010000_linked_work_issues.sql
insert into work_slips(id, property_id, description, expense_cents)
select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 case when n=5 then 'other-home' else 'synthetic-home' end, 'Original report ' || n, n*100 from generate_series(1,8) n;
update work_slips set from_supply_key='paper_towels' where id='00000000-0000-4000-8000-000000000006';

create function pg_temp.expect_failure(statement text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then return;
 end;
 raise exception 'Expected rejection: %', statement;
end;
$$;
select pg_temp.expect_failure($q$select link_work_issue('00000000-0000-4000-8000-000000000001',array['00000000-0000-4000-8000-000000000005']::uuid[],'operator@example.test')$q$);
select pg_temp.expect_failure($q$select link_work_issue('00000000-0000-4000-8000-000000000001',array['00000000-0000-4000-8000-000000000006']::uuid[],'operator@example.test')$q$);
select pg_temp.expect_failure($q$select link_work_issue('00000000-0000-4000-8000-000000000001',array['00000000-0000-4000-8000-000000000099']::uuid[],'operator@example.test')$q$);
select pg_temp.expect_failure($q$select link_work_issue('00000000-0000-4000-8000-000000000001',array['00000000-0000-4000-8000-000000000002']::uuid[],'')$q$);
select link_work_issue('00000000-0000-4000-8000-000000000001',array['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003']::uuid[],'operator@example.test');
select link_work_issue('00000000-0000-4000-8000-000000000001',array['00000000-0000-4000-8000-000000000002']::uuid[],'operator@example.test');
do $$ begin
 if (select count(*) from work_issue_reports) <> 3 or (select count(*) from work_issue_events) <> 1 then raise exception 'Link retry duplicated membership or audit'; end if;
 if exists(select 1 from work_slips where status <> 'open') then raise exception 'Link changed a status'; end if;
 if has_function_privilege('anon','public.link_work_issue(uuid,uuid[],text)','execute') or has_function_privilege('authenticated','public.separate_work_issue(uuid,uuid[],text)','execute') then raise exception 'Link RPC exposed to clients'; end if;
 if has_table_privilege('anon','public.work_issue_reports','select') then raise exception 'Link table exposed'; end if;
end $$;
select pg_temp.expect_failure($q$select link_work_issue('00000000-0000-4000-8000-000000000004',array['00000000-0000-4000-8000-000000000002']::uuid[],'operator@example.test')$q$);
select pg_temp.expect_failure($q$select separate_work_issue('00000000-0000-4000-8000-000000000001',array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']::uuid[],'operator@example.test')$q$);
select pg_temp.expect_failure($q$update work_slips set status='dismissed' where id='00000000-0000-4000-8000-000000000002'$q$);
-- Simulate a sibling write failing: no report may close partially.
create function pg_temp.reject_sibling() returns trigger language plpgsql as $$ begin if new.id='00000000-0000-4000-8000-000000000003' and new.status='done' then raise exception 'Synthetic write failure'; end if; return new; end $$;
create trigger synthetic_failure before update on work_slips for each row execute function pg_temp.reject_sibling();
select pg_temp.expect_failure($q$update work_slips set status='done',completed_at='2026-10-30 20:00Z' where id='00000000-0000-4000-8000-000000000002'$q$);
do $$ begin if exists(select 1 from work_slips where status <> 'open') then raise exception 'Partial completion escaped transaction'; end if; end $$;
drop trigger synthetic_failure on work_slips;
-- Completion through a raw writer (Field, property, integration) follows the same rule.
update work_slips set status='done',completed_at='2026-10-30 20:00Z',closed_by_email='operator@example.test',resolution_notes='Fixed the valve'
where id='00000000-0000-4000-8000-000000000002';
do $$ begin
 if (select count(*) from work_slips where status='done') <> 3 then raise exception 'Completion missed a linked report or touched another issue'; end if;
 if exists(select 1 from work_slips where description not like 'Original report %' or expense_cents is null) then raise exception 'Original evidence changed'; end if;
 if (select count(*) from work_slips where resolution_notes is not null) <> 1 then raise exception 'Resolution overwrote other reports'; end if;
end $$;
update work_slips set status='done',completed_at='2026-10-31 20:00Z',closed_by_email='retry@example.test' where id='00000000-0000-4000-8000-000000000002';
do $$ begin if exists(select 1 from work_slips where status='done' and completed_at <> '2026-10-30 20:00Z') then raise exception 'Retry changed completion evidence'; end if; end $$;
select pg_temp.expect_failure($q$select link_work_issue('00000000-0000-4000-8000-000000000001',array['00000000-0000-4000-8000-000000000004']::uuid[],'operator@example.test')$q$);
update work_slips set status='open' where id='00000000-0000-4000-8000-000000000001';
do $$ begin if exists(select 1 from work_slips where status='done' or completed_at is not null) then raise exception 'Reopen left completed reports'; end if; end $$;
select pg_temp.expect_failure($q$update work_slips set property_id='other-home' where id='00000000-0000-4000-8000-000000000002'$q$);
select pg_temp.expect_failure($q$update work_slips set from_supply_key='soap' where id='00000000-0000-4000-8000-000000000002'$q$);
update work_slips set status='done' where id='00000000-0000-4000-8000-000000000001';
do $$ begin if (select count(*) from work_slips where status='done' and completed_at is not null) <> 3 then raise exception 'Raw writer did not stamp completion'; end if; end $$;
update work_slips set status='scheduled' where id='00000000-0000-4000-8000-000000000002';
do $$ begin if exists(select 1 from work_slips where status='done' or completed_at is not null) then raise exception 'Reschedule did not reopen linked reports'; end if; end $$;
select separate_work_issue('00000000-0000-4000-8000-000000000001',array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003']::uuid[],'operator@example.test');
select separate_work_issue('00000000-0000-4000-8000-000000000001',array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003']::uuid[],'operator@example.test');
update work_slips set status='done',completed_at=now() where id='00000000-0000-4000-8000-000000000001';
do $$ begin
 if (select count(*) from work_slips where status='done') <> 1 then raise exception 'Separated reports still cascade'; end if;
 if (select count(*) from work_issue_events where action='separated') <> 1 then raise exception 'Separate retry duplicated history'; end if;
end $$;
select 'PASS: linked issue permissions, atomic completion, evidence, retry, reopen, separation, and conflict checks' as result;
