-- Candidate, unapplied. After message-date-feed.sql in isolated staging only.
-- Owner-reviewed capture + exact source/canonical binding; no automatic new-OTA
-- confirmation inference. One transaction joins the existing observation and
-- date-feed registration. A registration conflict rolls back the observation.
begin;
create function public.helm_pilot_message_times_bootstrap(p_booking_id uuid,p_remote_id uuid,
 p_canonical_revision text,p_expected_revision uuid,p_observation jsonb,
 p_connection text,p_generation bigint,p_expires_at timestamptz,p_enabled boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare observation uuid; policy uuid;
begin
 -- Same lock order as the date-feed worker: route first, then booking. This
 -- serializes bootstrap with incoming revisions, refresh and other registrations.
 perform helm_channex_revisions.lock_route(p_connection,p_generation);
 perform 1 from public.bookings where id=p_booking_id for update;
 if p_remote_id is null or not exists(select 1 from helm_channex_revisions.bookings
   where canonical_id=p_booking_id and remote_id=p_remote_id)
 then raise exception 'Exact reviewed remote booking binding required'; end if;
 observation:=public.automation_message_observe_times(p_booking_id,p_canonical_revision,
  p_expected_revision,p_observation);
 policy:=public.helm_pilot_message_times_register(p_booking_id,observation,p_connection,p_generation,
  p_observation->>'evidence_id',p_expires_at,p_enabled);
 return jsonb_build_object('observationRevision',observation,'policyId',policy,
  'enabled',p_enabled,'canSend',false);
end $$;
revoke all on function public.helm_pilot_message_times_bootstrap(uuid,uuid,text,uuid,jsonb,text,bigint,timestamptz,boolean)
 from public,anon,authenticated,service_role;
commit;
