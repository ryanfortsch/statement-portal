-- Candidate isolated-staging maintenance. Install after planning, window and capacity.
-- The trusted TypeScript service replays/validates quiescence and request bindings.
-- SQL binds that proof to the EXACT paused journal and source versions under locks;
-- it is not a second queue interpreter. No rotation runs automatically.
begin;
create schema if not exists helm_inventory_history;
revoke all on schema helm_inventory_history from public,anon,authenticated,service_role;
create table if not exists helm_inventory_history.archives (
 property_id text not null references public.helm_booking_inventory_consumers(property_id),
 id text not null check(id ~ '^[a-f0-9]{64}$'),
 archive_text text not null, checkpoint jsonb not null,
 created_at timestamptz not null default now(), primary key(property_id,id)
);
create table if not exists helm_inventory_history.identities (
 property_id text not null, kind text not null check(kind in ('intent','task')), identity text not null,
 archive_id text not null, primary key(property_id,kind,identity),
 foreign key(property_id,archive_id) references helm_inventory_history.archives(property_id,id)
);
alter table helm_inventory_history.archives enable row level security;
alter table helm_inventory_history.identities enable row level security;
revoke all on all tables in schema helm_inventory_history from public,anon,authenticated,service_role;
-- The absolute CAS version never resets; each segment remains capped at 10,000.
alter table public.helm_booking_inventory_consumers drop constraint if exists helm_booking_inventory_consumers_journal_version_check;
alter table public.helm_booking_inventory_consumers add constraint helm_booking_inventory_consumers_journal_version_check
 check(journal_version between 0 and 9007199254740991);

