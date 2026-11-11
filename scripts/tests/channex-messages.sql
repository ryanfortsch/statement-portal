create function public.channex_synthetic_message_setup() returns void language plpgsql as $$
declare b uuid:='90000000-0000-4000-8000-000000000001'; s uuid:='90000000-0000-4000-8000-000000000002';
 r uuid:='90000000-0000-4000-8000-000000000003'; stamp timestamptz:=clock_timestamp();
begin
 if current_database()<>'helm_synthetic_channex' then raise exception 'synthetic_only'; end if;
 delete from helm_channex_messages.hold_events; delete from helm_channex_messages.jobs;
 delete from helm_channex_messages.scope; delete from automation_sends; delete from message_automations;
 delete from helm_airbnb_bookings.bookings where canonical_id=b; delete from bookings where id=b;
 update properties set calendar_authority='helm',automations_enabled=true where id='65_calderwood';
 insert into bookings(id,property_id,channel,status,check_in,check_out,external_confirmation_code,guest_name)
 values(b,'65_calderwood','airbnb','confirmed','2035-01-01','2035-01-03','HELMTEST-SYNTHETIC','Synthetic');
 insert into message_automations(id,key,property_id,audience,trigger,body,enabled,send_mode)
 values(r,'checkin_day','65_calderwood','guest','checkin_day','Synthetic',true,'auto');
 insert into automation_sends(id,booking_id,automation_id,automation_key,property_id,fire_at,planned_check_in,planned_check_out)
 values(s,b,r,'checkin_day','65_calderwood',stamp+interval '1 hour','2035-01-01','2035-01-03');
 insert into helm_channex_messages.scope(property_id,environment,remote_property,channel_id,provider,enabled,source_stopped_at,source_drained_at,source_evidence_id)
 values('65_calderwood','production','320c5cb5-91e0-46af-b9b3-a3fc20b4631e','90000000-0000-4000-8000-000000000004','Airbnb',true,stamp-interval '2 hours',stamp-interval '1 hour',gen_random_uuid());
 insert into helm_airbnb_bookings.bookings(remote_id,canonical_id,code,environment,remote_property,generation,latest_at,latest_revision,check_in,check_out,status)
 values('90000000-0000-4000-8000-000000000005',b,'HELMTEST-SYNTHETIC','production','320c5cb5-91e0-46af-b9b3-a3fc20b4631e',1,stamp,gen_random_uuid(),'2035-01-01','2035-01-03','confirmed');
 insert into property_access values('65_calderwood','synthetic-code') on conflict(property_id) do update set smart_lock_code=excluded.smart_lock_code;
 insert into helm_channex_messages.jobs(send_id,booking_id,property_id,automation_key,route_generation,remote_booking,thread_id,body_sha256,context_revision,fire_at,expires_at,source_evidence_at,source_evidence_id)
 select s,b,'65_calderwood','checkin_day',generation,'90000000-0000-4000-8000-000000000005','90000000-0000-4000-8000-000000000006',repeat('a',64),helm_channex_messages.context(s),stamp+interval '1 hour',stamp+interval '2 hours',stamp,gen_random_uuid()
 from helm_channex_messages.scope;
 -- Advance only synthetic fixture timestamps; production has no backdating RPC.
 update automation_sends set fire_at=stamp-interval '1 minute' where id=s;
 update helm_channex_messages.jobs set fire_at=stamp-interval '1 minute',prepared_at=stamp-interval '2 minutes',
 source_evidence_at=stamp-interval '3 minutes',expires_at=stamp+interval '1 hour' where send_id=s;
end$$;
create function public.channex_synthetic_message_attempt() returns jsonb language sql as $$
 select public.helm_channex_message_read('90000000-0000-4000-8000-000000000002')
 -array['sendId','contextRevision','state','attemptId','providerMessageId'];
