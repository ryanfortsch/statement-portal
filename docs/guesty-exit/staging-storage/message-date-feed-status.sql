-- Independent read-only verification after the isolated upgrade commits.
begin transaction read only;
select check_name as "Staging date-feed verification", result as "Result" from (values
 (1,'Rehearsal',case when exists(select 1 from helm_pilot_installation.message_date_feed
  where project_ref='jgkblfozftcvymvwhhii' and summary @> '{"mapped_create_move_cancel":true,"reviewed_clocks_preserved":true,"confirmation_preserved":true,"service_refresh_verified":true,"repeat_is_idempotent":true,"unproven_dates_blocked":true,"cancellation_inactive":true,"fixture_rolled_back":true,"existing_rows_preserved":true,"provider_calls":0,"message_jobs_created":0}') then 'PASS' else 'FAIL' end),
 (2,'Retained timing policies',(select count(*)::text from helm_channex_revisions.message_timing_policies)),
 (3,'Retained timing observations',(select count(*)::text from automation_message_observations)),
 (4,'Retained bookings / message ledger / provider receipts',(select count(*) from bookings)||' / '||(select count(*) from automation_sends)||' / '||(select count(*) from helm_channex_revisions.receipts)),
 (5,'Enabled message controls',((select count(*) from properties where automations_enabled)+(select count(*) from message_automations where enabled)+(select count(*) from automation_channex_routes where enabled)+(select count(*) from automation_cleaner_batches where enabled))::text),
 (6,'Connected channels',(select count(*)::text from channel_listings)),
 (7,'Inventory publishing',(select configuration->>'publishEnabled' from helm_booking_inventory_consumers where property_id='HELMTEST-calderwood')),
 (8,'Timing registration / direct table access',case when not exists(select 1 from unnest(array['anon','authenticated','service_role']) role_name
  where has_function_privilege(role_name,'public.helm_pilot_message_times_register(uuid,uuid,text,bigint,text,timestamptz,boolean)','EXECUTE')
   or has_table_privilege(role_name,'helm_channex_revisions.message_timing_policies','SELECT,INSERT,UPDATE,DELETE')
   or has_table_privilege(role_name,'helm_pilot_installation.message_date_feed','SELECT,INSERT,UPDATE,DELETE')) then 'Owner only' else 'FAIL' end),
 (9,'Refresh execution',case when not has_function_privilege('anon','public.helm_pilot_message_times_refresh(text,bigint,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.helm_pilot_message_times_refresh(text,bigint,integer)','EXECUTE')
  and has_function_privilege('service_role','public.helm_pilot_message_times_refresh(text,bigint,integer)','EXECUTE') then 'Existing service role only' else 'FAIL' end),
 (10,'Bundle SHA-256',(select bundle_digest from helm_pilot_installation.message_date_feed)),
 (11,'Installed UTC',(select (installed_at at time zone 'UTC')::text from helm_pilot_installation.message_date_feed)),
 (12,'Verified UTC',(clock_timestamp() at time zone 'UTC')::text)
) checks(position,check_name,result) order by position;
commit;
