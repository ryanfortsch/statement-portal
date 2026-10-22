-- DRAFT, NOT APPLIED. Install after message-handoff-registration.sql.
-- Database-owner reviewed import only. No provider calls or sender activation.
begin;
-- A reviewed Guesty reservation can belong to only one canonical stay.
create table public.automation_message_source_stays (
 source_account_id text not null,
 source_reservation_id text not null,
 booking_id uuid not null unique references public.bookings(id),
 primary key(source_account_id,source_reservation_id)
);
create table public.automation_message_source_history (
 send_id uuid primary key references public.automation_sends(id),
 booking_id uuid not null references public.bookings(id),
 property_id text not null references public.properties(id),
 automation_key text not null,
 workflow text not null,
 source_account_id text not null,
 source_reservation_id text not null,
 review_id uuid not null unique,
 review_digest text not null,
 observation_revision uuid not null references public.automation_message_observation_history(revision),
 evidence_id text not null,
 observed_at timestamptz not null,
 sent_at timestamptz not null,
 imported_at timestamptz not null default clock_timestamp(),
 unique(booking_id,automation_key)
);
create table public.automation_message_source_receipts (
 source_account_id text not null,
 source_message_id text not null,
 send_id uuid not null references public.automation_message_source_history(send_id),
 recipient_ref text not null,
 sent_at timestamptz not null,
 primary key(source_account_id,source_message_id),
 unique(send_id,recipient_ref)
);
alter table public.automation_message_source_stays enable row level security;
alter table public.automation_message_source_history enable row level security;
alter table public.automation_message_source_receipts enable row level security;
revoke all on public.automation_message_source_stays,public.automation_message_source_history,public.automation_message_source_receipts from public,anon,authenticated,service_role;

-- Imported history is terminal even if a caller attempts to recreate the rule,
-- requeue the row, or change its delivery rail. The ordinary planner also treats
-- sent booking/key pairs as settled. No fabricated Channex/Quo receipt is stored.
create function public.automation_message_history_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare h public.automation_message_source_history%rowtype;
begin
 -- Serialize even a concurrent replacement-rule INSERT with the import. The
 -- hash is only a lock key; a collision merely waits, never merges identities.
 perform pg_advisory_xact_lock(hashtextextended(new.booking_id::text||':'||coalesce(new.automation_key,''),0));
 if tg_op='UPDATE' then
   select * into h from public.automation_message_source_history where send_id=old.id;
 end if;
 if h.send_id is null then
   select * into h from public.automation_message_source_history
    where booking_id=new.booking_id and automation_key=new.automation_key;
 end if;
 if h.send_id is null then return new; end if;
 if new.id is distinct from h.send_id or new.booking_id is distinct from h.booking_id
   or new.property_id is distinct from h.property_id or new.automation_key is distinct from h.automation_key
   or new.status is distinct from 'sent' or new.delivery_used is distinct from 'guesty_history'
   or new.sent_at is distinct from h.sent_at or new.provider_message_id is not null then
   raise exception 'Imported source message cannot be replayed or rerouted';
 end if;
 return new;
end;
$$;
create trigger automation_message_history_guard before insert or update on public.automation_sends
for each row execute function public.automation_message_history_guard();

