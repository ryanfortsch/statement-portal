-- CANDIDATE, NOT APPLIED. Incremental extension after message-history-handoff.sql.
-- Owner-only atomic queue preparation. No source fetch, sender activation or sends.
begin;
-- Same context digest as the existing send lookup, available BEFORE any send
-- exists. No clear guest, access or template fields are returned.
create function public.automation_message_booking_context(p_booking_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object(
 'booking',to_jsonb(b), 'property',to_jsonb(p),
 'rules',(select jsonb_agg(to_jsonb(r) order by r.id) from public.message_automations r where r.property_id=b.property_id or r.property_id is null),
 'plan',(select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.property_rate_plans r where r.property_id=b.property_id),
 'adjustments',(select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text) from public.checkout_adjustments a where a.property_id=b.property_id and a.stay_check_in=b.check_in),
 'access',(select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text) from public.property_access a where a.property_id=b.property_id),
 'codes',(select jsonb_agg(to_jsonb(c) order by c.id) from public.guest_access_codes c where c.booking_id=b.id),
 'locks',(select jsonb_agg(to_jsonb(l) order by l.device_id) from public.lock_devices l where l.property_id=b.property_id),
 'guest',(select to_jsonb(g) from public.guests g where g.id=b.guest_id)
 )::text)
 from public.bookings b join public.properties p on p.id=b.property_id where b.id=p_booking_id;
$$;
create or replace function public.automation_channex_context(p_send_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select public.automation_message_booking_context(s.booking_id)
 from public.automation_sends s where s.id=p_send_id;
$$;

-- The caller must obtain source evidence against this current context. A caller
-- cannot ask this function to regenerate a changed review token during the write.
create function public.automation_message_preparation_snapshot(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('canonical_revision',public.automation_message_stay_revision(b.id),
 'context_revision',public.automation_message_booking_context(b.id),'observation_revision',o.revision)
 from public.bookings b join public.automation_message_observations o on o.booking_id=b.id
 where b.id=p_booking_id and b.status::text='confirmed' and b.duplicate_of is null
 and public.automation_message_observation_current(b.id);
$$;

-- One complete source-reviewed packet creates the missing native rows and then
-- invokes the existing six-workflow handoff. Nothing commits unreserved between
-- those steps. Existing holds/receipts/IDs survive; this is NOT a retime or revive
-- API. The native workers retain their own final claim and source-expiry gates.
create function public.automation_message_prepare_handoff(p_booking_id uuid,p_canonical_revision text,p_entries jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; r public.message_automations%rowtype; s public.automation_sends%rowtype;
 entry jsonb; flow text; flows text[]; schedule_at timestamptz; context text; observations uuid;
 entries jsonb:='[]'; match_count integer;
begin
 perform 1 from public.automation_channex_routes route join public.bookings linked on linked.property_id=route.property_id
   where linked.id=p_booking_id for share of route;
 select * into b from public.bookings where id=p_booking_id for update;
 if b.id is null or b.status::text<>'confirmed' or b.duplicate_of is not null
   or p_canonical_revision is distinct from public.automation_message_stay_revision(b.id)
   or not public.automation_message_observation_current(b.id)
   or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)<>6
 then raise exception 'Complete current stay preparation required'; end if;
 select array_agg(v->'review'->>'workflow' order by v->'review'->>'workflow') into flows
   from jsonb_array_elements(p_entries) v;
 if flows is distinct from array['cleaner_advance','cleaner_arrival','confirmation','key_code','pre_arrival','pre_checkout']
   or (select count(distinct v->>'automation_id') from jsonb_array_elements(p_entries) v)<>6
 then raise exception 'Exactly six distinct preparation workflows and rules required'; end if;
 -- Hold the existing rule definitions for this transaction; reread context after
 -- locks so a concurrent change cannot be silently folded into reviewed evidence.
 perform 1 from public.message_automations where property_id=b.property_id or property_id is null order by id for share;
 context:=public.automation_message_booking_context(b.id);
 select revision into observations from public.automation_message_observations where booking_id=b.id;
 perform 1 from public.automation_sends where booking_id=b.id order by id for update;
 for entry in select value from jsonb_array_elements(p_entries) order by value->>'automation_id' loop
   if jsonb_typeof(entry) is distinct from 'object' or not (entry ?& array['automation_id','fire_at','review'])
     or exists(select 1 from jsonb_object_keys(entry) k where k not in ('automation_id','fire_at','review'))
     or jsonb_typeof(entry->'review') is distinct from 'object'
     or coalesce(entry->>'fire_at','') !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
     or entry->'review'->>'context_revision' is distinct from context
     or entry->'review'->>'observation_revision' is distinct from observations::text
   then raise exception 'Preparation evidence context mismatch'; end if;
   schedule_at:=(entry->>'fire_at')::timestamptz;
   if not isfinite(schedule_at) then raise exception 'Finite preparation schedule required'; end if;
   select * into r from public.message_automations where id=(entry->>'automation_id')::uuid;
   flow:=entry->'review'->>'workflow';
   if r.id is null or nullif(btrim(r.key),'') is null or (r.property_id is not null and r.property_id<>b.property_id)
     or r.audience is distinct from (case when flow in ('cleaner_advance','cleaner_arrival') then 'cleaner' else 'guest' end)
     or r.trigger is distinct from (case flow when 'confirmation' then 'booking_confirmed' when 'pre_arrival' then 'pre_arrival'
       when 'key_code' then 'checkin_day' when 'pre_checkout' then 'pre_checkout'
       when 'cleaner_advance' then 'pre_arrival' when 'cleaner_arrival' then 'checkin_day' end)
   then raise exception 'Preparation rule binding mismatch'; end if;
   perform pg_advisory_xact_lock(hashtextextended(b.id::text||':'||r.key,0));
   select count(*) into match_count from public.automation_sends
     where booking_id=b.id and (automation_key=r.key or automation_id=r.id);
   if match_count>1 then raise exception 'Duplicate preparation schedules require reconciliation'; end if;
   if match_count=1 then
     select * into s from public.automation_sends where booking_id=b.id and (automation_key=r.key or automation_id=r.id);
     if s.property_id is distinct from b.property_id or s.automation_id is distinct from r.id or s.automation_key is distinct from r.key
       or s.fire_at is distinct from schedule_at or s.planned_check_in is distinct from b.check_in or s.planned_check_out is distinct from b.check_out
     then raise exception 'Existing preparation schedule changed'; end if;
   else
     insert into public.automation_sends(id,booking_id,property_id,automation_id,automation_key,status,fire_at,planned_check_in,planned_check_out,updated_at)
       values(gen_random_uuid(),b.id,b.property_id,r.id,r.key,'scheduled',schedule_at,b.check_in,b.check_out,clock_timestamp()) returning * into s;
   end if;
   entries:=entries||jsonb_build_array(jsonb_build_object('send_id',s.id,'review',entry->'review'));
 end loop;
 -- Rechecks schedules, complete source history, exact destinations and stop/drain
 -- for every workflow. Any failure rolls back newly created rows as well.
 return public.automation_message_handoff_stay(b.id,p_canonical_revision,entries);
end;
$$;
revoke all on function public.automation_message_booking_context(uuid),public.automation_message_preparation_snapshot(uuid),
 public.automation_message_prepare_handoff(uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