$$;
create function pg_temp.assert_message(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAILED: %',label; end if; end$$;
select channex_synthetic_message_setup();
select pg_temp.assert_message(not has_schema_privilege('service_role','helm_channex_messages','usage'),'private schema inaccessible');
select pg_temp.assert_message(not has_function_privilege('anon','helm_channex_message_claim(uuid,uuid,jsonb)','execute')
 and not has_function_privilege('authenticated','helm_channex_message_read(uuid)','execute')
 and not has_function_privilege('authenticated','helm_channex_message_set_hold(uuid,bigint,boolean,text)','execute'),'client execution denied');
select pg_temp.assert_message(has_function_privilege('service_role','helm_channex_message_claim(uuid,uuid,jsonb)','execute'),'service can claim');
select pg_temp.assert_message(not has_table_privilege('service_role','helm_channex_messages.jobs','insert,update,delete'),'no job write grants');
-- Legacy batch claim skips reserved jobs without aborting other rows.
update automation_sends set status='sending' where status='scheduled';
select pg_temp.assert_message((select status='scheduled' from automation_sends),'legacy claim blocked');
insert into automation_sends(id,booking_id,automation_key,property_id,fire_at,planned_check_in,planned_check_out)
values(gen_random_uuid(),'90000000-0000-4000-8000-000000000001','checkin_day','65_calderwood',clock_timestamp(),'2035-01-01','2035-01-03');
select pg_temp.assert_message((select count(*)=1 from automation_sends),'replacement rule cannot create another send');
insert into automation_sends(id,booking_id,automation_key,property_id,fire_at,planned_check_in,planned_check_out)
values(gen_random_uuid(),'90000000-0000-4000-8000-000000000001','cleaner_new_booking','65_calderwood',clock_timestamp(),'2035-01-01','2035-01-03');
update automation_sends set status='sending' where status='scheduled';
select pg_temp.assert_message((select count(*)=1 from automation_sends where status='sending'),'unreserved sends in same batch still claim');
-- No activation, changed source identity, hold, future/expired time, or stale input.
do $$declare a jsonb; token uuid:=gen_random_uuid(); s uuid:='90000000-0000-4000-8000-000000000002'; change_sql text; begin
 foreach change_sql in array array[
  'update helm_channex_messages.scope set enabled=false',
  'update helm_channex_messages.scope set generation=gen_random_uuid()',
  'update helm_channex_messages.scope set source_drained_at=clock_timestamp()',
  'update helm_channex_messages.jobs set held=true',
  'update helm_channex_messages.jobs set context_revision=repeat(''0'',32)',
  'update helm_channex_messages.jobs set expires_at=clock_timestamp()-interval ''1 second''',
  'update automation_sends set fire_at=clock_timestamp()+interval ''1 hour''',
  'update bookings set status=''cancelled'' where id=''90000000-0000-4000-8000-000000000001''',
  'update bookings set check_out=''2035-01-04'' where id=''90000000-0000-4000-8000-000000000001''',
  'update bookings set duplicate_of=gen_random_uuid() where id=''90000000-0000-4000-8000-000000000001''',
  'update properties set calendar_authority=''guesty'' where id=''65_calderwood''',
  'update properties set automations_enabled=false where id=''65_calderwood''',
  'update message_automations set enabled=false',
  'update message_automations set configured_in_ota=true',
  'update message_automations set body=''Changed synthetic template''',
  'update message_automations set audience=''cleaner''',
  'update property_access set smart_lock_code=''changed-synthetic''',
  'insert into guest_access_codes values(gen_random_uuid(),''90000000-0000-4000-8000-000000000001'',''new-synthetic'')',
  'update helm_airbnb_bookings.bookings set remote_property=gen_random_uuid() where canonical_id=''90000000-0000-4000-8000-000000000001'''
 ] loop
  perform channex_synthetic_message_setup(); a:=channex_synthetic_message_attempt(); execute change_sql;
  perform pg_temp.assert_message(not helm_channex_message_claim(s,token,a),'changed dependency or gate blocks send');
 end loop;
end$$;
-- Registration cannot adopt a send that already has a delivery receipt.
select channex_synthetic_message_setup();
do $$declare snapshot helm_channex_messages.jobs; begin
 select * into snapshot from helm_channex_messages.jobs;
 delete from helm_channex_messages.jobs;
 update automation_sends set provider_message_id='synthetic-existing-receipt',fire_at=clock_timestamp()+interval '1 hour';
 select fire_at into snapshot.fire_at from automation_sends;
 snapshot.expires_at:=snapshot.fire_at+interval '1 hour';
 begin
  insert into helm_channex_messages.jobs select (snapshot).*;
  raise exception 'FAILED: historical delivery was adopted';
 exception when raise_exception then
  if sqlerrm<>'message_registration_mismatch' then raise; end if;
 end;
end$$;
select channex_synthetic_message_setup();
do $$declare s uuid:='90000000-0000-4000-8000-000000000002'; token uuid:=gen_random_uuid(); pid uuid:=gen_random_uuid(); a jsonb:=channex_synthetic_message_attempt(); begin
 perform pg_temp.assert_message(not helm_channex_message_claim(s,token,a||'{"extra":"not allowed"}'),'extra attempt fields blocked');
 perform pg_temp.assert_message(helm_channex_message_claim(s,token,a),'first claim allowed');
 perform pg_temp.assert_message(not helm_channex_message_claim(s,token,a),'same claim cannot replay');
 perform pg_temp.assert_message(not helm_channex_message_claim(s,gen_random_uuid(),a),'new attempt cannot reclaim');
 perform pg_temp.assert_message(not helm_channex_message_set_hold(s,2,true,'synthetic'),'cannot recall inflight');
 perform pg_temp.assert_message(not helm_channex_message_finish(s,gen_random_uuid(),'accepted',pid),'wrong attempt refused');
 perform pg_temp.assert_message(not helm_channex_message_finish(s,token,'recorded',pid),'no invented acceptance');
 perform pg_temp.assert_message(helm_channex_message_finish(s,token,'accepted',pid),'acceptance saved');
 perform pg_temp.assert_message(helm_channex_message_finish(s,token,'accepted',pid),'identical receipt idempotent');
 perform pg_temp.assert_message(not helm_channex_message_finish(s,token,'unknown'),'no downgrade');
 perform pg_temp.assert_message(not helm_channex_message_finish(s,token,'recorded',gen_random_uuid()),'mismatched receipt refused');
 perform pg_temp.assert_message(helm_channex_message_finish(s,token,'recorded',pid),'exact readback saved');
end$$;
select channex_synthetic_message_setup();
do $$declare s uuid:='90000000-0000-4000-8000-000000000002'; token uuid:=gen_random_uuid(); begin
 perform pg_temp.assert_message(helm_channex_message_claim(s,token,channex_synthetic_message_attempt()),'claim before later cancellation');
 update automation_sends set status='cancelled' where id=s;
 perform pg_temp.assert_message(helm_channex_message_finish(s,token,'accepted',gen_random_uuid()),'receipt after cancellation preserved');
 perform pg_temp.assert_message((select status='cancelled' from automation_sends where id=s),'receipt does not revive schedule');
end$$;
select channex_synthetic_message_setup();
do $$declare s uuid:='90000000-0000-4000-8000-000000000002'; begin
 perform pg_temp.assert_message(helm_channex_message_set_hold(s,1,true,'synthetic'),'hold set');
 perform pg_temp.assert_message(not helm_channex_message_set_hold(s,1,false,'synthetic'),'stale hold release refused');
 perform pg_temp.assert_message(not helm_channex_message_claim(s,gen_random_uuid(),channex_synthetic_message_attempt()),'held job blocked');
 perform pg_temp.assert_message(helm_channex_message_set_hold(s,2,false,'synthetic'),'release preserves due time');
 perform pg_temp.assert_message((select count(*)=2 from helm_channex_messages.hold_events),'holds audited');
end$$;
