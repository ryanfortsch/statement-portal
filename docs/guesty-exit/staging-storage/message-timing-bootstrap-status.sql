-- Read-only independent verification, isolated project jgkblfozftcvymvwhhii.
begin read only;
select label as "Verification", result as "Result" from (values
 (1,'Combined timing rehearsal',case when exists(select 1 from helm_pilot_installation.message_timing_bootstrap
  where project_ref='jgkblfozftcvymvwhhii' and bundle_digest='6997c2373188a3907796725404b1492e24066c987a184afccb7aa202da493eff'
  and summary @> '{"atomic_bootstrap":true,"failed_registration_rolled_back":true,"bootstrap_replay_is_idempotent":true,"mapped_create_move_cancel":true,"reviewed_clocks_preserved":true,"confirmation_preserved":true,"service_refresh_verified":true,"fixture_rolled_back":true,"existing_rows_preserved":true,"provider_calls":0,"message_jobs_created":0}') then 'PASS' else 'FAIL' end),
 (2,'Enabled timing policies',(select count(*)::text from helm_channex_revisions.message_timing_policies where enabled)),
 (3,'Retained timing policies / history',(select count(*)::text from helm_channex_revisions.message_timing_policies)||' / '||(select count(*)::text from automation_message_observation_history)),
 (4,'Bookings / message ledger / provider receipts',(select count(*)::text from bookings)||' / '||(select count(*)::text from automation_sends)||' / '||(select count(*)::text from helm_channex_revisions.receipts)),
 (5,'Enabled message controls',((select count(*) from properties where automations_enabled)+(select count(*) from message_automations where enabled)+(select count(*) from automation_channex_routes where enabled)+(select count(*) from automation_cleaner_batches where enabled))::text),
 (6,'Connected channels',(select count(*)::text from channel_listings)),
 (7,'Inventory publishing',(select configuration->>'publishEnabled' from helm_booking_inventory_consumers where property_id='HELMTEST-calderwood')),
 (8,'Bootstrap execution',case when not exists(select 1 from unnest(array['anon','authenticated','service_role']) role_name
  where has_function_privilege(role_name,'public.helm_pilot_message_times_bootstrap(uuid,uuid,text,uuid,jsonb,text,bigint,timestamptz,boolean)','EXECUTE')) then 'Owner only' else 'FAIL' end),
 (9,'Private installation receipt',case when (select relrowsecurity from pg_class where oid='helm_pilot_installation.message_timing_bootstrap'::regclass)
  and not exists(select 1 from unnest(array['anon','authenticated','service_role']) role_name where has_table_privilege(role_name,'helm_pilot_installation.message_timing_bootstrap','SELECT,INSERT,UPDATE,DELETE')) then 'PASS' else 'FAIL' end),
 (10,'Bundle',(select bundle_digest from helm_pilot_installation.message_timing_bootstrap)),
 (11,'Installed UTC',(select installed_at at time zone 'UTC' from helm_pilot_installation.message_timing_bootstrap)::text),
 (12,'Verified UTC',(clock_timestamp() at time zone 'UTC')::text)
) t(position,label,result) order by position;
commit;
