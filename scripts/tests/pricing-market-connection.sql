\set ON_ERROR_STOP on
do $$begin
 if current_database()<>'helm_synthetic_pricing_market' then raise exception 'synthetic_database_required';end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end$$;
\ir ../../supabase/migrations/20261113020000_helm_pricing_market_connection.sql
create function pg_temp.check_true(v boolean) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'assertion failed';end if;end$$;
-- Deliberately not real credentials; only envelope/lease behavior is under test.
select 'v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',64) as ciphertext \gset
select pg_temp.check_true((select relrowsecurity from pg_class where oid='helm_pricing_market_connection'::regclass));
do $$declare r text; f text;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(r,'helm_pricing_market_connection','INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'Direct write allowed';end if;
  if r<>'service_role' and has_table_privilege(r,'helm_pricing_market_connection','SELECT') then raise exception 'Unprivileged credential read';end if;
  foreach f in array array['helm_configure_pricing_market(text,boolean)','helm_claim_pricing_market(uuid)','helm_rotate_pricing_market(uuid,text)','helm_finish_pricing_market(uuid,jsonb,text)'] loop
   if has_function_privilege(r,f,'EXECUTE')<>(r='service_role') then raise exception 'Wrong RPC permissions';end if;
  end loop;
 end loop;
end$$;
set role service_role;
select pg_temp.check_true(helm_claim_pricing_market('00000000-0000-4000-8000-000000000001') is null);
select helm_configure_pricing_market(:'ciphertext',false);
select pg_temp.check_true(helm_claim_pricing_market('00000000-0000-4000-8000-000000000001') is null);
select helm_configure_pricing_market(null,true);
select pg_temp.check_true(helm_claim_pricing_market('00000000-0000-4000-8000-000000000001')->>'ciphertext'=:'ciphertext');
select pg_temp.check_true(helm_claim_pricing_market('00000000-0000-4000-8000-000000000002') is null);
do $$begin
 begin perform helm_configure_pricing_market(null,false);raise exception 'Active lease ignored';exception when serialization_failure then null;end;
 begin perform helm_rotate_pricing_market('00000000-0000-4000-8000-000000000002','invalid');raise exception 'Wrong lease accepted';exception when serialization_failure then null;end;
 begin perform helm_finish_pricing_market('00000000-0000-4000-8000-000000000002','{"status":"complete"}',null);raise exception 'Wrong finisher accepted';exception when serialization_failure then null;end;
 begin perform helm_finish_pricing_market('00000000-0000-4000-8000-000000000001','{"status":"complete","token":"secret"}',null);raise exception 'Private report accepted';exception when invalid_parameter_value then null;end;
 begin perform helm_finish_pricing_market('00000000-0000-4000-8000-000000000001','{"status":"complete","saved":-1}',null);raise exception 'Invalid count accepted';exception when invalid_parameter_value then null;end;
end$$;
select helm_rotate_pricing_market('00000000-0000-4000-8000-000000000001',:'ciphertext'||'x');
select helm_finish_pricing_market('00000000-0000-4000-8000-000000000001','{"status":"partial","saved":20,"failed":1}','synthetic-home');
select pg_temp.check_true(helm_claim_pricing_market('00000000-0000-4000-8000-000000000002')->>'cursor'='synthetic-home');
reset role;
select pg_temp.check_true((select ciphertext=:'ciphertext'||'x' and last_report->>'saved'='20' from helm_pricing_market_connection));
update helm_pricing_market_connection set lease_until=clock_timestamp()-interval '1 second';
set role service_role;
do $$begin
 begin perform helm_rotate_pricing_market('00000000-0000-4000-8000-000000000002','invalid');raise exception 'Expired lease accepted';exception when serialization_failure then null;end;
 begin perform helm_finish_pricing_market('00000000-0000-4000-8000-000000000002','{"status":"complete"}',null);raise exception 'Expired finisher accepted';exception when serialization_failure then null;end;
end$$;
select pg_temp.check_true(helm_claim_pricing_market('00000000-0000-4000-8000-000000000003') is not null);
select helm_finish_pricing_market('00000000-0000-4000-8000-000000000003','{"status":"complete"}',null);
select helm_configure_pricing_market(null,false);
select pg_temp.check_true(helm_claim_pricing_market('00000000-0000-4000-8000-000000000004') is null);
reset role;
-- Leave enabled and free for the separate real concurrent-session test.
select helm_configure_pricing_market(null,true);
