-- Embedded in the guarded installer. Actual mapped canonical CRUD with entirely
-- constructed revisions. All fixture data and trigger effects roll back together.
do $rehearsal$
declare
 remote uuid:=gen_random_uuid(); booking uuid; obs uuid; moved_obs uuid;
 ci date; rev jsonb; receipt jsonb; result jsonb; report jsonb; rel record; doc jsonb;
 before_rows jsonb:='{}'; after_rows jsonb:='{}';
 confirmed timestamptz:=statement_timestamp()-interval '2 days';
begin
 for rel in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','helm_channex_revisions','helm_cleaner_rehearsal','helm_pilot_installation','helm_inventory_history') and c.relkind='r' order by 1,2 loop
  execute format('select to_jsonb(md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]''))) from %I.%I t',rel.nspname,rel.relname) into doc;
  before_rows:=before_rows||jsonb_build_object(rel.nspname||'.'||rel.relname,doc);
 end loop;
 begin
  select greatest(current_date+30,coalesce(max(check_out)+30,current_date+30)) into ci from public.bookings;
  rev:=jsonb_build_object('id',gen_random_uuid(),'bookingId',remote,
   'propertyId','30584a9a-8784-4eb1-a387-e26bd43aec1c','roomTypeId','f795ae2c-f47d-4751-86ff-e883b6d30800',
   'ratePlanId','7f95b731-ff05-4c41-99c9-f39b3e772fec','code','HELMTEST-date-feed-'||remote,
   'status','new','checkIn',ci,'checkOut',ci+3,
   'receivedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  receipt:=public.helm_pilot_revision_observe_mapped(rev,'calderwood-hosted-inventory',1);
  booking:=(receipt->>'canonicalBookingId')::uuid;
  if booking is null or receipt->>'outcome' is distinct from 'applied' then raise exception 'Mapped create failed'; end if;
  obs:=public.automation_message_observe_times(booking,public.automation_message_stay_revision(booking),null,
   jsonb_build_object('check_in',ci,'check_out',ci+3,'arrival_time','16:00','departure_time','11:00',
    'confirmed_at',confirmed,'observed_at',statement_timestamp()-interval '1 second',
    'source_revision','HELMTEST-clock-review','evidence_id','HELMTEST-clock-review'));
  perform public.helm_pilot_message_times_register(booking,obs,'calderwood-hosted-inventory',1,
   'HELMTEST-clock-policy',statement_timestamp()+interval '60 days',true);
  result:=public.helm_pilot_message_times_refresh('calderwood-hosted-inventory',1,100);
  if result is distinct from '{"scanned":1,"refreshed":0,"unchanged":1,"blocked":0,"inactive":0,"canSend":false}'::jsonb then raise exception 'Steady state changed'; end if;
  -- The mapped importer performs canonical CRUD and invalidates the old clock
  -- observation. Refresh must consume its durable receipt, not fabricate one.
  rev:=rev||jsonb_build_object('id',gen_random_uuid(),'status','modified','checkIn',ci+5,'checkOut',ci+8,
   'receivedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  receipt:=public.helm_pilot_revision_observe_mapped(rev,'calderwood-hosted-inventory',1);
  if receipt->>'outcome' is distinct from 'applied'
   or not (select invalidated from public.automation_message_observations where booking_id=booking)
  then raise exception 'Mapped date move did not invalidate provenance'; end if;
  -- Exercise the runtime role on the same RPC used by the application.
  set local role service_role;
  result:=public.helm_pilot_message_times_refresh('calderwood-hosted-inventory',1,100);
  reset role;
  if result is distinct from '{"scanned":1,"refreshed":1,"unchanged":0,"blocked":0,"inactive":0,"canSend":false}'::jsonb
   or not exists(select 1 from public.automation_channex_stay_times where booking_id=booking
    and check_in=ci+5 and check_out=ci+8 and arrival_time=time '16:00' and departure_time=time '11:00' and confirmed_at=confirmed)
  then raise exception 'Moved dates or reviewed clocks differ'; end if;
  select revision into moved_obs from public.automation_message_observations where booking_id=booking;
  if moved_obs=obs or not exists(select 1 from public.automation_message_observations where booking_id=booking
    and not invalidated and source_revision='channex-date:'||(rev->>'id'))
  then raise exception 'Provider provenance not advanced'; end if;
  result:=public.helm_pilot_message_times_refresh('calderwood-hosted-inventory',1,100);
  if result->>'unchanged'<>'1' or (select count(*) from public.automation_message_observation_history where booking_id=booking)<>2
  then raise exception 'Refresh replay duplicated observation'; end if;
  -- Direct edits without a durable provider receipt cannot refresh the clocks.
  update public.bookings set check_in=check_in+1,check_out=check_out+1 where id=booking;
  result:=public.helm_pilot_message_times_refresh('calderwood-hosted-inventory',1,100);
  if result->>'blocked'<>'1' or (select revision from public.automation_message_observations where booking_id=booking)<>moved_obs
  then raise exception 'Unproven dates advanced clocks'; end if;
  rev:=rev||jsonb_build_object('id',gen_random_uuid(),'status','cancelled',
   'receivedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  receipt:=public.helm_pilot_revision_observe_mapped(rev,'calderwood-hosted-inventory',1);
  result:=public.helm_pilot_message_times_refresh('calderwood-hosted-inventory',1,100);
  if receipt->>'outcome' is distinct from 'applied' or result->>'inactive'<>'1'
   or not exists(select 1 from public.bookings where id=booking and status='cancelled')
   or (select count(*) from public.automation_message_observation_history where booking_id=booking)<>2
   or exists(select 1 from public.automation_sends where booking_id=booking)
  then raise exception 'Cancellation/no-send invariant failed'; end if;
  report:=jsonb_build_object('mapped_create_move_cancel',true,'reviewed_clocks_preserved',true,
   'confirmation_preserved',true,'service_refresh_verified',true,'repeat_is_idempotent',true,
   'unproven_dates_blocked',true,'cancellation_inactive',true,'provider_calls',0,
   'message_jobs_created',0,'fixture_rolled_back',true);
  raise exception using errcode='ZX002',message='Rollback successful date-feed fixture';
 exception when sqlstate 'ZX002' then null; end;
 for rel in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','helm_channex_revisions','helm_cleaner_rehearsal','helm_pilot_installation','helm_inventory_history') and c.relkind='r' order by 1,2 loop
  execute format('select to_jsonb(md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]''))) from %I.%I t',rel.nspname,rel.relname) into doc;
  after_rows:=after_rows||jsonb_build_object(rel.nspname||'.'||rel.relname,doc);
 end loop;
 if after_rows is distinct from before_rows then raise exception 'Date-feed rehearsal changed persistent data'; end if;
 insert into helm_date_feed_result values(report||jsonb_build_object('existing_rows_preserved',true));
end $rehearsal$;
