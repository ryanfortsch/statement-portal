-- Only run against the disposable CI database, never an existing Helm database.
\set ON_ERROR_STOP on
do $$ begin if current_database() <> 'helm_synthetic_layout' then raise exception 'Synthetic database required'; end if; end $$;
create role anon;
create role authenticated;
create role service_role;
create table properties(id text primary key);
create table inspection_items(id uuid primary key, template_id uuid not null, property_id text references properties(id), category text, title text, description text, sort_order integer, item_category text);
create table property_inspection_cards(property_id text references properties(id), inspection_item_id uuid references inspection_items(id), position integer not null, unique(property_id,inspection_item_id));
create table work_slips(id uuid primary key, property_id text references properties(id), title text, description text, status text, priority text, photo_urls text[], updated_at timestamptz);
grant all on all tables in schema public to service_role;
\ir ../../supabase/migrations/20260929151500_atomic_inspection_layout_and_field_photos.sql
insert into properties values ('home-a'), ('home-b');
insert into inspection_items values
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',null,'Room','Alpha',null,0,'EVERY_TIME'),
('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010',null,'Room','Bravo',null,1,'EVERY_TIME'),
('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010','home-b','Custom','Other property',null,0,'EVERY_TIME');
insert into work_slips values ('00000000-0000-0000-0000-000000000020','home-a','Cupboard','Details','open','high',array['https://synthetic.test/old.jpg'],now());
create function pg_temp.check_true(value boolean, message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %', message; end if; raise notice 'PASS: %',message; end $$;
create function pg_temp.must_fail(query text) returns void language plpgsql as $$
declare failed boolean := false;
begin begin execute query; exception when others then failed := true; end; if not failed then raise exception 'Unexpected success: %',query; end if; end $$;
set role service_role;
select helm_save_inspection_layout('home-a',array['00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001']::uuid[]);
reset role;
select pg_temp.check_true((select array_agg(inspection_item_id order by position) from property_inspection_cards where property_id='home-a')=array['00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001']::uuid[], 'valid order saves through service role');
select pg_temp.must_fail($q$select helm_save_inspection_layout('home-a','{}')$q$);
select pg_temp.must_fail($q$select helm_save_inspection_layout('home-a',null)$q$);
select pg_temp.must_fail($q$select helm_save_inspection_layout('home-a',array['00000000-0000-0000-0000-000000000001',null]::uuid[])$q$);
select pg_temp.must_fail($q$select helm_save_inspection_layout('home-a',array['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001']::uuid[])$q$);
select pg_temp.must_fail($q$select helm_save_inspection_layout('home-a',array['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099']::uuid[])$q$);
select pg_temp.must_fail($q$select helm_save_inspection_layout('home-a',array['00000000-0000-0000-0000-000000000003']::uuid[])$q$);
select pg_temp.must_fail($q$select helm_save_inspection_layout('missing',array['00000000-0000-0000-0000-000000000001']::uuid[])$q$);
select pg_temp.check_true((select count(*) from property_inspection_cards where property_id='home-a')=2, 'invalid, foreign, empty, duplicate and missing IDs preserve original deck');
-- Force an INSERT failure after DELETE to prove transaction rollback, not just prevalidation.
create function fail_card_write() returns trigger language plpgsql as $$begin raise exception 'Synthetic insert failure'; end$$;
create trigger fail_card_write before insert on property_inspection_cards for each row execute function fail_card_write();
select pg_temp.must_fail($q$select helm_save_inspection_layout('home-a',array['00000000-0000-0000-0000-000000000001']::uuid[])$q$);
select pg_temp.check_true((select count(*) from property_inspection_cards where property_id='home-a')=2, 'failed insert rolls back the preceding delete');
select pg_temp.must_fail($q$select helm_create_inspection_card('home-a',array['00000000-0000-0000-0000-000000000001']::uuid[],'00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000010','Custom check','Specific wording')$q$);
select pg_temp.check_true(not exists(select 1 from inspection_items where id='00000000-0000-0000-0000-000000000004'), 'attachment failure rolls back custom creation');
drop trigger fail_card_write on property_inspection_cards;
select helm_create_inspection_card('home-a',array['00000000-0000-0000-0000-000000000001']::uuid[],'00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000010','Custom check','Specific wording');
select helm_create_inspection_card('home-a',array['00000000-0000-0000-0000-000000000001']::uuid[],'00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000010','Custom check','Specific wording');
select pg_temp.check_true((select count(*) from inspection_items where property_id='home-a')=1 and (select count(*) from property_inspection_cards where property_id='home-a')=2,'lost response retry creates and attaches exactly one custom card');
select pg_temp.must_fail($q$select helm_create_inspection_card('home-a',array['00000000-0000-0000-0000-000000000001']::uuid[],'00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000010','Different content',null)$q$);
select pg_temp.must_fail($q$select helm_create_inspection_card('home-b',array['00000000-0000-0000-0000-000000000001']::uuid[],'00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000010','Custom check','Specific wording')$q$);
select pg_temp.check_true((select title from inspection_items where id='00000000-0000-0000-0000-000000000004')='Custom check','request identity cannot overwrite another card or home');
set role service_role;
select helm_edit_field_slip('00000000-0000-0000-0000-000000000020','home-a','Cupboard repair','New details',array['https://synthetic.test/new.jpg','https://synthetic.test/old.jpg']);
select helm_edit_field_slip('00000000-0000-0000-0000-000000000020','home-a','Cupboard repair','New details',array['https://synthetic.test/new.jpg']);
reset role;
select pg_temp.check_true((select photo_urls=array['https://synthetic.test/old.jpg','https://synthetic.test/new.jpg'] and status='open' and priority='high' and title='Cupboard repair' and description='New details' from work_slips),'photo edit preserves originals, deduplicates retries and leaves status and priority unchanged');
select pg_temp.must_fail($q$select helm_edit_field_slip('00000000-0000-0000-0000-000000000020','home-b','Wrong home',null,'{}')$q$);
select pg_temp.must_fail($q$select helm_edit_field_slip('00000000-0000-0000-0000-000000000020','home-a','Bad image',null,array['javascript:bad'])$q$);
select pg_temp.must_fail($q$select helm_edit_field_slip('00000000-0000-0000-0000-000000000020','home-a','Too many',null,array_fill('https://synthetic.test/extra.jpg'::text,array[13]))$q$);
select pg_temp.check_true((select title='Cupboard repair' from work_slips),'invalid photos and wrong property cannot partially edit text');
update work_slips set status='done';
select pg_temp.must_fail($q$select helm_edit_field_slip('00000000-0000-0000-0000-000000000020','home-a','Closed slip',null,'{}')$q$);
update work_slips set status='dismissed';
select pg_temp.must_fail($q$select helm_edit_field_slip('00000000-0000-0000-0000-000000000020','home-a','Closed slip',null,'{}')$q$);
update work_slips set status='open';
select pg_temp.check_true((select title='Cupboard repair' from work_slips),'closed slips refuse mutation inside the row lock');
select pg_temp.check_true(not has_function_privilege('anon','helm_edit_field_slip(uuid,text,text,text,text[])','execute') and not has_function_privilege('authenticated','helm_edit_field_slip(uuid,text,text,text,text[])','execute') and not has_function_privilege('anon','helm_save_inspection_layout(text,uuid[])','execute') and not has_function_privilege('authenticated','helm_create_inspection_card(text,uuid[],uuid,uuid,text,text)','execute'),'RPCs cannot bypass server authentication');

\ir message-work-routing.sql
