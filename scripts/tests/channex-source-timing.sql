-- Called only by the guarded synthetic loopback runner.
create function public.channex_synthetic_timing_setup() returns void language plpgsql as $$begin
 delete from helm_channex_messages.hold_events; delete from helm_channex_messages.jobs;
 delete from helm_channex_messages.scope; delete from public.automation_sends;
 delete from helm_channex_messages.source_timing_captures;
 update public.bookings set status='cancelled';
 update public.properties set calendar_authority='guesty',automations_enabled=false where id='65_calderwood';
 delete from public.bookings where id in ('90000000-0000-4000-8000-000000000901','90000000-0000-4000-8000-000000000902');
 delete from public.guesty_reservations;
 insert into public.bookings(id,property_id,channel,source,status,check_in,check_out,external_confirmation_code)
 values('90000000-0000-4000-8000-000000000901','65_calderwood','airbnb','ical_import','confirmed',
 (clock_timestamp() at time zone 'America/New_York')::date+10,(clock_timestamp() at time zone 'America/New_York')::date+14,'SYNTHETIC-TIMING-A');
 insert into public.guesty_reservations values('aaaaaaaaaaaaaaaaaaaaaaaa','65_calderwood','66797ba7f51d72001388bc29',
 'confirmed','Airbnb','SYNTHETIC-TIMING-A',(clock_timestamp() at time zone 'America/New_York')::date+10,
 (clock_timestamp() at time zone 'America/New_York')::date+14);
end$$;
create function public.channex_synthetic_timing_plan() returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('bookingId','90000000-0000-4000-8000-000000000901',
 'guestyId','aaaaaaaaaaaaaaaaaaaaaaaa','code','SYNTHETIC-TIMING-A',
 'start',(clock_timestamp() at time zone 'America/New_York')::date+10,
 'end',(clock_timestamp() at time zone 'America/New_York')::date+14,'source','ical_import','status','confirmed',
 'clocks',jsonb_build_object('timezone','America/New_York','plannedArrival',null,'plannedDeparture','12:00',
 'defaultArrival','16:00','defaultDeparture','11:00','confirmedAt','2026-01-01T18:00:00.000Z')))
$$;
create function public.channex_synthetic_timing_reject(p jsonb,
 checked timestamptz default clock_timestamp(),started timestamptz default clock_timestamp()-interval '5 seconds')
 returns void language plpgsql as $$declare blocked boolean:=false; begin
 begin perform public.helm_channex_capture_source_timing(p,started,checked,'owner@synthetic.test');
 exception when others then blocked:=true; end;
 if not blocked then raise exception 'unexpected_capture'; end if;
 if exists(select 1 from helm_channex_messages.source_timing_captures) then raise exception 'partial_capture'; end if;
end$$;
select channex_synthetic_timing_setup();
-- Snapshots and every other table remain unchanged across installation/review.
create temp table timing_before as select to_jsonb(b) as row from public.bookings b;
set role service_role;
select public.helm_channex_capture_source_timing(channex_synthetic_timing_plan(),clock_timestamp()-interval '5 seconds',clock_timestamp(),'owner@synthetic.test');
reset role;
do $$begin
 if (select count(*) from helm_channex_messages.source_timing_captures)<>1
 or (select rows from helm_channex_messages.source_timing_captures)<>channex_synthetic_timing_plan()
 or (select actor from helm_channex_messages.source_timing_captures)<>'owner@synthetic.test'
 or exists((select row from timing_before) except (select to_jsonb(b) from public.bookings b))
 or exists(select 1 from automation_sends) or exists(select 1 from helm_channex_messages.jobs)
 or (select calendar_authority from properties where id='65_calderwood')<>'guesty'
 then raise exception 'capture_contract_failed'; end if;
 if has_table_privilege('service_role','helm_channex_messages.source_timing_captures','select,insert,update,delete')
 or has_table_privilege('authenticated','helm_channex_messages.source_timing_captures','select,insert,update,delete')
 or has_table_privilege('anon','helm_channex_messages.source_timing_captures','select,insert,update,delete')
 or has_function_privilege('anon','helm_channex_capture_source_timing(jsonb,timestamptz,timestamptz,text)','execute')
 or has_function_privilege('authenticated','helm_channex_capture_source_timing(jsonb,timestamptz,timestamptz,text)','execute')
 then raise exception 'capture_permissions_failed'; end if;
