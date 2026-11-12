-- Scoped merge/history serialization. No scope, jobs, evidence, template changes or sends.
begin;
set local lock_timeout='5s';

-- Initial scope installation waits for in-flight booking/ledger writes. The lock
-- is held only when installing a scope, not on normal fleet booking operations.
create function helm_channex_messages.scope_install_guard() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'message_read_committed_required'; end if;
 lock table public.bookings,public.automation_sends in share row exclusive mode;
 if exists(select 1 from public.bookings b left join public.bookings parent on parent.id=b.duplicate_of
  where b.duplicate_of is not null and
   ((b.property_id='65_calderwood' and parent.property_id is distinct from b.property_id)
    or (parent.property_id='65_calderwood' and b.property_id is distinct from parent.property_id)))
 then raise exception 'message_family_invalid'; end if;
 return new;
end$$;
create trigger channex_message_scope_install before insert on helm_channex_messages.scope
 for each statement execute function helm_channex_messages.scope_install_guard();

-- A scoped family's membership is frozen until an explicit reconciliation.
-- Ordinary dates/status updates and new canonical bookings remain supported.
-- Including the referenced parent prevents a foreign-property row joining it.
create function helm_channex_messages.family_identity_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior public.bookings; upcoming public.bookings;
begin
 if tg_op<>'INSERT' then prior:=old; end if;
 if tg_op<>'DELETE' then upcoming:=new; end if;
 if current_setting('transaction_isolation')<>'read committed' and
  ('65_calderwood' in (prior.property_id,upcoming.property_id) or exists(select 1 from public.bookings b
   where b.id in (prior.duplicate_of,upcoming.duplicate_of) and b.property_id='65_calderwood'))
 then raise exception 'message_read_committed_required'; end if;
 if tg_op='UPDATE' and (new.id,new.property_id,new.duplicate_of) is not distinct from
  (old.id,old.property_id,old.duplicate_of) then return new; end if;
 if tg_op='INSERT' and new.duplicate_of is null then return new; end if;
 if exists(select 1 from helm_channex_messages.scope s where s.property_id in (prior.property_id,upcoming.property_id)
  or exists(select 1 from public.bookings b where b.id in (prior.duplicate_of,upcoming.duplicate_of)
    and b.property_id=s.property_id))
 then raise exception 'message_family_reconciliation_required'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end$$;
create trigger channex_message_family_identity before insert or update or delete on public.bookings
 for each row execute function helm_channex_messages.family_identity_guard();

