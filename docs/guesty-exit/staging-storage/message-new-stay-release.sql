-- Candidate only, after message-new-stay-queue.sql. Owner-only initial release.
-- Does not enable a property, route, rule, cleaner batch or provider sender.
begin;
alter table helm_channex_revisions.message_new_stay_queues add column released_at timestamptz;

create function public.automation_new_stay_queue_snapshot(p_booking uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object('context',public.automation_message_booking_context(b.id),
  'journal',to_jsonb(q),'policy',(select to_jsonb(c) from helm_channex_revisions.message_new_stay_queue_policy c where singleton),
  'route',(select to_jsonb(r) from public.automation_channex_routes r where r.property_id=b.property_id),
  'timing_policy',(select to_jsonb(t) from helm_channex_revisions.message_timing_policies t where t.booking_id=b.id),
  'observation',(select to_jsonb(o) from public.automation_message_observations o where o.booking_id=b.id),
  'sends',(select jsonb_agg(to_jsonb(s) order by s.id) from public.automation_sends s where s.booking_id=b.id),
  'guest_jobs',(select jsonb_agg(to_jsonb(j) order by j.send_id) from public.automation_channex_jobs j where j.booking_id=b.id),
  'cleaner_batches',(select jsonb_agg(to_jsonb(c) order by c.send_id) from public.automation_cleaner_batches c where c.booking_id=b.id),
  'cleaner_jobs',(select jsonb_agg(to_jsonb(j) order by j.id) from public.automation_cleaner_jobs j join public.automation_cleaner_batches c on c.send_id=j.send_id where c.booking_id=b.id),
  'holds',(select jsonb_agg(to_jsonb(h) order by h.id) from public.automation_hold_events h join public.automation_sends s on s.id=h.send_id where s.booking_id=b.id)
 )::text)
 from public.bookings b join helm_channex_revisions.message_new_stay_queues q on q.booking_id=b.id where b.id=p_booking;
$$;
create function public.automation_new_stay_queue_release(p_booking uuid,p_expected_snapshot text,p_actor text)
returns boolean language plpgsql security definer set search_path='' as $$
declare q helm_channex_revisions.message_new_stay_queues; b public.bookings;
 cfg helm_channex_revisions.message_new_stay_queue_policy; s public.automation_sends;
 conn text; gen bigint;
