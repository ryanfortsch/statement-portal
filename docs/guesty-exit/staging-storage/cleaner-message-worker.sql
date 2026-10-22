-- DRAFT, NOT APPLIED. Install after automation-holds, channex-message-worker and
-- channex-message-schedule. Uses their canonical context and verified stay times.
-- No routes, source evidence, real recipients, activation or credentials seeded.
begin;
create table public.automation_cleaner_batches (
 send_id uuid primary key references public.automation_sends(id),
 booking_id uuid not null references public.bookings(id),
 property_id text not null references public.properties(id),
 automation_key text not null check(btrim(automation_key)<>''),
 workflow text not null check(workflow in ('cleaner_advance','cleaner_arrival')),
 from_number text not null check(from_number ~ '^\+[1-9][0-9]{1,14}$'),
 recipient_phones text[] not null check(cardinality(recipient_phones) between 1 and 10),
 enabled boolean not null default false,
 source_stopped_at timestamptz not null,
 source_drained_at timestamptz not null,
 source_evidence_at timestamptz not null,
 source_evidence_id text not null check(btrim(source_evidence_id)<>''),
 prepared_at timestamptz not null default clock_timestamp(),
 fire_at timestamptz not null,
 expires_at timestamptz not null,
 unique(booking_id,automation_key),
 check(source_stopped_at<=source_drained_at and source_drained_at<=source_evidence_at
   and source_evidence_at<=prepared_at and prepared_at<fire_at and fire_at<expires_at)
);
create table public.automation_cleaner_jobs (
 id uuid primary key default gen_random_uuid(),
 send_id uuid not null references public.automation_cleaner_batches(send_id),
 to_number text not null check(to_number ~ '^\+[1-9][0-9]{1,14}$'),
 state text not null default 'prepared' check(state in ('prepared','attempting','unknown','rejected','accepted','delivered','undelivered')),
 attempt_id uuid unique,
 attempted_at timestamptz,
 body_sha256 text check(body_sha256 ~ '^[a-f0-9]{64}$'),
 context_revision text,
 provider_message_id text unique check(provider_message_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 finished_at timestamptz,
 receipt_at timestamptz,
 last_checked_at timestamptz,
 unique(send_id,to_number),
 check((state='prepared' and attempt_id is null and attempted_at is null and body_sha256 is null) or
   (state<>'prepared' and attempt_id is not null and attempted_at is not null and body_sha256 is not null)),
 check((state in ('accepted','delivered','undelivered'))=(provider_message_id is not null))
);
alter table public.automation_cleaner_batches enable row level security;
alter table public.automation_cleaner_jobs enable row level security;
revoke all on public.automation_cleaner_batches,public.automation_cleaner_jobs from public,anon,authenticated,service_role;
grant select on public.automation_cleaner_batches,public.automation_cleaner_jobs to service_role;

create function public.automation_cleaner_phone(raw text) returns text
language sql immutable set search_path='' as $$
 select case when d ~ '^[0-9]{10}$' then '+1'||d when d ~ '^1[0-9]{10}$' then '+'||d else null end
 from (select regexp_replace(raw,'[^0-9]','','g') d) q;
$$;
create function public.automation_cleaner_schedule(p_send_id uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
 select public.automation_message_resolved_schedule(p_send_id,g.workflow)
 from public.automation_cleaner_batches g where g.send_id=p_send_id;
$$;
create function public.automation_cleaner_context(p_job_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object('base',public.automation_channex_context(j.send_id),'timing',to_jsonb(t),
 'workflow',g.workflow,'sender',g.from_number,'to',j.to_number,
 'recipients',(select jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text) from public.cleaner_schedule_recipients c
   where public.automation_cleaner_phone(c.phone)=j.to_number),
 'day',case when exists(select 1 from pg_catalog.pg_timezone_names where name=r.timezone)
   then (statement_timestamp() at time zone r.timezone)::date else null end)::text)
 from public.automation_cleaner_jobs j join public.automation_cleaner_batches g on g.send_id=j.send_id
 join public.automation_sends s on s.id=j.send_id join public.message_automations r on r.id=s.automation_id
 left join public.automation_channex_stay_times t on t.booking_id=g.booking_id where j.id=p_job_id;
$$;
create function public.automation_cleaner_register() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.automation_sends%rowtype;
begin
 perform 1 from public.bookings where id=new.booking_id for update;
 select * into s from public.automation_sends where id=new.send_id for update;
 if not found or s.booking_id<>new.booking_id or s.property_id<>new.property_id
   or s.automation_key is distinct from new.automation_key or s.status not in ('scheduled','held')
   or s.fire_at<>new.fire_at or new.prepared_at>clock_timestamp() or new.fire_at<=clock_timestamp()
   or s.sent_at is not null or s.provider_message_id is not null or s.delivery_used in ('channex','quo_cleaner')
   or cardinality(new.recipient_phones)<>(select count(distinct x) from unnest(new.recipient_phones) x)
   or exists(select 1 from unnest(new.recipient_phones) x where x is null or x !~ '^\+1[0-9]{10}$' or x=new.from_number)
 then raise exception 'Cleaner source registration mismatch'; end if;
 update public.automation_sends set delivery_used='quo_cleaner',updated_at=clock_timestamp() where id=s.id;
 return new;
end;
$$;
create trigger automation_cleaner_register before insert on public.automation_cleaner_batches
for each row execute function public.automation_cleaner_register();
create function public.automation_cleaner_seed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.automation_cleaner_jobs(send_id,to_number) select new.send_id,x from unnest(new.recipient_phones) x;
 return new;
end;
$$;
create trigger automation_cleaner_seed after insert on public.automation_cleaner_batches
for each row execute function public.automation_cleaner_seed();
create function public.automation_cleaner_identity_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'enabled'-'fire_at') is distinct from (to_jsonb(old)-'enabled'-'fire_at') then
   raise exception 'Cleaner batch identity is immutable'; end if;
 return new;
