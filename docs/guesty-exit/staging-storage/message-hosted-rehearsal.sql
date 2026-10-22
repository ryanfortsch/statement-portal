-- Embedded by build-message-pilot-install.mjs AFTER all six components.
-- Every fictional row and inventory-trigger effect is rolled back together.
-- The outer installer persists only empty support tables and an aggregate receipt.
do $rehearsal$
declare
 p constant text:='HELMTEST-calderwood';
 b uuid:=gen_random_uuid(); gen uuid:=gen_random_uuid(); obs uuid; canon text;
 ci date:=(clock_timestamp() at time zone 'America/New_York')::date+30; co date;
 observed timestamptz:=clock_timestamp()-interval '1 minute'; stopped timestamptz:=clock_timestamp()-interval '3 minutes';
 drained timestamptz:=clock_timestamp()-interval '2 minutes'; confirmed timestamptz:=clock_timestamp()-interval '2 hours';
 row_send record; rel record; doc jsonb; before_rows jsonb:='{}'; after_rows jsonb:='{}';
 entries jsonb:='[]'; bad jsonb; review jsonb; result jsonb; report jsonb;
 role_name text; denied boolean; last_error text;
begin
 co:=ci+3;
 -- Include the existing canonical ledger, queue/journal, source receipts and
 -- private cleaner rehearsal. Compare contents without returning record bodies.
 for rel in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','helm_channex_revisions','helm_cleaner_rehearsal','helm_pilot_installation') and c.relkind='r' order by 1,2 loop
  execute format('select to_jsonb(md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]''))) from %I.%I t',rel.nspname,rel.relname) into doc;
  before_rows:=before_rows||jsonb_build_object(rel.nspname||'.'||rel.relname,doc);
 end loop;
 begin
  insert into public.bookings(id,property_id,channel,source,status,check_in,check_out,guest_name)
   values(b,p,'airbnb','manual','confirmed',ci,co,'HELMTEST Fictional guest');
  insert into public.automation_channex_routes(property_id,environment,channex_property_id,channel_id,provider,generation,enabled,source_stopped_at,source_drained_at)
   values(p,'staging',gen_random_uuid(),gen_random_uuid(),'Airbnb',gen,false,stopped,drained);
  for row_send in select * from (values
   ('confirmation','booking_confirmed','guest',confirmed+interval '30 minutes'),
   ('pre_arrival','pre_arrival','guest',((ci-1)+time '16:00') at time zone 'America/New_York'),
   ('key_code','checkin_day','guest',(ci+time '16:00') at time zone 'America/New_York'-interval '1 hour'),
   ('pre_checkout','pre_checkout','guest',((co-1)+time '11:00') at time zone 'America/New_York'),
   ('cleaner_advance','pre_arrival','cleaner',((ci-10)+time '16:00') at time zone 'America/New_York'),
   ('cleaner_arrival','checkin_day','cleaner',(ci+time '16:00') at time zone 'America/New_York'-interval '7 hours')
  ) f(flow,trigger,audience,fire_at) loop
   insert into public.message_automations(key,property_id,trigger,audience,body,send_mode,enabled)
    values('HELMTEST-six-'||row_send.flow,p,row_send.trigger,row_send.audience,'HELMTEST fictional reminder','auto',false);
   insert into public.automation_sends(booking_id,property_id,automation_id,automation_key,status,fire_at,planned_check_in,planned_check_out)
    select b,p,id,key,case when row_send.flow='key_code' then 'held' else 'scheduled' end,row_send.fire_at,ci,co
    from public.message_automations where property_id=p and key='HELMTEST-six-'||row_send.flow;
  end loop;
  canon:=public.automation_message_stay_revision(b);
  obs:=public.automation_message_observe_times(b,canon,null,jsonb_build_object('check_in',ci,'check_out',co,
   'arrival_time','16:00','departure_time','11:00','confirmed_at',confirmed,'observed_at',observed-interval '3 minutes',
   'source_revision','HELMTEST-timing','evidence_id','HELMTEST-timing-evidence'));
  perform public.automation_message_bind_thread(b,jsonb_build_object('channex_booking_id',gen_random_uuid(),'thread_id',gen_random_uuid(),
   'canonical_revision',canon,'route_generation',gen,'verified_at',observed,'evidence_id','HELMTEST-thread'));
  for row_send in select s.*,replace(s.automation_key,'HELMTEST-six-','') flow from public.automation_sends s where booking_id=b order by id loop
   review:=jsonb_build_object('review_id',gen_random_uuid(),'context_revision',public.automation_channex_context(row_send.id),
    'observation_revision',obs,'complete',true,'sent',row_send.flow='confirmation','queued',false,'uncertain',false,
    'evidence_id','HELMTEST-source-review','observed_at',observed,'workflow',row_send.flow);
   if row_send.flow='confirmation' then
    review:=review||jsonb_build_object('source_account_id','HELMTEST-account','source_reservation_id','HELMTEST-'||b,
     'recipient_refs',jsonb_build_array('guest'),'messages',jsonb_build_array(jsonb_build_object('id','HELMTEST-confirmation','recipient_ref','guest','sent_at',confirmed+interval '30 minutes')));
   else
    review:=review||jsonb_build_object('stopped_at',stopped,'drained_at',drained,'expires_at',row_send.fire_at+interval '1 day');
    -- On the once-a-year boundary, prove the exact queued calendar-clock time.
    if exists(select 1 from public.automation_message_schedule_candidates(row_send.id,row_send.flow) c where c.calendar_at is distinct from c.elapsed_at) then
     review:=review||jsonb_build_object('source_schedule',jsonb_build_object('scheduled_at',row_send.fire_at,
      'observed_at',stopped-interval '30 seconds','evidence_id','HELMTEST-exact-source-schedule'));
    end if;
    if row_send.flow like 'cleaner_%' then review:=review||jsonb_build_object('from_number','+12025550140','recipient_phones',jsonb_build_array('+12025550141','+12025550142')); end if;
   end if;
   entries:=entries||jsonb_build_array(jsonb_build_object('send_id',row_send.id,'review',review));
  end loop;
  -- Last entry rejects AFTER earlier writes, proving whole-stay atomicity.
  bad:=jsonb_set(entries,array['5','review','uncertain'],'true');denied:=false;
  begin perform public.automation_message_handoff_stay(b,canon,bad);
  exception when others then denied:=true;last_error:=sqlerrm;end;
  if not denied or (last_error not like '%handoff required%' and last_error not like '%history required%') then
   raise exception 'Expected late invalid-review rejection, got %',last_error;end if;
  if exists(select 1 from public.automation_message_handoffs) or exists(select 1 from public.automation_message_source_history)
   or exists(select 1 from public.automation_sends where booking_id=b and delivery_used is not null) then raise exception 'Partial handoff survived rejection';end if;
  result:=public.automation_message_handoff_stay(b,canon,entries);
  if result is distinct from public.automation_message_handoff_stay(b,canon,entries) then raise exception 'Replay result changed';end if;
  if jsonb_array_length(result)<>6 or (select count(*) from jsonb_array_elements(result) x where x->>'result'='source_sent')<>1
   or (select count(*) from public.automation_channex_jobs)<>3 or (select count(*) from public.automation_cleaner_batches)<>2
   or (select count(*) from public.automation_cleaner_jobs)<>4 or (select count(*) from public.automation_message_source_receipts)<>1
   or not exists(select 1 from public.automation_sends where booking_id=b and automation_key='HELMTEST-six-key_code' and status='held')
   or exists(select 1 from public.automation_channex_routes where enabled)
   or exists(select 1 from public.automation_cleaner_batches where enabled)
   or exists(select 1 from public.message_automations where enabled) then raise exception 'Six-message handoff invariant failed';end if;
  if exists(select 1 from public.automation_channex_jobs j where coalesce(public.automation_channex_snapshot(j.send_id)->'input','null'::jsonb)='null'::jsonb)
   or exists(select 1 from public.automation_cleaner_jobs j where coalesce(public.automation_cleaner_snapshot(j.id)->'input','null'::jsonb)='null'::jsonb)
   then raise exception 'Canonical render input missing';end if;
  denied:=false;
  begin update public.automation_sends set status='scheduled' where booking_id=b and delivery_used='guesty_history';
  exception when others then denied:=sqlerrm like '%cannot be replayed%';end;
  if not denied then raise exception 'Source history replay was not rejected';end if;
  -- Registration is owner-only, even with the existing execution service role.
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_function_privilege(role_name,'public.automation_message_handoff_stay(uuid,text,jsonb)','EXECUTE')
    or has_table_privilege(role_name,'public.automation_message_source_receipts','SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'Source evidence exposed to %',role_name;end if;
  end loop;
  report:=jsonb_build_object('workflows',6,'already_sent_imported',1,'future_guest_jobs',3,'future_cleaner_batches',2,
   'fictional_cleaner_recipient_jobs',4,'key_code_held',true,'repeat_is_idempotent',true,'late_failure_atomic',true,
   'source_history_replay_blocked',true,'owner_only_handoff',true,'enabled_senders',0,'provider_calls',0,'fixture_rolled_back',true);
  raise exception using errcode='ZX001',message='Rollback successful fictional rehearsal';
 exception when sqlstate 'ZX001' then null;end;
 for rel in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','helm_channex_revisions','helm_cleaner_rehearsal','helm_pilot_installation') and c.relkind='r' order by 1,2 loop
  execute format('select to_jsonb(md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]''))) from %I.%I t',rel.nspname,rel.relname) into doc;
  after_rows:=after_rows||jsonb_build_object(rel.nspname||'.'||rel.relname,doc);
 end loop;
 if after_rows is distinct from before_rows then raise exception 'Rehearsal changed persistent data';end if;
 insert into helm_message_rehearsal_result values(report||jsonb_build_object('existing_rows_preserved',true));
end $rehearsal$;