end$$;
-- Separate observations append evidence; they never overwrite an older checkpoint.
select public.helm_channex_capture_source_timing(channex_synthetic_timing_plan(),clock_timestamp()-interval '5 seconds',clock_timestamp(),'owner@synthetic.test');
do $$begin if (select count(*) from helm_channex_messages.source_timing_captures)<>2 then raise exception 'history_overwritten'; end if; end$$;
select channex_synthetic_timing_setup();
select channex_synthetic_timing_reject(null);
select channex_synthetic_timing_reject('[]');
select channex_synthetic_timing_reject('{}');
select channex_synthetic_timing_reject(channex_synthetic_timing_plan()||channex_synthetic_timing_plan());
select channex_synthetic_timing_reject(channex_synthetic_timing_plan(),clock_timestamp()-interval '61 seconds',clock_timestamp()-interval '65 seconds');
select channex_synthetic_timing_reject(channex_synthetic_timing_plan(),clock_timestamp()+interval '1 second');
select channex_synthetic_timing_reject(channex_synthetic_timing_plan(),clock_timestamp(),clock_timestamp()-interval '81 seconds');
select channex_synthetic_timing_reject(channex_synthetic_timing_plan() #- '{0,clocks,plannedArrival}');
select channex_synthetic_timing_reject(jsonb_set(channex_synthetic_timing_plan(),'{0,clocks,defaultArrival}','null'));
select channex_synthetic_timing_reject(jsonb_set(channex_synthetic_timing_plan(),'{0,clocks,plannedDeparture}','"25:00"'));
select channex_synthetic_timing_reject(jsonb_set(channex_synthetic_timing_plan(),'{0,clocks,confirmedAt}','"2026-02-30T18:00:00.000Z"'));
select channex_synthetic_timing_reject(jsonb_set(channex_synthetic_timing_plan(),'{0,clocks,confirmedAt}','"2099-01-01T18:00:00.000Z"'));
select channex_synthetic_timing_reject(jsonb_set(channex_synthetic_timing_plan(),'{0,clocks,timezone}','"UTC"'));
select channex_synthetic_timing_reject(jsonb_set(channex_synthetic_timing_plan(),'{0,guestName}','"PRIVATE"'));
do $$declare mutation text; begin
 foreach mutation in array array[
 'update properties set calendar_authority=''helm'' where id=''65_calderwood''',
 'update properties set automations_enabled=true where id=''65_calderwood''',
 'update bookings set status=''cancelled'' where id=''90000000-0000-4000-8000-000000000901''',
 'update bookings set source=''manual'' where id=''90000000-0000-4000-8000-000000000901''',
 'update bookings set check_out=check_out+1 where id=''90000000-0000-4000-8000-000000000901''',
 'update bookings set duplicate_of=id where id=''90000000-0000-4000-8000-000000000901''',
 'update bookings set channel=''direct'' where id=''90000000-0000-4000-8000-000000000901''',
 'update bookings set hold_kind=''owner'' where id=''90000000-0000-4000-8000-000000000901''',
 'update guesty_reservations set status=''cancelled''',
 'update guesty_reservations set listing_id=''bbbbbbbbbbbbbbbbbbbbbbbb''',
 'update guesty_reservations set check_out=check_out+1',
 'update guesty_reservations set channel=''Vrbo''',
 'delete from guesty_reservations',
 'insert into guesty_reservations select ''bbbbbbbbbbbbbbbbbbbbbbbb'',property_id,listing_id,status,channel,'' synthetic-timing-a '',check_in,check_out from guesty_reservations',
 'insert into bookings(id,property_id,channel,source,status,check_in,check_out,external_confirmation_code) select ''90000000-0000-4000-8000-000000000902'',property_id,channel,source,''cancelled'',check_in,check_out,'' synthetic-timing-a '' from bookings where id=''90000000-0000-4000-8000-000000000901''',
 'insert into helm_channex_messages.scope(property_id,environment,remote_property,channel_id,provider) values(''65_calderwood'',''production'',''320c5cb5-91e0-46af-b9b3-a3fc20b4631e'',gen_random_uuid(),''Airbnb'')'
 ] loop
  perform channex_synthetic_timing_setup(); execute mutation;
  perform channex_synthetic_timing_reject(channex_synthetic_timing_plan());
 end loop;
end$$;
-- A valid first row plus stale second row leaves no partial checkpoint.
select channex_synthetic_timing_setup();
insert into bookings(id,property_id,channel,source,status,check_in,check_out,external_confirmation_code)
 select '90000000-0000-4000-8000-000000000902',property_id,channel,source,status,check_in+20,check_out+20,'SYNTHETIC-TIMING-B'
 from bookings where id='90000000-0000-4000-8000-000000000901';
select channex_synthetic_timing_reject(channex_synthetic_timing_plan()||jsonb_build_array(
 jsonb_set(jsonb_set(channex_synthetic_timing_plan()->0,'{bookingId}','"90000000-0000-4000-8000-000000000902"'),'{guestyId}','"bbbbbbbbbbbbbbbbbbbbbbbb"')));
