-- Candidate: explicit isolated-staging installation. No automatic enablement.
begin;
create or replace function public.helm_inventory_support_resolution(p_property text, expected_version bigint, expected_retry_revision bigint, next_journal jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.helm_booking_inventory_consumers; cmd jsonb; retry jsonb; dispatch jsonb; n integer; stamp bigint;
begin
 select * into c from public.helm_booking_inventory_consumers where property_id=p_property for update;
 if not found or p_property !~ '^HELMTEST-[a-z0-9-]{1,100}$' or c.journal_version<>expected_version
   or c.configuration->'publishEnabled' is distinct from 'false'::jsonb
   or c.configuration->>'environment' is distinct from 'staging'
 then return false; end if;
 if expected_retry_revision is distinct from (select coalesce(max(revision),0) from public.helm_inventory_retry_events where property_id=p_property)
 then return false; end if;
 n:=jsonb_array_length(c.journal->'commands'); cmd:=next_journal->'commands'->n;
 stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if cmd is null or not(cmd ?& array['kind','id','token','requestDigest','supportMessage','retryId','retryTask','reviewedBy','reason','now'])
   or exists(select 1 from jsonb_each(cmd) e where e.value='null'::jsonb)
   or jsonb_typeof(cmd->'now') is distinct from 'number'
   or cmd->>'kind' is distinct from 'retire-not-received'
   or cmd->>'reason' is distinct from 'provider-asserted-non-receipt'
   or coalesce(cmd->>'supportMessage','') !~ '^[a-f0-9]{16}$'
   or coalesce(cmd->>'reviewedBy','') !~ '^[^@[:space:]]+@[^@[:space:]]+$'
   or (cmd->>'now')::bigint not between stamp-60000 and stamp
 then raise exception 'Fresh explicit support disposition required'; end if;
 select record into retry from public.helm_inventory_retry_events where property_id=p_property and retry_id=cmd->>'retryId' order by revision desc limit 1;
 if retry is null or retry->>'outcome' is distinct from 'verified' or retry->'job'->>'status' is distinct from 'verified'
   or retry->>'originalId' is distinct from cmd->>'id' or retry->>'originalToken' is distinct from cmd->>'token'
   or retry->'originalJournalVersion' is distinct from to_jsonb(expected_version)
   or retry->'job'->>'task' is distinct from cmd->>'retryTask'
   or retry->'job'->'receipt'->>'requestDigest' is distinct from cmd->>'requestDigest'
   or retry->'job'->'request'->>'digest' is distinct from cmd->>'requestDigest'
   or retry->'job'->>'property' is distinct from p_property
   or retry->'job'->'connection' is distinct from c.configuration->'connection'
   or retry->'job'->'generation' is distinct from c.configuration->'generation'
 then raise exception 'Verified matching recovery required'; end if;
 select value into dispatch from jsonb_array_elements(c.journal->'commands') with ordinality e(value,idx)
 where value->>'kind'='dispatch' and value->>'id'=cmd->>'id' and value->>'token'=cmd->>'token' order by idx desc limit 1;
 if dispatch is null or dispatch->'request'->>'digest' is distinct from cmd->>'requestDigest'
   or dispatch->'request'->>'body' is distinct from retry->'job'->'request'->>'body'
   or exists(select 1 from jsonb_array_elements(c.journal->'commands') e
     where e->>'id'=cmd->>'id' and e->>'token'=cmd->>'token' and e->>'kind' in ('accepted','rejected','reconcile','retire-not-received'))
 then raise exception 'Original unreceipted attempt changed'; end if;
 return public.helm_booking_inventory_append_internal(p_property,expected_version,next_journal);
end $$;
revoke all on function public.helm_inventory_support_resolution(text,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.helm_inventory_support_resolution(text,bigint,bigint,jsonb) to service_role;
commit;
