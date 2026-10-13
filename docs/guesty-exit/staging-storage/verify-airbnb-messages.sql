-- Rollback-only synthetic verification on jgkblfozftcvymvwhhii.
begin;
do $$ begin
 if has_table_privilege('anon','public.helm_airbnb_message_state','SELECT')
 or has_table_privilege('authenticated','public.helm_airbnb_message_state','SELECT')
 or has_function_privilege('anon','public.helm_airbnb_save_messages(text,bigint,jsonb)','EXECUTE')
 or has_function_privilege('authenticated','public.helm_airbnb_save_messages(text,bigint,jsonb)','EXECUTE')
 or has_function_privilege('anon','public.helm_airbnb_message_failure(text)','EXECUTE')
 or has_function_privilege('authenticated','public.helm_airbnb_message_failure(text)','EXECUTE')
 then raise exception 'Unexpected client access'; end if;
 if not (select relrowsecurity from pg_class where oid='public.helm_airbnb_message_state'::regclass)
 then raise exception 'RLS missing'; end if;
end $$;
set local role service_role;
do $$ declare v bigint; doc jsonb; begin
 select version into v from public.helm_airbnb_message_state where unit='front';
 doc:='{"version":1,"conversations":[{"thread":{"id":"synthetic","unit":"front"},"messages":[{"id":"m1","text":"synthetic"}]}]}'::jsonb;
 if not public.helm_airbnb_save_messages('front',v,doc) then raise exception 'Save failed'; end if;
 if public.helm_airbnb_save_messages('front',v,doc) then raise exception 'Stale writer accepted'; end if;
 begin
  perform public.helm_airbnb_save_messages('front',v+1,'{"version":1,"conversations":[]}'::jsonb);
  raise exception 'Deletion accepted';
 exception when raise_exception then if sqlerrm <> 'History removal refused' then raise; end if; end;
 perform public.helm_airbnb_message_failure('front');
 if not exists(select 1 from public.helm_airbnb_message_state where unit='front' and version=v+1 and archive=doc and last_success is not null and consecutive_failures=1 and outcome='failure')
 then raise exception 'Failure did not retain history'; end if;
end $$;
rollback;
select 'PASS: restricted access, CAS, history retention and failure state; test rolled back' as verification;
