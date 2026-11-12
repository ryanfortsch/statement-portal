\set ON_ERROR_STOP on
do $$begin
 if current_database()<>'helm_synthetic_pricing_research' then raise exception 'synthetic_database_required';end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end$$;
create table public.properties(id text primary key,kind text,is_active boolean);
insert into public.properties values('sample','managed',true),('other','managed',true),('concurrent','managed',true),('inactive','managed',false);
\ir ../../supabase/migrations/20261112210000_helm_pricing_research.sql
create function pg_temp.check_true(value boolean) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'assertion failed';end if;end$$;
create function pg_temp.evidence(id text) returns jsonb language sql as $$select jsonb_build_object('version',1,'currency','USD','propertyId',id,'market','[]'::jsonb,'history','[]'::jsonb)$$;
select pg_temp.check_true((select bool_and(relrowsecurity) from pg_class where oid in ('helm_pricing_research'::regclass,'helm_pricing_research_versions'::regclass)));
do $$declare r text; t text;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  foreach t in array array['helm_pricing_research','helm_pricing_research_versions'] loop
   if has_table_privilege(r,t,'INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'Direct writes allowed';end if;
   if r<>'service_role' and has_table_privilege(r,t,'SELECT') then raise exception 'Unprivileged read';end if;
  end loop;
  if has_function_privilege(r,'helm_save_pricing_research(text,jsonb,integer,uuid,text)','EXECUTE')<>(r='service_role') then raise exception 'Wrong RPC access';end if;
 end loop;
end$$;
set role service_role;
select helm_save_pricing_research('sample','{"version":1,"currency":"USD","propertyId":"sample","market":[],"history":[]}',0,'00000000-0000-4000-8000-000000000001','owner@synthetic.test');
reset role;
do $$begin
 begin perform helm_save_pricing_research('other',pg_temp.evidence('sample'),0,'00000000-0000-4000-8000-000000000002','owner@synthetic.test');raise exception 'Wrong property accepted';exception when invalid_parameter_value then null;end;
 begin perform helm_save_pricing_research('inactive',pg_temp.evidence('inactive'),0,'00000000-0000-4000-8000-000000000002','owner@synthetic.test');raise exception 'Inactive property accepted';exception when invalid_parameter_value then null;end;
 begin perform helm_save_pricing_research('sample',pg_temp.evidence('sample'),0,'00000000-0000-4000-8000-000000000002','owner@synthetic.test');raise exception 'Stale write accepted';exception when serialization_failure then null;end;
 begin perform helm_save_pricing_research('other',pg_temp.evidence('other'),0,'00000000-0000-4000-8000-000000000001','owner@synthetic.test');raise exception 'Reused request accepted';exception when invalid_parameter_value then null;end;
end$$;
select helm_save_pricing_research('sample',pg_temp.evidence('sample')||'{"marketSource":"second"}',1,'00000000-0000-4000-8000-000000000002','owner@synthetic.test');
select pg_temp.check_true((helm_save_pricing_research('sample',pg_temp.evidence('sample'),0,'00000000-0000-4000-8000-000000000001','owner@synthetic.test')->>'version')::int=1);
select pg_temp.check_true((select version=2 from helm_pricing_research where property_id='sample'));
select pg_temp.check_true((select count(*)=2 from helm_pricing_research_versions));
create function public.synthetic_fail_research() returns trigger language plpgsql as $$begin raise exception 'synthetic receipt failure';end$$;
create trigger synthetic_fail before insert on helm_pricing_research_versions for each row execute function synthetic_fail_research();
do $$begin
 begin perform helm_save_pricing_research('sample',pg_temp.evidence('sample'),2,'00000000-0000-4000-8000-000000000003','owner@synthetic.test');raise exception 'Receipt failure ignored';
 exception when raise_exception then if sqlerrm<>'synthetic receipt failure' then raise;end if;end;
end$$;
drop trigger synthetic_fail on helm_pricing_research_versions;
drop function public.synthetic_fail_research();
select pg_temp.check_true((select version=2 from helm_pricing_research where property_id='sample'));
select pg_temp.check_true((select count(*)=2 from helm_pricing_research_versions));
