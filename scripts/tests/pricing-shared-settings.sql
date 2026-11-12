\set ON_ERROR_STOP on
-- Disposable database only; no application schema, credentials or customer records.
do $$begin
  if current_database()<>'helm_synthetic_pricing_settings' then raise exception 'synthetic_database_required'; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
\ir ../../supabase/migrations/20261112190000_helm_pricing_shared_drafts.sql
create function pg_temp.check_true(value boolean) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'assertion failed'; end if; end$$;
select pg_temp.check_true((select bool_and(relrowsecurity) from pg_class where oid in ('helm_pricing_drafts'::regclass,'helm_pricing_draft_versions'::regclass)));
do $$declare r text; t text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    foreach t in array array['helm_pricing_drafts','helm_pricing_draft_versions'] loop
      if has_table_privilege(r,t,'INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'direct write privilege'; end if;
      if r<>'service_role' and has_table_privilege(r,t,'SELECT') then raise exception 'unprivileged read'; end if;
    end loop;
    if has_function_privilege(r,'helm_save_pricing_drafts(jsonb,integer,uuid,text)','EXECUTE')<>(r='service_role') then raise exception 'RPC privilege'; end if;
  end loop;
end$$;
set role service_role;
select helm_save_pricing_drafts('{"version":1,"homes":{},"groups":[]}',0,'00000000-0000-4000-8000-000000000001','owner@synthetic.test');
reset role;
select pg_temp.check_true((select revision=1 from helm_pricing_drafts));
select pg_temp.check_true((select count(*)=1 from helm_pricing_draft_versions));
-- Conflicts and request reuse are rejected without modifying either table.
do $$begin
  begin perform helm_save_pricing_drafts('{"version":1,"homes":{},"groups":[]}',0,'00000000-0000-4000-8000-000000000002','owner@synthetic.test');raise exception 'stale write accepted';exception when serialization_failure then null;end;
  begin perform helm_save_pricing_drafts('{"version":1,"homes":{"changed":{}},"groups":[]}',0,'00000000-0000-4000-8000-000000000001','owner@synthetic.test');raise exception 'request reuse accepted';exception when invalid_parameter_value then null;end;
  begin perform helm_save_pricing_drafts('{"version":1,"homes":{},"groups":[]}',0,'00000000-0000-4000-8000-000000000001','other@synthetic.test');raise exception 'actor reuse accepted';exception when invalid_parameter_value then null;end;
  begin perform helm_save_pricing_drafts('{"version":1,"homes":{},"groups":[]}',1,'00000000-0000-4000-8000-000000000001','owner@synthetic.test');raise exception 'revision reuse accepted';exception when invalid_parameter_value then null;end;
end$$;
select pg_temp.check_true((select revision=1 from helm_pricing_drafts));
select pg_temp.check_true((select count(*)=1 from helm_pricing_draft_versions));
select helm_save_pricing_drafts('{"version":1,"homes":{},"groups":[{"id":"synthetic"}]}',1,'00000000-0000-4000-8000-000000000002','owner@synthetic.test');
-- Retry after a newer save returns the original receipt without rolling back the newer save.
select pg_temp.check_true((helm_save_pricing_drafts('{"version":1,"homes":{},"groups":[]}',0,'00000000-0000-4000-8000-000000000001','owner@synthetic.test')->>'revision')::int=1);
select pg_temp.check_true((select revision=2 and settings->'groups'='[{"id":"synthetic"}]' from helm_pricing_drafts));
select pg_temp.check_true((select count(*)=2 from helm_pricing_draft_versions));
-- Invalid or oversized envelopes do not create a new version.
do $$declare bad jsonb; begin
 foreach bad in array array[null::jsonb,'[]'::jsonb,'{}'::jsonb,'{"version":2,"homes":{},"groups":[]}'::jsonb,'{"version":1,"homes":[],"groups":[]}'::jsonb,jsonb_build_object('version',1,'homes',jsonb_build_object('oversize',repeat('x',512001)),'groups','[]'::jsonb)] loop
  begin perform helm_save_pricing_drafts(bad,2,'00000000-0000-4000-8000-000000000003','owner@synthetic.test');raise exception 'bad envelope accepted';exception when invalid_parameter_value then null;end;
 end loop;
end$$;
-- A failure after updating the singleton rolls the entire transaction back.
create function public.synthetic_fail_receipt() returns trigger language plpgsql as $$begin raise exception 'synthetic receipt failure';end$$;
create trigger synthetic_fail before insert on helm_pricing_draft_versions for each row execute function synthetic_fail_receipt();
do $$begin
 begin perform helm_save_pricing_drafts('{"version":1,"homes":{},"groups":[]}',2,'00000000-0000-4000-8000-000000000003','owner@synthetic.test');raise exception 'receipt failure ignored';
 exception when raise_exception then if sqlerrm<>'synthetic receipt failure' then raise;end if;end;
end$$;
drop trigger synthetic_fail on helm_pricing_draft_versions;
drop function public.synthetic_fail_receipt();
select pg_temp.check_true((select revision=2 from helm_pricing_drafts));
select pg_temp.check_true((select count(*)=2 from helm_pricing_draft_versions));
