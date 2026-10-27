-- Isolated Calderwood staging only: expand source proof to 500 days plus buffers.
-- Does not change configuration, coverage, bookings, publish flags or grants.
begin;
do $upgrade$
declare target regprocedure := to_regprocedure('public.helm_pilot_source_certify(jsonb,jsonb,bigint,date,date)');
 body text; definition text; original_acl aclitem[]; original_owner oid;
begin
 if target is null then raise exception 'Install canonical source certification first'; end if;
 select prosrc,proacl,proowner into body,original_acl,original_owner from pg_proc where oid=target;
 if md5(body)='173c8af5b53200a35e76a9a52dbd2e33' then
   definition := pg_get_functiondef(target);
   execute replace(definition,'p_end-p_start not between 1 and 426','p_end-p_start not between 1 and 560');
 elsif md5(replace(body,'p_end-p_start not between 1 and 560','p_end-p_start not between 1 and 426'))
       <> '173c8af5b53200a35e76a9a52dbd2e33' then
   raise exception 'Unexpected source-certification body; review before upgrade';
 end if;
 if not exists(select 1 from pg_proc where oid=target
   and position('p_end-p_start not between 1 and 560' in prosrc)>0
   and proacl is not distinct from original_acl and proowner=original_owner)
 then raise exception 'Source limit or permissions verification failed'; end if;
end $upgrade$;
commit;
