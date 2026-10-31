-- Candidate only: isolated staging, owner-installed. No seed, provider IO or enablement.
-- Requires inventory-routes.sql and the current inventory consumer/capture schema.
begin;
create table if not exists public.helm_inventory_retry_events (
 property_id text not null references public.helm_booking_inventory_consumers(property_id),
 revision bigint not null check(revision between 1 and 9007199254740991),
 retry_id text not null, record jsonb not null check(jsonb_typeof(record)='object'),
 created_at timestamptz not null default clock_timestamp(),
 primary key(property_id,revision),
 check(property_id ~ '^HELMTEST-[a-z0-9-]{1,100}$')
);
alter table public.helm_inventory_retry_events enable row level security;
revoke all on public.helm_inventory_retry_events from public,anon,authenticated,service_role;
create or replace function public.helm_inventory_retry_immutable()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Recovery history is append only'; end $$;
drop trigger if exists helm_inventory_retry_immutable on public.helm_inventory_retry_events;
create trigger helm_inventory_retry_immutable before update or delete or truncate on public.helm_inventory_retry_events
 for each statement execute function public.helm_inventory_retry_immutable();

create or replace function public.helm_inventory_retry_read(p_property text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('state',public.helm_booking_inventory_read(c.property_id),
 'route',public.helm_staging_inventory_route_read(c.property_id,c.configuration->>'connection',(c.configuration->>'generation')::bigint),
 'revision',coalesce((select max(revision) from public.helm_inventory_retry_events where property_id=c.property_id),0),
 'records',coalesce((select jsonb_agg(record order by retry_id) from
   (select distinct on(retry_id) retry_id,record from public.helm_inventory_retry_events where property_id=c.property_id
    order by retry_id,revision desc) latest),'[]'::jsonb))
 from public.helm_booking_inventory_consumers c where c.property_id=p_property and p_property ~ '^HELMTEST-[a-z0-9-]{1,100}$';
$$;

create or replace function public.helm_inventory_retry_reserve(p_property text,expected jsonb,next_record jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.helm_inventory_capture_scopes; c public.helm_booking_inventory_consumers;
 r public.helm_staging_inventory_routes; j jsonb; old_dispatch jsonb; v jsonb; req jsonb;
 stamp bigint; n bigint; review jsonb; d date;
begin
 select * into s from public.helm_inventory_capture_scopes where property_id=p_property for share;
 if not found or not s.enabled then return false; end if;
 select * into c from public.helm_booking_inventory_consumers where property_id=p_property for update;
 if not found or c.configuration->'publishEnabled' is distinct from 'false'::jsonb
   or c.configuration->>'environment' is distinct from 'staging' or c.configuration->>'topology' is distinct from 'single-unit'
   or public.helm_booking_inventory_inputs(p_property)->>'authority' is distinct from 'helm'
 then return false; end if;
 -- Row locks order with canonical capture writers. Compare the entire source,
 -- journal, configuration, route and recovery snapshot after waiting for locks.
 if expected is distinct from public.helm_inventory_retry_read(p_property) then return false; end if;
 select * into r from public.helm_staging_inventory_routes where property_id=p_property;
 if not found or r.connection is distinct from c.configuration->>'connection'
   or r.generation is distinct from (c.configuration->>'generation')::bigint then return false; end if;
 stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
 j:=next_record->'job'; req:=j->'request'; review:=next_record->'review';
 if next_record is null or not (next_record ?& array['id','originalId','originalToken','originalJournalVersion','review','job','outcome','originalSettled'])
   or j is null or not (j ?& array['id','status','environment','property','connection','generation','version','attempts','token','leaseUntil','dispatchedAt','request','days'])
   or req is null or not (req ?& array['url','method','body','digest','preparedAt','expiresAt'])
   or review is null or not (review ?& array['originalId','originalToken','requestDigest','reviewedBy','reason','reviewedAt','expiresAt'])
   or exists(select 1 from jsonb_each(next_record) e where e.value='null'::jsonb)
   or exists(select 1 from jsonb_each(j) e where e.value='null'::jsonb)
   or exists(select 1 from jsonb_each(req) e where e.value='null'::jsonb)
   or exists(select 1 from jsonb_each(review) e where e.value='null'::jsonb)
 then raise exception 'Incomplete recovery record'; end if;
 if next_record->>'outcome' is distinct from 'submitting' or next_record->'originalSettled' is distinct from 'false'::jsonb
   or j->>'status' is distinct from 'submitting' or j->>'environment' is distinct from 'staging'
   or j->>'property' is distinct from p_property or j->>'connection' is distinct from r.connection
   or j->'generation' is distinct from to_jsonb(r.generation) or j->'attempts' is distinct from '1'::jsonb
   or j->>'id' is distinct from next_record->>'id' or j->>'token' is distinct from (next_record->>'id')||':1'
   or j ? 'task' or j ? 'receipt' or next_record->'originalJournalVersion' is distinct from to_jsonb(c.journal_version)
   or review->>'originalId' is distinct from next_record->>'originalId'
   or review->>'originalToken' is distinct from next_record->>'originalToken'
 then raise exception 'Invalid recovery identity'; end if;
 if (review->>'expiresAt')::bigint <= stamp or (review->>'reviewedAt')::bigint > stamp
   or (review->>'expiresAt')::bigint-(review->>'reviewedAt')::bigint not between 1 and 60000
   or (j->>'leaseUntil')::bigint <= stamp or (j->>'dispatchedAt')::bigint > stamp
   or (j->>'leaseUntil')::bigint > least((req->>'expiresAt')::bigint,(review->>'expiresAt')::bigint)
   or req->>'url' is distinct from 'https://staging.channex.io/api/v1/availability'
   or req->>'method' is distinct from 'POST'
 then return false; end if;
 select value into old_dispatch from jsonb_array_elements(c.journal->'commands') with ordinality e(value,idx)
 where value->>'kind'='dispatch' and value->>'id'=next_record->>'originalId'
   and value->>'token'=next_record->>'originalToken' order by idx desc limit 1;
 if old_dispatch is null or old_dispatch->'request'->>'body' is distinct from req->>'body'
   or old_dispatch->'request'->>'digest' is distinct from req->>'digest'
   or review->>'requestDigest' is distinct from req->>'digest'
   or exists(select 1 from jsonb_array_elements(c.journal->'commands') e where e->>'id'=next_record->>'originalId'
       and e->>'token'=next_record->>'originalToken' and e->>'kind' in ('accepted','rejected','reconcile'))
 then return false; end if;
 if exists(select 1 from public.helm_inventory_retry_events e where e.property_id=p_property
   and (e.retry_id=next_record->>'id' or (e.record->>'originalId'=next_record->>'originalId'
     and e.record->>'originalToken'=next_record->>'originalToken'))) then return false; end if;
 if jsonb_array_length((req->>'body')::jsonb->'values')<>1 or jsonb_array_length(j->'days')<>1
 then raise exception 'Recovery requires one exact original value'; end if;
 v:=(req->>'body')::jsonb->'values'->0; d:=(v->>'date')::date;
 if v->>'property_id' is distinct from r.provider_property_id::text or v->>'room_type_id' is distinct from r.room_type_id::text
   or v->'availability' not in ('0'::jsonb,'1'::jsonb) or j->'days'->0->'date' is distinct from v->'date'
   or j->'days'->0->'available' is distinct from v->'availability'
   or d < (c.configuration->>'start')::date or d >= (c.configuration->>'end')::date
 then return false; end if;
 -- Require complete fresh source coverage for the exact date. The trusted TS
 -- adapter computes canonical availability; snapshot equality fences all inputs.
 if jsonb_array_length(c.configuration->'requiredSources')=0 or exists(
   select 1 from jsonb_array_elements_text(c.configuration->'requiredSources') source where not exists(
    select 1 from jsonb_array_elements(c.configuration->'coverage') cv where cv->>'source'=source
      and cv->'complete'='true'::jsonb and (cv->>'start')::date<=d and (cv->>'end')::date>d
      and (cv->>'freshUntil')::bigint >= (j->>'leaseUntil')::bigint)) then return false; end if;
 n:=coalesce((expected->>'revision')::bigint,0);
 if n>=1000 then raise exception 'Recovery history capacity requires review'; end if;
 insert into public.helm_inventory_retry_events values(p_property,n+1,next_record->>'id',next_record,default);
 return true;
end $$;

create or replace function public.helm_inventory_retry_update(p_property text,expected_revision bigint,prior_record jsonb,next_record jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare prior jsonb; n bigint; old_outcome text; new_outcome text;
begin
 perform 1 from public.helm_booking_inventory_consumers where property_id=p_property for update;
 if not found then return false; end if;
 select coalesce(max(revision),0) into n from public.helm_inventory_retry_events where property_id=p_property;
 if n<>expected_revision then return false; end if;
 select record into prior from public.helm_inventory_retry_events where property_id=p_property
   and retry_id=prior_record->>'id' order by revision desc limit 1;
 if prior is null or prior is distinct from prior_record then return false; end if;
 if next_record is null or next_record->>'outcome' is null or next_record->'job' is null
   then raise exception 'Incomplete recovery update'; end if;
 old_outcome:=prior->>'outcome'; new_outcome:=next_record->>'outcome';
 if prior-array['outcome','job'] is distinct from next_record-array['outcome','job']
   or (prior->'job')-array['status','task','receipt'] is distinct from (next_record->'job')-array['status','task','receipt']
   or not ((old_outcome='submitting' and new_outcome in ('submitted','uncertain','rejected'))
        or (old_outcome='submitted' and new_outcome='verified'))
 then raise exception 'Recovery history rewrite or transition refused'; end if;
 if next_record->'job'->>'status' is distinct from (case new_outcome when 'rejected' then 'needs-review' else new_outcome end)
 then raise exception 'Recovery status mismatch'; end if;
 if new_outcome in ('submitted','verified') then
   if next_record->'job'->>'task' is null or next_record->'job'->'receipt'->>'requestDigest' is distinct from prior->'job'->'request'->>'digest'
     or (next_record->'job'->'receipt'->>'receivedAt')::bigint < (prior->'job'->>'dispatchedAt')::bigint
   then raise exception 'Recovery receipt binding required'; end if;
   perform (next_record->'job'->>'task')::uuid;
   if old_outcome='submitted' and ((prior->'job')-'status') is distinct from ((next_record->'job')-'status')
   then raise exception 'Recovery receipt is immutable'; end if;
   if old_outcome='submitting' and exists(select 1 from public.helm_inventory_retry_events where property_id=p_property
      and retry_id<>prior_record->>'id' and record->'job'->>'task'=next_record->'job'->>'task')
   then raise exception 'Task already bound'; end if;
 else
   if next_record->'job' ? 'task' or next_record->'job' ? 'receipt' then raise exception 'Unexpected recovery receipt'; end if;
 end if;
 if n>=1000 then raise exception 'Recovery history capacity requires review'; end if;
 insert into public.helm_inventory_retry_events values(p_property,n+1,next_record->>'id',next_record,default);
 return true;
end $$;
revoke all on function public.helm_inventory_retry_immutable(),public.helm_inventory_retry_read(text),
 public.helm_inventory_retry_reserve(text,jsonb,jsonb),public.helm_inventory_retry_update(text,bigint,jsonb,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.helm_inventory_retry_read(text),public.helm_inventory_retry_reserve(text,jsonb,jsonb),
 public.helm_inventory_retry_update(text,bigint,jsonb,jsonb) to service_role;
commit;
