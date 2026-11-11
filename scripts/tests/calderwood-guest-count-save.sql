\set ON_ERROR_STOP on
-- Disposable local/CI database only. No customer records or credentials.
do $$begin
  if current_database() <> 'helm_synthetic_cleaner_counts' then raise exception 'synthetic_database_required'; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
create type booking_source as enum('ical_import','guesty_legacy','manual');
create type booking_status as enum('confirmed','completed','cancelled','block');
create table properties(id text primary key, calendar_authority text);
create table bookings(id uuid primary key, property_id text, duplicate_of uuid, status booking_status, source booking_source,
  check_in date, check_out date, last_seen_at timestamptz, external_confirmation_code text, num_guests integer,
  payout numeric, guest_name text);
create table guesty_reservations(guesty_reservation_id text primary key, property_id text, listing_id text,
  status text, confirmation_code text, check_in date, check_out date);
create table booking_events(id uuid default gen_random_uuid(), booking_id uuid references bookings(id), kind text, actor text,
  before jsonb, after jsonb, note text);
grant select, update on properties, bookings, guesty_reservations to service_role;
grant select, insert on booking_events to service_role;
\ir ../../supabase/migrations/20261111160000_calderwood_guest_count_save.sql
\ir ../../supabase/migrations/20261111160000_calderwood_guest_count_save.sql

create function pg_temp.reset_fixture() returns void language plpgsql as $$begin
  truncate booking_events, bookings, guesty_reservations, properties;
  insert into properties values('65_calderwood','guesty'),('other_home','guesty');
  insert into bookings values('00000000-0000-4000-8000-000000000001','65_calderwood',null,'confirmed','ical_import',
    current_date+10,current_date+14,'2030-01-01T12:00:00Z','SYNTHETIC-A',null,123.45,'Private synthetic name');
  insert into guesty_reservations values('aaaaaaaaaaaaaaaaaaaaaaaa','65_calderwood','66797ba7f51d72001388bc29','confirmed',
    'SYNTHETIC-A',current_date+10,current_date+14);
end$$;
create function pg_temp.plan() returns jsonb language sql as $$select jsonb_build_array(jsonb_build_object(
  'booking_id','00000000-0000-4000-8000-000000000001','guesty_reservation_id','aaaaaaaaaaaaaaaaaaaaaaaa',
  'confirmation_code','SYNTHETIC-A','check_in',current_date+10,'check_out',current_date+14,
  'source','ical_import','status','confirmed','last_seen_at','2030-01-01T12:00:00Z','num_guests',5))$$;
create function pg_temp.expect_rejection(p jsonb, stamp timestamptz default clock_timestamp()) returns void language plpgsql as $$
declare rejected boolean := false; begin
  begin perform helm_save_calderwood_guest_counts(p,stamp,'owner@synthetic.test');
  exception when others then rejected := true; end;
  if not rejected then raise exception 'unexpected_save'; end if;
  if exists(select 1 from booking_events) then raise exception 'partial_audit'; end if;
end$$;

select pg_temp.reset_fixture();
set role service_role;
select helm_save_calderwood_guest_counts(pg_temp.plan(),clock_timestamp(),'owner@synthetic.test');
reset role;
do $$begin
  if (select num_guests from bookings) <> 5 or (select count(*) from booking_events) <> 1
    or (select before from booking_events) <> '{"num_guests":null}'::jsonb
    or (select after from booking_events) <> '{"num_guests":5}'::jsonb
    or (select payout from bookings) <> 123.45 or (select guest_name from bookings) <> 'Private synthetic name'
  then raise exception 'save_or_audit_incorrect'; end if;
  if has_function_privilege('anon','helm_save_calderwood_guest_counts(jsonb,timestamptz,text)','EXECUTE')
    or has_function_privilege('authenticated','helm_save_calderwood_guest_counts(jsonb,timestamptz,text)','EXECUTE')
  then raise exception 'unprivileged_execute'; end if;