begin
 if nullif(btrim(p_actor),'') is null or p_expected_snapshot is null then raise exception 'Reviewed release context required'; end if;
 select connection,generation into conn,gen from helm_channex_revisions.message_new_stay_queue_policy where singleton;
 if not found then return false; end if;
 perform helm_channex_revisions.lock_route(conn,gen);
 select * into cfg from helm_channex_revisions.message_new_stay_queue_policy where singleton for share;
 if not found or cfg.connection is distinct from conn or cfg.generation is distinct from gen or not cfg.enabled or cfg.expires_at<=clock_timestamp() then return false; end if;

 perform 1 from public.automation_channex_routes where property_id='HELMTEST-calderwood' for share;
 select * into b from public.bookings where id=p_booking for update;
 perform 1 from helm_channex_revisions.message_timing_policies where booking_id=p_booking for share;
 select * into q from helm_channex_revisions.message_new_stay_queues where booking_id=p_booking for update;
 if q.booking_id is null or q.released_at is not null or q.policy_id is distinct from cfg.policy_id
  or b.property_id is distinct from 'HELMTEST-calderwood' or b.status::text is distinct from 'confirmed' or b.duplicate_of is not null
  or not public.automation_message_observation_current(b.id)
  or public.automation_message_confirmation_anchor(b.id) is null
  or not exists(select 1 from public.automation_channex_routes r where r.property_id=b.property_id
    and r.generation=cfg.route_generation and r.environment='staging'
    and r.source_stopped_at=cfg.source_stopped_at and r.source_drained_at=cfg.source_drained_at)
  or exists(select 1 from jsonb_array_elements(cfg.rules) v left join public.message_automations r on r.id=(v->>'automation_id')::uuid
    where r.id is null or md5(to_jsonb(r)::text) is distinct from v->>'digest')
  or not exists(select 1 from helm_channex_revisions.message_timing_policies t where t.booking_id=b.id and t.enabled and t.expires_at>clock_timestamp()
     and t.receipt_revision=q.receipt_revision and t.connection=cfg.connection and t.generation=cfg.generation)
 then return false; end if;
 perform 1 from public.message_automations where property_id=b.property_id or property_id is null order by id for share;
 perform 1 from public.automation_sends where booking_id=b.id order by id for update;
 perform 1 from public.automation_channex_jobs where booking_id=b.id order by send_id for update;
 perform 1 from public.automation_cleaner_batches where booking_id=b.id order by send_id for update;
 perform 1 from public.automation_cleaner_jobs j where j.send_id=any(q.send_ids) order by id for update;
 if p_expected_snapshot is distinct from public.automation_new_stay_queue_snapshot(b.id)
  or (select count(*) from public.automation_sends where booking_id=b.id)<>6
  or (select count(*) from public.automation_channex_jobs where booking_id=b.id)<>4
  or (select count(*) from public.automation_cleaner_batches where booking_id=b.id)<>2
  or exists(select 1 from public.automation_hold_events where send_id=any(q.send_ids))
 then return false; end if;
 for s in select * from public.automation_sends where booking_id=b.id order by id loop
  if not s.id=any(q.send_ids) or s.status is distinct from 'held' or s.provider_message_id is not null or s.sent_at is not null
   or s.planned_check_in is distinct from b.check_in or s.planned_check_out is distinct from b.check_out
   or s.fire_at is null or s.fire_at<=clock_timestamp()
  then return false; end if;
  if s.delivery_used='channex' then
   if not exists(select 1 from public.automation_channex_jobs j where j.send_id=s.id and j.state='prepared' and j.attempt_id is null
     and j.expires_at>clock_timestamp() and j.route_generation=cfg.route_generation and j.fire_at=s.fire_at)
     or public.automation_channex_schedule(s.id) is distinct from s.fire_at then return false; end if;
  elsif s.delivery_used='quo_cleaner' then
   if not exists(select 1 from public.automation_cleaner_batches c where c.send_id=s.id and c.expires_at>clock_timestamp() and c.fire_at=s.fire_at
       and c.from_number=cfg.from_number and c.recipient_phones=cfg.recipient_phones)
     or exists(select 1 from public.automation_cleaner_jobs j where j.send_id=s.id and (j.state<>'prepared' or j.attempt_id is not null))
     or not exists(select 1 from public.automation_cleaner_batches c where c.send_id=s.id
       and cardinality(c.recipient_phones)=(select count(*) from public.automation_cleaner_jobs j where j.send_id=s.id))
     or public.automation_cleaner_schedule(s.id) is distinct from s.fire_at then return false; end if;
  else return false; end if;
 end loop;
 if cfg.expires_at<=clock_timestamp() or not exists(select 1 from helm_channex_revisions.message_timing_policies
   where booking_id=b.id and enabled and expires_at>clock_timestamp()) then return false; end if;
 -- Validation finishes before any release; the complete set and audit commit together.
 update public.automation_sends set status='scheduled',updated_at=clock_timestamp() where id=any(q.send_ids);
 insert into public.automation_hold_events(send_id,action,actor) select unnest(q.send_ids),'release',p_actor;
 update helm_channex_revisions.message_new_stay_queues set released_at=clock_timestamp() where booking_id=b.id;
 return true;
end $$;
revoke all on function public.automation_new_stay_queue_snapshot(uuid),public.automation_new_stay_queue_release(uuid,text,text)
 from public,anon,authenticated,service_role;
commit;