create or replace function public.helm_booking_inventory_append_internal(p_property text,expected_journal bigint,next_journal jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare prior jsonb; count_before integer; base bigint; command jsonb;
begin
 select journal into prior from public.helm_booking_inventory_consumers
 where property_id=p_property and journal_version=expected_journal for update;
 if not found then return false; end if;
 if jsonb_typeof(next_journal->'commands') is distinct from 'array'
   or prior->'format' not in ('1'::jsonb,'2'::jsonb)
   or next_journal-'commands' is distinct from prior-'commands'
 then raise exception 'Inventory checkpoint rewrite refused'; end if;
 count_before := jsonb_array_length(prior->'commands');
 base := case when prior->'format'='2'::jsonb then (prior->>'baseVersion')::bigint else 0 end;
 if expected_journal<>base+count_before or expected_journal>=9007199254740991 or count_before>=10000
   or jsonb_array_length(next_journal->'commands')<>count_before+1
 then raise exception 'Expected one appended command'; end if;
 if exists(select 1 from jsonb_array_elements(prior->'commands') with ordinality e(value,idx)
   where next_journal->'commands'->((idx-1)::integer) is distinct from value)
 then raise exception 'Inventory history rewrite refused'; end if;
 command := next_journal->'commands'->count_before;
 if count_before>=9990 and command->>'kind' in ('enqueue','retire-pending','claim','dispatch')
 then raise exception 'inventory_history_capacity'; end if;
 if prior->'format'='2'::jsonb then
  if command->>'kind'='enqueue' and (
    command->'intent'->'property' is distinct from prior->'retired'->'property' or
    command->'intent'->'connection' is distinct from prior->'retired'->'connection' or
    command->'intent'->'generation' is distinct from prior->'retired'->'generation' or
    coalesce((command->'intent'->>'version')::bigint,0)<=(prior->'retired'->>'version')::bigint)
  then raise exception 'Archived inventory version cannot be reused'; end if;
  if command->>'kind'='dispatch' and coalesce((command->>'now')::bigint,0)<(prior->>'resumeAfter')::bigint
  then raise exception 'Archived inventory pacing is still active'; end if;
 end if;
 if exists(select 1 from helm_inventory_history.identities i where i.property_id=p_property and
   ((command->>'kind'='enqueue' and i.kind='intent' and i.identity=command->'intent'->>'id') or
    (command->>'kind'='accepted' and i.kind='task' and i.identity=lower(command->>'task'))))
 then raise exception 'Archived inventory identity cannot be reused'; end if;
 update public.helm_booking_inventory_consumers set journal_version=journal_version+1,journal=next_journal where property_id=p_property;
 return true;
end $$;
revoke all on function public.helm_booking_inventory_append_internal(text,bigint,jsonb) from public,anon,authenticated,service_role;

create or replace function public.helm_booking_inventory_archive(p_property text,expected_capture bigint,
 expected_configuration bigint,expected_plan bigint,expected_journal bigint,expected_inputs jsonb,
 archive_text text,next_journal jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.helm_inventory_capture_scopes; c public.helm_booking_inventory_consumers;
 a jsonb; retired jsonb; digest text; resume_after bigint; base bigint;
begin
 if p_property is distinct from 'HELMTEST-calderwood' then return false; end if;
 select * into s from public.helm_inventory_capture_scopes where property_id=p_property for share;
 if not found or s.version is distinct from expected_capture then return false; end if;
 select * into c from public.helm_booking_inventory_consumers where property_id=p_property for update;
 if not found or c.configuration_version is distinct from expected_configuration or c.plan_version is distinct from expected_plan
   or c.journal_version is distinct from expected_journal or expected_journal>=9007199254740991
   or expected_inputs is distinct from public.helm_booking_inventory_inputs(p_property) then return false; end if;
 if c.configuration->>'environment' is distinct from 'staging' or c.configuration->>'topology' is distinct from 'single-unit'
   or c.configuration->>'connection' is distinct from 'calderwood-hosted-inventory'
   or c.configuration->>'listing' is distinct from 'f795ae2c-f47d-4751-86ff-e883b6d30800'
   or c.configuration->'generation' is distinct from '1'::jsonb
   or c.configuration->'publishEnabled' is distinct from 'false'::jsonb
   or c.configuration->>'timeZone' is distinct from 'America/New_York'
 then return false; end if;
 if jsonb_array_length(c.journal->'commands')=0 then return false; end if;
 base := case when c.journal->'format'='2'::jsonb then (c.journal->>'baseVersion')::bigint else 0 end;
 if expected_journal<>base+jsonb_array_length(c.journal->'commands') then raise exception 'Inventory version mismatch'; end if;
 resume_after := greatest(coalesce((c.journal->>'resumeAfter')::bigint,0),coalesce((select max(case
   when v->>'kind'='dispatch' then (v->>'now')::bigint+6000
   when v->>'kind'='rejected' and v->>'failure'='retryable' then (v->>'now')::bigint+greatest(60000,(v->>'retryAfterMs')::bigint)
   else 0 end) from jsonb_array_elements(c.journal->'commands') v),0));
 retired := jsonb_build_object('property',p_property,'connection',c.configuration->'connection','generation',1,'version',c.plan_version);
 a := archive_text::jsonb; digest := encode(sha256(convert_to(archive_text,'UTF8')),'hex');
 if a is distinct from jsonb_build_object('format',1,'property',p_property,'fromVersion',base,'toVersion',expected_journal,
     'journal',c.journal,'retired',retired,'resumeAfter',resume_after)
   or next_journal is distinct from jsonb_build_object('format',2,'baseVersion',expected_journal+1,'archiveId',digest,
     'retired',retired,'resumeAfter',resume_after,'commands','[]'::jsonb)
 then raise exception 'Archive must preserve exact history and checkpoint'; end if;
 if c.journal->'format'='2'::jsonb and not exists(select 1 from helm_inventory_history.archives h
   where h.property_id=p_property and h.id=c.journal->>'archiveId' and h.checkpoint=c.journal-'commands'||'{"commands":[]}'::jsonb)
 then raise exception 'Previous archive missing'; end if;
 insert into helm_inventory_history.archives(property_id,id,archive_text,checkpoint) values(p_property,digest,archive_text,next_journal);
 insert into helm_inventory_history.identities(property_id,kind,identity,archive_id)
 select p_property,kind,identity,digest from (
   select distinct 'intent' kind,v->'intent'->>'id' identity from jsonb_array_elements(c.journal->'commands') v where v->>'kind'='enqueue'
   union select distinct 'task',lower(v->>'task') from jsonb_array_elements(c.journal->'commands') v where v->>'kind'='accepted'
 ) ids;
 -- A rotation itself advances CAS. Retain the desired version and invalidate the
 -- plan so an old lease/context cannot authorize a fresh send after maintenance.
 update public.helm_booking_inventory_consumers set journal=next_journal,journal_version=expected_journal+1,
   planned_inputs=null,last_digest=null,planned_fresh_until=0 where property_id=p_property;
 return true;
end $$;
create or replace function public.helm_booking_inventory_archive_read(p_property text,p_id text)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('id',id,'text',archive_text,'next',checkpoint) from helm_inventory_history.archives
 where property_id=p_property and id=p_id and p_property='HELMTEST-calderwood'
$$;
revoke all on function public.helm_booking_inventory_archive(text,bigint,bigint,bigint,bigint,jsonb,text,jsonb),
 public.helm_booking_inventory_archive_read(text,text) from public,anon,authenticated,service_role;
grant execute on function public.helm_booking_inventory_archive(text,bigint,bigint,bigint,bigint,jsonb,text,jsonb),
 public.helm_booking_inventory_archive_read(text,text) to service_role;

-- Compatible absolute-version RPC; all existing source/authority checks retained.
create or replace function public.helm_booking_inventory_plan_commit(p_property text,expected_capture bigint,
 expected_configuration bigint,expected_plan bigint,expected_journal bigint,expected_inputs jsonb,
 next_journal jsonb,fresh_until bigint,desired_digest text)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.helm_inventory_capture_scopes; c public.helm_booking_inventory_consumers;
 command jsonb; payload jsonb; stamp bigint;
begin
 if expected_capture is null or expected_capture<1 or expected_configuration is null or expected_configuration<1
    or expected_plan is null or expected_plan<0 or expected_journal is null or expected_journal<0
 then raise exception 'Invalid planning expectation'; end if;
 -- Same lock order in both planning and dispatch: capture scope, then consumer.
 select * into s from public.helm_inventory_capture_scopes where property_id=p_property for share;
 if not found or not s.enabled or s.version<>expected_capture then return false; end if;
 select * into c from public.helm_booking_inventory_consumers where property_id=p_property for update;
 if not found or c.configuration_version<>expected_configuration or c.plan_version<>expected_plan
    or c.journal_version<>expected_journal then return false; end if;
 stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if fresh_until is null or fresh_until<=stamp or fresh_until>stamp+60000 then return false; end if;
 if expected_inputs is distinct from public.helm_booking_inventory_inputs(p_property) then return false; end if;
 command := next_journal->'commands'->(jsonb_array_length(next_journal->'commands')-1); payload := command->'intent';
 if c.configuration->>'environment' is distinct from 'staging' or c.configuration->>'topology' is distinct from 'single-unit'
    or command->>'kind' is distinct from 'enqueue' or jsonb_typeof(payload) is distinct from 'object'
    or payload - array['id','environment','connection','property','generation','version','days'] <> '{}'::jsonb
    or payload->>'environment' is distinct from 'staging'
    or payload->>'property' is distinct from p_property or payload->'connection' is distinct from c.configuration->'connection'
    or payload->'generation' is distinct from c.configuration->'generation'
    or payload->'version' is distinct from to_jsonb(expected_plan+1)
 then raise exception 'Planning identity mismatch'; end if;
 if desired_digest is null or desired_digest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid inventory digest'; end if;
 if jsonb_typeof(payload->'days') is distinct from 'array' then raise exception 'Invalid inventory days'; end if;
 if jsonb_array_length(payload->'days') <> (c.configuration->>'end')::date-(c.configuration->>'start')::date
    or jsonb_array_length(payload->'days') not between 1 and 366 then raise exception 'Incomplete inventory window'; end if;
 if exists(select 1 from jsonb_array_elements(payload->'days') with ordinality d(value,idx)
    where jsonb_typeof(value) is distinct from 'object' or not (value ?& array['date','available','stopSell'])
      or value - array['date','available','stopSell'] <> '{}'::jsonb
      or value->>'date' is distinct from (((c.configuration->>'start')::date+(idx-1)::integer)::text)
      or value->'available' not in ('0'::jsonb,'1'::jsonb)
      or value->'stopSell' is distinct from to_jsonb(value->'available'='0'::jsonb))
 then raise exception 'Invalid availability-only payload'; end if;
 if jsonb_typeof(c.configuration->'coverage') is distinct from 'array' then return false; end if;
 if jsonb_array_length(c.configuration->'coverage')=0 or exists(select 1 from jsonb_array_elements(c.configuration->'coverage') v
   where v->'complete' is distinct from 'true'::jsonb or (v->>'freshUntil') is null or (v->>'freshUntil')::bigint<fresh_until)
 then return false; end if;
 if not public.helm_booking_inventory_append_internal(p_property,expected_journal,next_journal) then return false; end if;
 update public.helm_booking_inventory_consumers set planned_capture_version=expected_capture,
  planned_configuration_version=expected_configuration,plan_version=expected_plan+1,planned_inputs=expected_inputs,
  last_digest=desired_digest,planned_fresh_until=fresh_until where property_id=p_property;
 return true;
end $$;

-- Compatible absolute-version RPC; all existing source/authority checks retained.
create or replace function public.helm_booking_inventory_journal_append(p_property text,expected_journal bigint,next_journal jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.helm_booking_inventory_consumers; s public.helm_inventory_capture_scopes; command jsonb; ctx jsonb; stamp bigint;
begin
 select * into s from public.helm_inventory_capture_scopes where property_id=p_property for share;
 if not found then return false; end if;
 select * into c from public.helm_booking_inventory_consumers where property_id=p_property for update;
 if not found or c.journal_version<>expected_journal then return false; end if;
 command := next_journal->'commands'->(jsonb_array_length(next_journal->'commands')-1);
 if command->>'kind' is null or command->>'kind' not in ('claim','dispatch','accepted','ambiguous','rejected','expire','reconcile')
 then raise exception 'Use the atomic planning boundary for enqueue'; end if;
 if command->>'kind'='dispatch' then
  ctx := command->'context'; stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if not s.enabled or s.version<>c.planned_capture_version or c.configuration_version<>c.planned_configuration_version
     or c.planned_fresh_until<=stamp or c.planned_inputs is distinct from public.helm_booking_inventory_inputs(p_property)
     or c.configuration->'publishEnabled' is distinct from 'true'::jsonb
     or c.planned_inputs->>'authority' is distinct from 'helm'
     or ctx->>'environment' is distinct from 'staging' or ctx->>'property' is distinct from p_property
     or ctx->'connection' is distinct from c.configuration->'connection' or ctx->'generation' is distinct from c.configuration->'generation'
     or ctx->'version' is distinct from to_jsonb(c.plan_version) or ctx->>'digest' is distinct from c.last_digest
     or ctx->>'authority' is distinct from 'helm' or ctx->'enabled' is distinct from 'true'::jsonb
     or ctx->'complete' is distinct from 'true'::jsonb or (ctx->>'freshUntil') is null
     or (ctx->>'freshUntil')::bigint<=stamp or (ctx->>'freshUntil')::bigint>c.planned_fresh_until
  then return false; end if;
 end if;
 return public.helm_booking_inventory_append_internal(p_property,expected_journal,next_journal);
end $$;

-- Compatible absolute-version RPC; all existing source/authority checks retained.
create or replace function public.helm_booking_inventory_window_advance(
 p_property text, expected_capture bigint, expected_configuration bigint,
 expected_plan bigint, expected_journal bigint, expected_inputs jsonb,
 next_start date, next_end date, next_journal jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.helm_inventory_capture_scopes; c public.helm_booking_inventory_consumers;
 stamp bigint; today date; cfg jsonb; cover jsonb; buffer_days integer; command jsonb;
begin
 -- The only installed pilot route, never a general production window editor.
 if p_property is distinct from 'HELMTEST-calderwood' then return false; end if;
 select * into s from public.helm_inventory_capture_scopes where property_id=p_property for share;
 if not found or not s.enabled or s.version is distinct from expected_capture or s.version<1 then return false; end if;
 select * into c from public.helm_booking_inventory_consumers where property_id=p_property for update;
 if not found or c.configuration_version is distinct from expected_configuration
   or c.plan_version is distinct from expected_plan or c.journal_version is distinct from expected_journal
   or expected_inputs is distinct from public.helm_booking_inventory_inputs(p_property) then return false; end if;
 cfg := c.configuration;
 stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
 today := (clock_timestamp() at time zone 'America/New_York')::date;
 if cfg->>'environment' is distinct from 'staging' or cfg->>'topology' is distinct from 'single-unit'
   or cfg->>'connection' is distinct from 'calderwood-hosted-inventory'
   or cfg->>'listing' is distinct from 'f795ae2c-f47d-4751-86ff-e883b6d30800'
   or cfg->'generation' is distinct from '1'::jsonb or cfg->'publishEnabled' is distinct from 'true'::jsonb
   or cfg->>'timeZone' is distinct from 'America/New_York'
   or expected_inputs->>'authority' is distinct from 'helm'
   or expected_inputs->'plan'->'booking_window_days' is distinct from '365'::jsonb
   or next_start is distinct from today or next_end is distinct from today+366
   or (cfg->>'start')::date is distinct from today-1 or (cfg->>'end')::date is distinct from today+365
   or cfg->'requiredSources' is null or cfg->'requiredSources' not in ('["synthetic-canonical"]'::jsonb,'["channex-staging-bookings"]'::jsonb)
   or jsonb_typeof(cfg->'coverage') is distinct from 'array' then return false; end if;
 if jsonb_array_length(cfg->'coverage')<>1 then return false; end if;
 cover := cfg->'coverage'->0;
 buffer_days := (expected_inputs->'plan'->>'turnover_buffer_days')::integer;
 if buffer_days is null or buffer_days not between 0 and 30
   or cover->>'source' is distinct from (cfg->'requiredSources'->>0) or cover->'complete' is distinct from 'true'::jsonb
   or (cover->>'start') is null or (cover->>'end') is null
   or (cover->>'start')::date > today-buffer_days or (cover->>'end')::date < next_end+buffer_days
   or (cover->>'end')::date-(cover->>'start')::date not between 1 and 426
   or (cover->>'observedAt') is null or (cover->>'freshUntil') is null
   or (cover->>'observedAt')::bigint>stamp or (cover->>'freshUntil')::bigint<=stamp
   or (cover->>'freshUntil')::bigint-(cover->>'observedAt')::bigint not between 1 and 3600000
 then return false; end if;
 command := next_journal->'commands'->(jsonb_array_length(next_journal->'commands')-1);
 if command is distinct from jsonb_build_object('kind','retire-pending','connection',cfg->>'connection',
     'property',p_property,'generation',cfg->'generation') then raise exception 'Invalid window retirement'; end if;
 if not public.helm_booking_inventory_append_internal(p_property,expected_journal,next_journal) then return false; end if;
 -- Both history and window commit together. The existing guard increments the
 -- configuration version, invalidating every old plan/dispatch context.
 update public.helm_booking_inventory_consumers
 set configuration=jsonb_set(jsonb_set(configuration,'{start}',to_jsonb(next_start::text)),'{end}',to_jsonb(next_end::text))
 where property_id=p_property;
 return true;
end $$;

revoke all on function public.helm_booking_inventory_plan_commit(text,bigint,bigint,bigint,bigint,jsonb,jsonb,bigint,text),
 public.helm_booking_inventory_journal_append(text,bigint,jsonb),
 public.helm_booking_inventory_window_advance(text,bigint,bigint,bigint,bigint,jsonb,date,date,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.helm_booking_inventory_plan_commit(text,bigint,bigint,bigint,bigint,jsonb,jsonb,bigint,text),
 public.helm_booking_inventory_journal_append(text,bigint,jsonb),
 public.helm_booking_inventory_window_advance(text,bigint,bigint,bigint,bigint,jsonb,date,date,jsonb) to service_role;
commit;
