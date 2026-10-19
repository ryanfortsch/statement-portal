-- OWNER-EXECUTED ISOLATED DATABASE REHEARSAL ONLY.
-- Project jgkblfozftcvymvwhhii; verify the dashboard destination before Run.
-- These are constructed revisions, NOT evidence of Channex HTTP/webhook delivery.
-- No real property, recipient, credential, provider call or enabled sender.
-- Atomic and repeatable: all fixture writes roll back if any assertion fails.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtext('helm-canonical-hosted-rehearsal-v1'));
do $$
declare
  p constant text := 'HELMTEST-calderwood';
  remote constant uuid := 'c7c43363-2ecb-462d-9d6a-fcf080279936';
  rev jsonb; receipt jsonb; booking uuid; version_before bigint; audit_before bigint;
  cleaner_before text; cleaner_after text;
begin
  if not exists(select 1 from helm_pilot_installation.manifest where project_ref='jgkblfozftcvymvwhhii'
    and bundle_digest='79762c13691b7285d76bcac51f4c45e30a41f29f6fd90e1bc02812fb324fa441') then
    raise exception 'Reviewed isolated installation receipt required'; end if;
  -- No takeover of any existing application property or sender.
  if exists(select 1 from properties where id<>p)
    or exists(select 1 from properties where automations_enabled)
    or exists(select 1 from message_automations where enabled)
    or exists(select 1 from channel_listings)
    or exists(select 1 from guests) then raise exception 'Empty fictional-only pilot required'; end if;
  if exists(select 1 from helm_channex_revisions.receipts where revision_id='a754fbdb-fd16-4351-af34-000000000004') then
    if (select count(*) from helm_channex_revisions.receipts where revision->>'bookingId'=remote::text) <> 4
      or not exists(select 1 from bookings where property_id=p and source_ref='channex-staging:'||remote and status='cancelled')
      or (select count(*) from automation_sends where property_id=p and automation_key like 'HELMTEST-db-rehearsal-%' and status='cancelled')<>6 then
      raise exception 'Existing rehearsal result differs; inspect instead of replaying'; end if;
    return;
  end if;
  if exists(select 1 from properties) or exists(select 1 from bookings)
    or exists(select 1 from helm_channex_revisions.scope) or exists(select 1 from helm_channex_revisions.receipts) then
    raise exception 'Partial or unrelated rehearsal exists; inspect instead of reseeding'; end if;
  select md5(coalesce(jsonb_agg(to_jsonb(d) order by to_jsonb(d)::text)::text,'')) into cleaner_before from helm_cleaner_rehearsal.delivery d;
  insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct,calendar_authority,automations_enabled)
    values(p,'Fictional Calderwood rehearsal','Fictional','Fictional','Fixture','Fixture','Fixture',0,'helm',false);
  insert into helm_inventory_capture_scopes(property_id,enabled) values(p,true);
  insert into helm_channex_revisions.scope(property_id,enabled) values(p,true);
  rev := jsonb_build_object('id','a754fbdb-fd16-4351-af34-000000000001','bookingId',remote,
    'propertyId','30584a9a-8784-4eb1-a387-e26bd43aec1c','roomTypeId','f795ae2c-f47d-4751-86ff-e883b6d30800',
    'ratePlanId','7f95b731-ff05-4c41-99c9-f39b3e772fec','code','HELMTEST-hosted-database-v1',
    'status','new','checkIn','2027-02-01','checkOut','2027-02-04','receivedAt','2026-10-19T19:00:01.000001Z');
  receipt := helm_pilot_revision_commit(rev); booking := (receipt->>'canonicalBookingId')::uuid;
  if helm_pilot_revision_receipt((rev->>'id')::uuid) is distinct from receipt
    or not exists(select 1 from bookings where id=booking and status='confirmed' and check_in='2027-02-01') then raise exception 'Create/read-back failed'; end if;
  select version into version_before from helm_inventory_capture_scopes where property_id=p;
  select count(*) into audit_before from booking_events where booking_id=booking;
  if helm_pilot_revision_commit(rev) is distinct from receipt
    or (select version from helm_inventory_capture_scopes where property_id=p)<>version_before
    or (select count(*) from booking_events where booking_id=booking)<>audit_before then raise exception 'Replay duplicated a write'; end if;
  rev := rev || jsonb_build_object('id','a754fbdb-fd16-4351-af34-000000000002','status','modified',
    'checkIn','2027-02-05','checkOut','2027-02-08','receivedAt','2026-10-19T19:00:02.000001Z');
  receipt := helm_pilot_revision_commit(rev);
  if (receipt->>'canonicalBookingId')::uuid<>booking
    or not exists(select 1 from bookings where id=booking and check_in='2027-02-05' and check_out='2027-02-08')
    or (select version from helm_inventory_capture_scopes where property_id=p)<>version_before+1 then raise exception 'Date change failed'; end if;
  -- Waiting ledger rows ONLY: no templates, contacts, rendered bodies or dispatch.
  -- This exercises cancellation, not message planning/timing or real delivery.
  insert into automation_sends(booking_id,property_id,automation_key,fire_at,status,planned_check_in,planned_check_out)
    select booking,p,'HELMTEST-db-rehearsal-'||n,'2027-02-05T20:00:00Z',
      case when n=6 then 'awaiting_approval' else 'scheduled' end,'2027-02-05','2027-02-08' from generate_series(1,6) n;
  rev := rev || jsonb_build_object('id','a754fbdb-fd16-4351-af34-000000000003','status','cancelled','receivedAt','2026-10-19T19:00:03.000001Z');
  perform helm_pilot_revision_commit(rev);
  if not exists(select 1 from bookings where id=booking and status='cancelled')
    or (select count(*) from automation_sends where booking_id=booking and status='cancelled' and error='stay cancelled')<>6 then raise exception 'Cancellation failed to stop waiting messages'; end if;
  select version into version_before from helm_inventory_capture_scopes where property_id=p;
  rev := rev || jsonb_build_object('id','a754fbdb-fd16-4351-af34-000000000004','status','modified','receivedAt','2026-10-19T19:00:02.000002Z');
  receipt := helm_pilot_revision_commit(rev);
  if receipt->>'outcome'<>'stale' or not exists(select 1 from bookings where id=booking and status='cancelled')
    or (select version from helm_inventory_capture_scopes where property_id=p)<>version_before then raise exception 'Old revision resurrected a cancellation'; end if;
  if (select count(*) from booking_events where booking_id=booking)<>3
    or (select count(*) from helm_booking_inventory_events where property_id=p)<>4
    or (select count(*) from helm_channex_revisions.receipts)<>4 then raise exception 'Unexpected audit/receipt/capture count'; end if;
  select md5(coalesce(jsonb_agg(to_jsonb(d) order by to_jsonb(d)::text)::text,'')) into cleaner_after from helm_cleaner_rehearsal.delivery d;
  if cleaner_after is distinct from cleaner_before then raise exception 'Existing cleaner rehearsal changed'; end if;
end $$;
commit;
select 'Fictional database cycle' as check_name,
  (select status::text from bookings where source_ref='channex-staging:c7c43363-2ecb-462d-9d6a-fcf080279936') as final_booking_status,
  (select count(*) from helm_channex_revisions.receipts where revision->>'bookingId'='c7c43363-2ecb-462d-9d6a-fcf080279936') as durable_receipts,
  (select count(*) from automation_sends where automation_key like 'HELMTEST-db-rehearsal-%' and status='cancelled') as cancelled_test_messages,
  (select count(*) from message_automations where enabled) as enabled_senders;