-- Follow bounded ancestry. Cycles, missing ancestors and cross-property merges
-- fail closed. Family identity cannot change while the scope is installed.
create function helm_channex_messages.lock_family(p_booking uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare b public.bookings; root uuid:=p_booking; seen uuid[]:='{}'; prop text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'message_read_committed_required'; end if;
 loop
  if root=any(seen) or cardinality(seen)>=64 then raise exception 'message_family_invalid'; end if;
  seen:=array_append(seen,root);
  select * into b from public.bookings where id=root;
  if not found then raise exception 'message_family_invalid'; end if;
  if prop is null then prop:=b.property_id; end if;
  if b.property_id is distinct from prop then raise exception 'message_family_invalid'; end if;
  if b.duplicate_of is null then exit; end if;
  root:=b.duplicate_of;
 end loop;
 perform 1 from public.bookings where id=root for update;
 if not found then raise exception 'message_family_invalid'; end if;
 return root;
end$$;

-- Check all descendant history, including ambiguous/missing automation keys.
-- UNION (not UNION ALL) terminates even if pre-existing data contains a cycle.
create function helm_channex_messages.descendant_history(p_booking uuid) returns boolean
language sql stable security definer set search_path='' as $$
 with recursive family(id) as (
  select p_booking union select b.id from public.bookings b join family f on b.duplicate_of=f.id
 ) select exists(select 1 from family f join public.automation_sends s on s.booking_id=f.id where f.id<>p_booking);
$$;

-- All scoped history writes share registration/claim's canonical booking lock.
-- Reject a late descendant import rather than silently dropping source evidence.
-- A rejected import needs reconciliation; it must never trigger a provider POST.
create function helm_channex_messages.family_history_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_value public.automation_sends; prior public.automation_sends; root uuid;
begin
 if tg_op<>'INSERT' then prior:=old; end if;
 if tg_op='DELETE' then row_value:=old; else row_value:=new; end if;
 if current_setting('transaction_isolation')<>'read committed' and
  ('65_calderwood' in (row_value.property_id,prior.property_id) or exists(select 1 from public.bookings b
    where b.id in (row_value.booking_id,prior.booking_id) and b.property_id='65_calderwood'))
 then raise exception 'message_read_committed_required'; end if;
 if not exists(select 1 from helm_channex_messages.scope s where s.property_id in (row_value.property_id,prior.property_id)
  or exists(select 1 from public.bookings b where b.id in (row_value.booking_id,prior.booking_id) and b.property_id=s.property_id))
 then if tg_op='DELETE' then return old; else return new; end if; end if;
 if tg_op='DELETE' then raise exception 'message_history_retained'; end if;
 if tg_op='UPDATE' and (new.id,new.booking_id,new.property_id,new.automation_key,new.automation_id)
  is distinct from (old.id,old.booking_id,old.property_id,old.automation_key,old.automation_id)
 then raise exception 'message_history_identity_immutable'; end if;
 if not exists(select 1 from public.bookings b where b.id=row_value.booking_id and b.property_id=row_value.property_id)
 then raise exception 'message_family_invalid'; end if;
 root:=helm_channex_messages.lock_family(row_value.booking_id);
 if root<>row_value.booking_id and exists(select 1 from helm_channex_messages.jobs where booking_id=root)
 then raise exception 'message_descendant_history_conflict'; end if;
 if tg_op='INSERT' and root=row_value.booking_id and exists(
  select 1 from helm_channex_messages.jobs j left join public.message_automations r on r.id=new.automation_id
  where j.booking_id=root and j.send_id<>new.id and
   (new.automation_key is null or (r.key is not null and r.key<>new.automation_key)))
 then raise exception 'message_history_conflict'; end if;
 return new;
end$$;
create trigger channex_message_00_family_history before insert or update or delete on public.automation_sends
 for each row execute function helm_channex_messages.family_history_guard();

create or replace function helm_channex_messages.register_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.automation_sends; r helm_channex_messages.scope;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'message_read_committed_required'; end if;
 select * into r from helm_channex_messages.scope where property_id=new.property_id for share;
 perform 1 from public.bookings where id=new.booking_id for update;
 select * into s from public.automation_sends where id=new.send_id for update;
 if not found or s.booking_id is distinct from new.booking_id or s.property_id is distinct from new.property_id
 or s.automation_key is distinct from new.automation_key or s.status is distinct from 'scheduled'
 or s.fire_at is distinct from new.fire_at or s.fire_at<=clock_timestamp() or new.state<>'prepared'
 or s.provider_message_id is not null or s.sent_at is not null
 or new.route_generation is distinct from r.generation
 or new.context_revision is distinct from helm_channex_messages.context(s.id)
 or helm_channex_messages.descendant_history(new.booking_id)
 or not exists(select 1 from helm_airbnb_bookings.bookings m where m.canonical_id=new.booking_id
   and m.remote_id=new.remote_booking and m.remote_property=r.remote_property and m.environment=r.environment)
 or exists(select 1 from public.automation_sends other where other.booking_id=new.booking_id
   and other.automation_key=new.automation_key and other.id<>new.send_id)
 then raise exception 'message_registration_mismatch'; end if;
 update public.automation_sends set delivery_used='channex',updated_at=clock_timestamp() where id=s.id;
 return new;
end$$;

create or replace function public.helm_channex_message_claim(p_send_id uuid,p_attempt_id uuid,p_attempt jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare j helm_channex_messages.jobs; r helm_channex_messages.scope; s public.automation_sends;
 b public.bookings; p public.properties; rule public.message_automations; stamp timestamptz;
begin
 if p_attempt_id is null or p_attempt is null or current_setting('transaction_isolation')<>'read committed' then return false; end if;
 select * into j from helm_channex_messages.jobs where send_id=p_send_id;
 if not found then return false; end if;
 select * into r from helm_channex_messages.scope where property_id=j.property_id for share;
 -- Booking -> send -> job agrees with canonical cancellation/hold/receipt writes.
 select * into b from public.bookings where id=j.booking_id for update;
 select * into s from public.automation_sends where id=p_send_id for update;
 select * into j from helm_channex_messages.jobs where send_id=p_send_id for update;
 select * into p from public.properties where id=j.property_id for share;
 select * into rule from public.message_automations where id=s.automation_id for share;
 stamp:=clock_timestamp();
 if j.state<>'prepared' or j.held or not r.enabled or r.generation<>j.route_generation
 or r.source_stopped_at is null or r.source_drained_at is null or r.source_evidence_id is null
 or r.source_drained_at>j.source_evidence_at or j.source_evidence_at>stamp
 or s.status is distinct from 'scheduled' or s.delivery_used is distinct from 'channex'
 or s.provider_message_id is not null or s.sent_at is not null
 or (s.booking_id,s.property_id,s.automation_key) is distinct from (j.booking_id,j.property_id,j.automation_key)
 or b.status is distinct from 'confirmed' or b.duplicate_of is not null or b.property_id<>j.property_id
 or b.channel is distinct from 'airbnb'::public.booking_channel
 or b.check_in is distinct from s.planned_check_in or b.check_out is distinct from s.planned_check_out
 or s.fire_at is distinct from j.fire_at or s.fire_at>stamp or j.expires_at<=stamp
 or p.automations_enabled is distinct from true or p.calendar_authority is distinct from 'helm'
 or rule.id is null or not rule.enabled or rule.audience<>'guest' or rule.send_mode<>'auto' or rule.configured_in_ota
 or rule.key<>j.automation_key or rule.trigger<>j.automation_key
 or (rule.property_id is not null and rule.property_id<>j.property_id)
 or (rule.min_nights is not null and b.check_out-b.check_in<rule.min_nights)
 or 'airbnb'=any(select lower(x) from unnest(rule.channel_exclusions) x)
 or exists(select 1 from public.message_automations o where rule.property_id is null and o.property_id=j.property_id and o.key=rule.key)
 or exists(select 1 from public.automation_sends other where other.booking_id=j.booking_id and other.automation_key=j.automation_key and other.id<>s.id)
 or helm_channex_messages.descendant_history(j.booking_id)
 or exists(select 1 from public.automation_sends other left join public.message_automations a on a.id=other.automation_id
  where other.booking_id=j.booking_id and other.id<>s.id and
   (other.automation_key is null or (a.key is not null and a.key<>other.automation_key)))
 or j.context_revision is distinct from helm_channex_messages.context(s.id)
 or not exists(select 1 from helm_airbnb_bookings.bookings m where m.canonical_id=b.id and m.remote_id=j.remote_booking
   and m.remote_property=r.remote_property and m.environment=r.environment and m.check_in=b.check_in
   and m.check_out=b.check_out and m.status=b.status and m.code is not distinct from b.external_confirmation_code)
 or p_attempt is distinct from jsonb_build_object('environment',r.environment,'propertyId',r.remote_property,
   'channelId',r.channel_id,'provider',r.provider,'bookingId',j.remote_booking,'threadId',j.thread_id,'bodySha256',j.body_sha256)
 then return false; end if;
 update helm_channex_messages.jobs set state='attempting',attempt_id=p_attempt_id,attempted_at=stamp,version=version+1 where send_id=p_send_id;
 perform set_config('helm.channex_message_claim',p_attempt_id::text,true);
 update public.automation_sends set status='sending',updated_at=stamp where id=p_send_id;
 return true; -- Replaying even the same attempt never grants another POST.
end$$;

revoke all on function helm_channex_messages.scope_install_guard(),helm_channex_messages.family_identity_guard(),
 helm_channex_messages.lock_family(uuid),helm_channex_messages.descendant_history(uuid),
 helm_channex_messages.family_history_guard() from public,anon,authenticated,service_role;
commit;