end$$;

-- Existing counts, including a retry, cannot be overwritten.
truncate booking_events;
select pg_temp.expect_rejection(pg_temp.plan());
do $$begin if (select num_guests from bookings) <> 5 then raise exception 'existing_count_changed'; end if; end$$;
select pg_temp.reset_fixture();
select pg_temp.expect_rejection(pg_temp.plan(), clock_timestamp()-interval '61 seconds');
select pg_temp.expect_rejection(pg_temp.plan(), clock_timestamp()+interval '10 seconds');
select pg_temp.expect_rejection('[]');
select pg_temp.expect_rejection(pg_temp.plan() || pg_temp.plan());
select pg_temp.expect_rejection(jsonb_set(pg_temp.plan(),'{0,num_guests}','0'));
select pg_temp.expect_rejection(jsonb_set(pg_temp.plan(),'{0,num_guests}','1.5'));
select pg_temp.expect_rejection(jsonb_set(pg_temp.plan(),'{0,num_guests}','"5"'));
select pg_temp.expect_rejection(jsonb_set(pg_temp.plan(),'{0,num_guests}','101'));
select pg_temp.expect_rejection(jsonb_set(pg_temp.plan(),'{0,extra}','true'));
select pg_temp.expect_rejection(pg_temp.plan() #- '{0,source}');

do $$declare mutation text; begin
  foreach mutation in array array[
    'update properties set calendar_authority=''helm'' where id=''65_calderwood''',
    'update bookings set property_id=''other_home''',
    'update bookings set status=''cancelled''',
    'update bookings set source=''manual''',
    'update bookings set check_out=check_out+1',
    'update bookings set last_seen_at=clock_timestamp()',
    'update bookings set external_confirmation_code=''OTHER''',
    'update bookings set duplicate_of=id',
    'update guesty_reservations set status=''cancelled''',
    'update guesty_reservations set property_id=''other_home''',
    'update guesty_reservations set listing_id=''bbbbbbbbbbbbbbbbbbbbbbbb''',
    'update guesty_reservations set check_out=check_out+1',
    'update guesty_reservations set confirmation_code=''OTHER''',
    'delete from guesty_reservations',
    'insert into guesty_reservations select ''bbbbbbbbbbbbbbbbbbbbbbbb'',property_id,listing_id,status,'' synthetic-a '',check_in,check_out from guesty_reservations',
    'insert into bookings select ''00000000-0000-4000-8000-000000000002'',property_id,duplicate_of,status,source,check_in,check_out,last_seen_at,external_confirmation_code,num_guests,payout,guest_name from bookings'
  ] loop
    perform pg_temp.reset_fixture(); execute mutation;
    perform pg_temp.expect_rejection(pg_temp.plan());
    if exists(select 1 from bookings where num_guests is not null) then raise exception 'count_changed_on_refusal'; end if;
  end loop;
end$$;

-- A stale second row rolls back a valid first row and its audit event.
select pg_temp.reset_fixture();
select pg_temp.expect_rejection(pg_temp.plan() || jsonb_build_array(jsonb_set(jsonb_set(pg_temp.plan()->0,
  '{booking_id}','"00000000-0000-4000-8000-000000000002"'),'{guesty_reservation_id}','"bbbbbbbbbbbbbbbbbbbbbbbb"')));
do $$begin if exists(select 1 from bookings where num_guests is not null) then raise exception 'partial_batch'; end if; end$$;
-- An audit failure must roll back the count too.
alter table booking_events add constraint synthetic_audit_failure check(false);
select pg_temp.expect_rejection(pg_temp.plan());
do $$begin if exists(select 1 from bookings where num_guests is not null) then raise exception 'unaudited_write'; end if; end$$;
alter table booking_events drop constraint synthetic_audit_failure;
\echo 'Scoped guest count saves, permissions, drift, retries and rollback checks passed.'