end;
$$;
create trigger automation_cleaner_identity_guard before update on public.automation_cleaner_batches
for each row execute function public.automation_cleaner_identity_guard();
create function public.automation_cleaner_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.automation_cleaner_batches where send_id=old.id) then return new; end if;
 if new.delivery_used is distinct from 'quo_cleaner' or new.booking_id<>old.booking_id or new.property_id<>old.property_id
   or new.automation_key is distinct from old.automation_key or new.automation_id<>old.automation_id then
   raise exception 'Reserved cleaner message cannot be rerouted'; end if;
 if new.status='sending' and old.status<>'sending' and not exists(select 1 from public.automation_cleaner_jobs
   where send_id=old.id and state='attempting' and attempt_id::text=current_setting('helm.cleaner_claim',true)) then
   raise exception 'Cleaner message requires durable claim'; end if;
 if new.status='sent' and (new.provider_message_id is not null or exists(select 1 from public.automation_cleaner_jobs
   where send_id=old.id and state not in ('accepted','delivered','undelivered'))) then
   raise exception 'Every cleaner acceptance receipt is required'; end if;
 return new;
end;
$$;
create trigger automation_cleaner_guard before update on public.automation_sends
for each row execute function public.automation_cleaner_guard();

create function public.automation_cleaner_snapshot(p_job_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('jobId',j.id,'sendId',j.send_id,'propertyId',g.property_id,'status',s.status,
 'state',j.state,'attemptId',j.attempt_id,'providerMessageId',j.provider_message_id,'from',g.from_number,'to',j.to_number,
 'bodySha256',j.body_sha256,'revision',public.automation_cleaner_context(j.id),
 'fireAt',public.automation_cleaner_schedule(j.send_id),'renderAt',statement_timestamp(),
 'body',case when j.state='prepared' then r.body else null end,
 'input',case when j.state='prepared' then public.automation_channex_render_input(j.send_id) else null end)
 from public.automation_cleaner_jobs j join public.automation_cleaner_batches g on g.send_id=j.send_id
 join public.automation_sends s on s.id=j.send_id join public.message_automations r on r.id=s.automation_id where j.id=p_job_id;
$$;
create function public.automation_cleaner_refresh(p_job_id uuid,p_revision text,p_fire_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare g public.automation_cleaner_batches%rowtype; s public.automation_sends%rowtype; b public.bookings%rowtype;
begin
 select bg.* into g from public.automation_cleaner_batches bg join public.automation_cleaner_jobs j on j.send_id=bg.send_id where j.id=p_job_id;
 if not found then return false; end if;
 select * into b from public.bookings where id=g.booking_id for update;
 select * into s from public.automation_sends where id=g.send_id for update;
 select * into g from public.automation_cleaner_batches where send_id=g.send_id for update;
 if s.status not in ('scheduled','held','sending') or b.status is distinct from 'confirmed' or b.duplicate_of is not null
   or b.property_id<>g.property_id or p_revision is distinct from public.automation_cleaner_context(p_job_id)
   or p_fire_at is null or p_fire_at is distinct from public.automation_cleaner_schedule(g.send_id)
   or p_fire_at<=g.prepared_at or p_fire_at>=g.expires_at or g.expires_at<=clock_timestamp()
   or (p_fire_at is distinct from g.fire_at and (p_fire_at<=clock_timestamp() or exists(select 1 from public.automation_cleaner_jobs where send_id=g.send_id and state<>'prepared')))
 then return false; end if;
 update public.automation_cleaner_batches set fire_at=p_fire_at where send_id=g.send_id;
 update public.automation_sends set fire_at=p_fire_at,planned_check_in=b.check_in,planned_check_out=b.check_out,
 updated_at=clock_timestamp() where id=g.send_id;
 return true;
end;
$$;
create function public.automation_cleaner_claim(p_job_id uuid,p_attempt_id uuid,p_revision text,p_fire_at timestamptz,p_target jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.automation_cleaner_jobs%rowtype; g public.automation_cleaner_batches%rowtype;
 s public.automation_sends%rowtype; b public.bookings%rowtype; p public.properties%rowtype; r public.message_automations%rowtype;
begin
 select * into j from public.automation_cleaner_jobs where id=p_job_id;
 if not found or p_attempt_id is null or p_target is null or (p_target->>'bodySha256') is null
   or (p_target->>'bodySha256') !~ '^[a-f0-9]{64}$' then return false; end if;
 select * into g from public.automation_cleaner_batches where send_id=j.send_id;
 select * into b from public.bookings where id=g.booking_id for update;
 select * into s from public.automation_sends where id=g.send_id for update;
 select * into g from public.automation_cleaner_batches where send_id=j.send_id for update;
 select * into j from public.automation_cleaner_jobs where id=p_job_id for update;
 select * into p from public.properties where id=g.property_id for share;
 select * into r from public.message_automations where id=s.automation_id for share;
 perform 1 from public.cleaner_schedule_recipients c where public.automation_cleaner_phone(c.phone)=j.to_number for share;
 if j.state<>'prepared' or not g.enabled or s.status not in ('scheduled','sending') or s.delivery_used is distinct from 'quo_cleaner'
   or b.status is distinct from 'confirmed' or b.duplicate_of is not null or b.property_id<>g.property_id
   or b.check_in is distinct from s.planned_check_in or b.check_out is distinct from s.planned_check_out
   or s.sent_at is not null or s.provider_message_id is not null or p_fire_at is null
   or p_fire_at is distinct from g.fire_at or p_fire_at is distinct from s.fire_at or p_fire_at>clock_timestamp()
   or g.expires_at<=clock_timestamp() or g.source_evidence_at>g.prepared_at
   or p_fire_at is distinct from public.automation_cleaner_schedule(g.send_id)
   or p_revision is distinct from public.automation_cleaner_context(j.id)
   or p.automations_enabled is distinct from true or p.calendar_authority is distinct from 'helm'
   or r.id is null or r.enabled is distinct from true or r.audience is distinct from 'cleaner'
   or r.send_mode is distinct from 'auto' or r.configured_in_ota is distinct from false
   or r.trigger is distinct from (case g.workflow when 'cleaner_advance' then 'pre_arrival' else 'checkin_day' end)
   or r.key is distinct from g.automation_key or (r.property_id is not null and r.property_id<>g.property_id)
   or b.channel is null or lower(b.channel::text)=any(select lower(x) from unnest(r.channel_exclusions) x)
   or (r.min_nights is not null and b.check_out-b.check_in<r.min_nights)
   or exists(select 1 from public.message_automations o where r.property_id is null and o.property_id=g.property_id and o.key=r.key)
   or exists(select 1 from public.automation_sends o where o.booking_id=g.booking_id and o.automation_key=g.automation_key and o.id<>s.id)
   or (select count(*) from public.cleaner_schedule_recipients c where public.automation_cleaner_phone(c.phone)=j.to_number
      and c.enabled and (g.property_id=any(c.property_ids) or (cardinality(c.property_ids)=0
      and coalesce(c.region,'cape_ann')=coalesce(to_jsonb(p)->>'region','cape_ann'))))<>1
   or p_target is distinct from jsonb_build_object('from',g.from_number,'to',j.to_number,'bodySha256',p_target->>'bodySha256')
 then return false; end if;
 update public.automation_cleaner_jobs set state='attempting',attempt_id=p_attempt_id,attempted_at=clock_timestamp(),
 context_revision=p_revision,body_sha256=p_target->>'bodySha256' where id=j.id;
 perform set_config('helm.cleaner_claim',p_attempt_id::text,true);
 update public.automation_sends set status='sending',updated_at=clock_timestamp() where id=s.id;
 return true;
end;
$$;
create function public.automation_cleaner_finish(p_job_id uuid,p_attempt_id uuid,p_state text,p_provider_id text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.automation_cleaner_jobs%rowtype; g public.automation_cleaner_batches%rowtype;
begin
 select * into j from public.automation_cleaner_jobs where id=p_job_id;
 if not found then return false; end if;
 select * into g from public.automation_cleaner_batches where send_id=j.send_id;
 perform 1 from public.bookings where id=g.booking_id for update;
 perform 1 from public.automation_sends where id=g.send_id for update;
 perform 1 from public.automation_cleaner_batches where send_id=g.send_id for update;
 select * into j from public.automation_cleaner_jobs where id=p_job_id for update;
 if p_attempt_id is null or j.attempt_id is distinct from p_attempt_id or p_state is null
   or p_state not in ('unknown','rejected','accepted','delivered','undelivered')
   or ((p_state in ('accepted','delivered','undelivered'))<>(p_provider_id is not null))
   or (p_provider_id is not null and p_provider_id !~ '^[A-Za-z0-9_-]{1,128}$') then return false; end if;
 if j.state=p_state then return j.provider_message_id is not distinct from p_provider_id; end if;
 if (p_state in ('delivered','undelivered') and (j.state<>'accepted' or j.provider_message_id is distinct from p_provider_id))
   or (p_state not in ('delivered','undelivered') and j.state<>'attempting') then return false; end if;
 update public.automation_cleaner_jobs set state=p_state,provider_message_id=p_provider_id,
 finished_at=coalesce(finished_at,clock_timestamp()),
 receipt_at=case when p_state in ('delivered','undelivered') then clock_timestamp() else receipt_at end where id=j.id;
 -- Acceptance and delivery remain separate. Do not choose one recipient's ID as
 -- the receipt for the entire group. Cancellation after claim remains cancelled.
 if not exists(select 1 from public.automation_cleaner_jobs where send_id=g.send_id and state in ('prepared','attempting')) then
   if not exists(select 1 from public.automation_cleaner_jobs where send_id=g.send_id and state in ('unknown','rejected')) then
     update public.automation_sends set status='sent',sent_at=coalesce(sent_at,clock_timestamp()),updated_at=clock_timestamp(),
       error=case when exists(select 1 from public.automation_cleaner_jobs where send_id=g.send_id and state='undelivered')
         then 'Cleaner delivery failed; review recipient receipt; do not resend' else null end where id=g.send_id and status='sending';
   else
     update public.automation_sends set status='failed',updated_at=clock_timestamp(),error='Cleaner outcome requires review; do not resend'
       where id=g.send_id and status='sending';
   end if;
 end if;
 if p_state='undelivered' then
   update public.automation_sends set error='Cleaner delivery failed; review recipient receipt; do not resend',
     updated_at=clock_timestamp() where id=g.send_id and status='sent';
 end if;
 return true;
end;
$$;
create function public.automation_cleaner_candidates(p_property_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(q.id),'[]'::jsonb) from (
 select j.id from public.automation_cleaner_jobs j join public.automation_cleaner_batches g on g.send_id=j.send_id
 join public.automation_sends s on s.id=j.send_id where g.property_id=p_property_id
 and (j.state='accepted' or (j.state='prepared' and g.enabled and s.status in ('scheduled','held','sending')
     and (g.fire_at<=statement_timestamp() or g.fire_at is distinct from public.automation_cleaner_schedule(g.send_id)))
   or (j.state='attempting' and j.attempted_at<statement_timestamp()-interval '5 minutes'))
 order by j.last_checked_at nulls first,g.fire_at,j.id limit 10) q;
$$;
create function public.automation_cleaner_checked(p_job_id uuid) returns void
language sql security definer set search_path='' as $$
 update public.automation_cleaner_jobs set last_checked_at=clock_timestamp() where id=p_job_id;
$$;
revoke all on function public.automation_cleaner_phone(text),public.automation_cleaner_schedule(uuid),
 public.automation_cleaner_context(uuid),public.automation_cleaner_register(),public.automation_cleaner_seed(),
 public.automation_cleaner_identity_guard(),public.automation_cleaner_guard(),public.automation_cleaner_snapshot(uuid),
 public.automation_cleaner_refresh(uuid,text,timestamptz),public.automation_cleaner_claim(uuid,uuid,text,timestamptz,jsonb),
 public.automation_cleaner_finish(uuid,uuid,text,text),public.automation_cleaner_candidates(text),public.automation_cleaner_checked(uuid)
 from public,anon,authenticated;
grant execute on function public.automation_cleaner_snapshot(uuid),public.automation_cleaner_refresh(uuid,text,timestamptz),
 public.automation_cleaner_claim(uuid,uuid,text,timestamptz,jsonb),public.automation_cleaner_finish(uuid,uuid,text,text),
 public.automation_cleaner_candidates(text),public.automation_cleaner_checked(uuid) to service_role;
commit;
