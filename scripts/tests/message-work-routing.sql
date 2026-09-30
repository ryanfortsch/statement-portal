-- Extend the disposable CI fixture; never execute on a live Helm database.
\set ON_ERROR_STOP on
do $$ begin if current_database() <> 'helm_synthetic_layout' then raise exception 'Synthetic database required'; end if; end $$;
alter table work_slips add column scheduled_date date, add column snoozed_until date;
create table contractors(id uuid primary key,full_name text,phone text,status text);
create table inspection_packets(id uuid primary key,status text,trade text,visit_date date,awarded_contractor_id uuid references contractors);
create table packet_stops(id uuid primary key,packet_id uuid references inspection_packets,property_id text,status text,completed_at timestamptz);
create table packet_stop_work_slips(id uuid default gen_random_uuid() primary key,stop_id uuid references packet_stops,work_slip_id uuid references work_slips,office_note text,created_by_email text,completed_at timestamptz,unique(stop_id,work_slip_id));
\ir ../../supabase/migrations/20260930100000_message_work_field_routing.sql
create function pg_temp.check_true(value boolean, message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %', message; end if; raise notice 'PASS: %',message; end $$;
insert into contractors values ('00000000-0000-0000-0000-000000000030','Synthetic Inspector','+15555550100','active');
insert into inspection_packets values ('00000000-0000-0000-0000-000000000040','claimed','inspection',(now() at time zone 'America/New_York')::date,'00000000-0000-0000-0000-000000000030');
insert into packet_stops values ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000040','home-b','pending',null);
select pg_temp.check_true(helm_route_message_work('00000000-0000-0000-0000-000000000020')->>'status'='office_queue','never attaches work to another property');
update packet_stops set property_id='home-a';
update inspection_packets set status='draft';
select pg_temp.check_true(helm_route_message_work('00000000-0000-0000-0000-000000000020')->>'status'='office_queue','unpublished and unclaimed routes get no task or recipient');
update inspection_packets set status='claimed';
update work_slips set scheduled_date=(now() at time zone 'America/New_York')::date+5;
select pg_temp.check_true(helm_route_message_work('00000000-0000-0000-0000-000000000020')->>'status'='office_queue','future work is not moved into today');
update work_slips set scheduled_date=null,snoozed_until=(now() at time zone 'America/New_York')::date+5;
select pg_temp.check_true(helm_route_message_work('00000000-0000-0000-0000-000000000020')->>'status'='office_queue','snoozed work stays parked');
update work_slips set snoozed_until=null;
update packet_stops set status='complete';
select pg_temp.check_true(helm_route_message_work('00000000-0000-0000-0000-000000000020')->>'status'='office_queue','completed property visits never silently receive new work');
update packet_stops set status='pending';
select pg_temp.check_true(helm_route_message_work('00000000-0000-0000-0000-000000000020')->>'contractor_id'='00000000-0000-0000-0000-000000000030','live assigned inspector receives the task');
select helm_route_message_work('00000000-0000-0000-0000-000000000020');
select pg_temp.check_true((select count(*)=1 from packet_stop_work_slips),'HTTP retries never duplicate attachments');
update contractors set status='paused';
select pg_temp.check_true(helm_route_message_work('00000000-0000-0000-0000-000000000020')->>'status'='already_assigned','paused contractors are not eligible text recipients');
update contractors set status='active';
update inspection_packets set status='submitted';
select pg_temp.check_true(helm_route_message_work('00000000-0000-0000-0000-000000000020')->>'status'='already_assigned','submitted routes stop yielding text recipients');
update work_slips set status='done';
select pg_temp.check_true(helm_route_message_work('00000000-0000-0000-0000-000000000020')->>'status'='closed','closed work is not assigned again');
select pg_temp.check_true(not has_function_privilege('anon','helm_route_message_work(uuid)','execute') and not has_function_privilege('authenticated','helm_route_message_work(uuid)','execute'),'only service role may route work');

-- Leave the fixture ready for the existing photo concurrency checks.
update work_slips set status='open';