-- This records verified source evidence, not independent proof of Guesty delivery.
-- Cleaner history requires one source receipt for every reviewed recipient.
create function public.automation_message_import_history(p_send_id uuid,p_review jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare s public.automation_sends%rowtype; b public.bookings%rowtype;
 h public.automation_message_source_history%rowtype; o public.automation_message_observations%rowtype;
 m jsonb; flow text; stamp timestamptz; sent timestamptz; latest timestamptz;
 expected text[]; actual text[];
begin
 select * into s from public.automation_sends where id=p_send_id;
 select * into b from public.bookings where id=s.booking_id for update;
 select * into s from public.automation_sends where id=p_send_id for update;
 perform pg_advisory_xact_lock(hashtextextended(s.booking_id::text||':'||coalesce(s.automation_key,''),0));
 select * into h from public.automation_message_source_history where send_id=p_send_id;
 if found then
   if h.review_id=(p_review->>'review_id')::uuid and h.review_digest=md5(p_review::text) then return true; end if;
   raise exception 'Source history identity conflict';
 end if;
 select * into o from public.automation_message_observations where booking_id=b.id;
 if s.id is null or b.id is null or b.status::text<>'confirmed' or b.duplicate_of is not null
   or s.property_id is distinct from b.property_id or s.status not in ('scheduled','held')
   or s.sent_at is not null or s.provider_message_id is not null
   or to_jsonb(s)->>'guest_message_id' is not null or coalesce((to_jsonb(s)->>'secrets_sent')::boolean,false)
   or s.delivery_used in ('channex','quo_cleaner','guesty_history')
   or s.planned_check_in is distinct from b.check_in or s.planned_check_out is distinct from b.check_out
   or p_review->>'context_revision' is distinct from public.automation_channex_context(s.id)
   or p_review->>'observation_revision' is distinct from o.revision::text or o.revision is null
   or not public.automation_message_observation_current(b.id)
   or p_review->'complete' is distinct from 'true'::jsonb or p_review->'sent' is distinct from 'true'::jsonb
   or p_review->'queued' is distinct from 'false'::jsonb or p_review->'uncertain' is distinct from 'false'::jsonb
   or jsonb_typeof(p_review->'messages') is distinct from 'array'
   or jsonb_typeof(p_review->'recipient_refs') is distinct from 'array'
   or p_review->>'review_id' is null
   or exists(select 1 from unnest(array['source_account_id','source_reservation_id','evidence_id']) k
     where coalesce(p_review->>k,'') !~ '^[A-Za-z0-9_.:-]{1,160}$')
   or coalesce(p_review->>'observed_at','') !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
   or exists(select 1 from jsonb_object_keys(p_review) k where k not in
     ('review_id','context_revision','observation_revision','complete','sent','queued','uncertain','evidence_id',
      'observed_at','workflow','source_account_id','source_reservation_id','messages','recipient_refs'))
 then raise exception 'Verified already-sent source history required'; end if;
 flow:=p_review->>'workflow'; stamp:=(p_review->>'observed_at')::timestamptz;
 if stamp>clock_timestamp() or stamp<clock_timestamp()-interval '5 minutes' or stamp<o.observed_at
 then raise exception 'Source history observation is not fresh'; end if;
 if not exists(select 1 from public.message_automations r where r.id=s.automation_id
   and r.key=s.automation_key and (r.property_id is null or r.property_id=s.property_id)
   and r.audience=case when flow in ('cleaner_advance','cleaner_arrival') then 'cleaner' else 'guest' end
   and r.trigger=case flow when 'confirmation' then 'booking_confirmed' when 'pre_arrival' then 'pre_arrival'
     when 'key_code' then 'checkin_day' when 'pre_checkout' then 'pre_checkout'
     when 'cleaner_advance' then 'pre_arrival' when 'cleaner_arrival' then 'checkin_day' end)
 then raise exception 'Source history workflow mismatch'; end if;
 if jsonb_array_length(p_review->'messages') not between 1 and 10
   or jsonb_array_length(p_review->'recipient_refs') not between 1 and 10
   or exists(select 1 from jsonb_array_elements(p_review->'recipient_refs') v
     where jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[A-Za-z0-9_.:-]{1,160}$')
 then raise exception 'Source history recipients required'; end if;
 select array_agg(v order by v) into expected from jsonb_array_elements_text(p_review->'recipient_refs') v;
 if cardinality(expected)<>(select count(distinct v) from unnest(expected) v)
   or (flow not in ('cleaner_advance','cleaner_arrival') and expected<>array['guest'])
 then raise exception 'Source history recipient set mismatch'; end if;
 actual:='{}';
 for m in select value from jsonb_array_elements(p_review->'messages') loop
   if jsonb_typeof(m) is distinct from 'object' or not (m ?& array['id','sent_at','recipient_ref'])
     or exists(select 1 from jsonb_object_keys(m) k where k not in ('id','sent_at','recipient_ref'))
     or coalesce(m->>'id','') !~ '^[A-Za-z0-9_.:-]{1,160}$'
     or coalesce(m->>'recipient_ref','') !~ '^[A-Za-z0-9_.:-]{1,160}$'
     or coalesce(m->>'sent_at','') !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
   then raise exception 'Source receipt identity required'; end if;
   sent:=(m->>'sent_at')::timestamptz;
   if not isfinite(sent) or sent>stamp then raise exception 'Source receipt time is invalid'; end if;
   latest:=greatest(latest,sent); actual:=array_append(actual,m->>'recipient_ref');
 end loop;
 if expected is distinct from (select array_agg(v order by v) from unnest(actual) v)
 then raise exception 'Source history is incomplete for the reviewed recipients'; end if;
 -- Never overwrite a second schedule for this permanent booking/key identity.
 if exists(select 1 from public.automation_sends x where x.booking_id=b.id
   and x.automation_key=s.automation_key and x.id<>s.id)
 then raise exception 'Duplicate canonical source schedule requires reconciliation'; end if;
 insert into public.automation_message_source_stays values(p_review->>'source_account_id',p_review->>'source_reservation_id',b.id)
 on conflict(source_account_id,source_reservation_id) do nothing;
 if not exists(select 1 from public.automation_message_source_stays x where x.source_account_id=p_review->>'source_account_id'
   and x.source_reservation_id=p_review->>'source_reservation_id' and x.booking_id=b.id)
 then raise exception 'Source reservation already belongs to another canonical stay'; end if;
 insert into public.automation_message_source_history values(s.id,b.id,s.property_id,s.automation_key,flow,
   p_review->>'source_account_id',p_review->>'source_reservation_id',(p_review->>'review_id')::uuid,md5(p_review::text),
   o.revision,p_review->>'evidence_id',stamp,latest,clock_timestamp());
 insert into public.automation_message_source_receipts
   select p_review->>'source_account_id',v->>'id',s.id,v->>'recipient_ref',(v->>'sent_at')::timestamptz
   from jsonb_array_elements(p_review->'messages') v;
 update public.automation_sends set status='sent',delivery_used='guesty_history',sent_at=latest,
   error=null,body_rendered=null,subject_rendered=null,to_address=null,missing_fields='{}',
   secrets_sent=false,updated_at=clock_timestamp() where id=s.id;
 return true;
end;
$$;

-- Exactly four guest and two cleaner workflows, applied as one transaction.
-- A complete manifest is required, including terminal source history; no silent
-- partial handoff. Existing future-unsent registration retains holds and gates.
create function public.automation_message_handoff_stay(p_booking_id uuid,p_canonical_revision text,p_entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; entry jsonb; s public.automation_sends%rowtype;
 flows text[]; result jsonb:='[]'; flow text;
begin
 -- Match the execution lock order: route, then canonical booking, then sends.
 perform 1 from public.automation_channex_routes r join public.bookings linked_booking on linked_booking.property_id=r.property_id
   where linked_booking.id=p_booking_id for share of r;
 select * into b from public.bookings where id=p_booking_id for update;
 if b.id is null or b.status::text<>'confirmed' or b.duplicate_of is not null
   or p_canonical_revision is distinct from public.automation_message_stay_revision(b.id)
   or not public.automation_message_observation_current(b.id)
   or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)<>6
 then raise exception 'Complete current stay handoff required'; end if;
 select array_agg(v->'review'->>'workflow' order by v->'review'->>'workflow') into flows
   from jsonb_array_elements(p_entries) v;
 if flows is distinct from array['cleaner_advance','cleaner_arrival','confirmation','key_code','pre_arrival','pre_checkout']
   or (select count(distinct v->>'send_id') from jsonb_array_elements(p_entries) v)<>6
 then raise exception 'Exactly six distinct workflows and schedules required'; end if;
 -- Lock every existing row first so a claimed/sent sibling cannot be overlooked.
 perform 1 from public.automation_sends where booking_id=b.id order by id for update;
 for entry in select value from jsonb_array_elements(p_entries) order by value->>'send_id' loop
   if jsonb_typeof(entry) is distinct from 'object' or not (entry ?& array['send_id','review'])
     or exists(select 1 from jsonb_object_keys(entry) k where k not in ('send_id','review'))
   then raise exception 'Invalid stay handoff entry'; end if;
   select * into s from public.automation_sends where id=(entry->>'send_id')::uuid;
   if s.id is null or s.booking_id is distinct from b.id or s.property_id is distinct from b.property_id
   then raise exception 'Stay handoff schedule outside scope'; end if;
   if exists(select 1 from public.automation_sends x where x.booking_id=b.id
     and x.automation_key=s.automation_key and x.id<>s.id)
   then raise exception 'Duplicate canonical source schedule requires reconciliation'; end if;
   flow:=entry->'review'->>'workflow';
   if entry->'review'->'sent'='true'::jsonb then
     perform public.automation_message_import_history(s.id,entry->'review');
     result:=result||jsonb_build_array(jsonb_build_object('send_id',s.id,'workflow',flow,'result','source_sent'));
   else
     perform public.automation_message_register_handoff(s.id,entry->'review');
     result:=result||jsonb_build_array(jsonb_build_object('send_id',s.id,'workflow',flow,'result','future_registered'));
   end if;
 end loop;
 return result;
end;
$$;
revoke all on function public.automation_message_history_guard() from public,anon,authenticated,service_role;
revoke all on function public.automation_message_import_history(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.automation_message_handoff_stay(uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
