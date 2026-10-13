-- Isolated staging only. Rolls back every test append; preserves existing history.
begin;
do $$
declare r text;
begin
 if not (select relrowsecurity from pg_class where oid='public.helm_pilot_inventory_state'::regclass) then raise exception 'RLS missing'; end if;
 foreach r in array array['anon','authenticated'] loop
  if has_table_privilege(r,'public.helm_pilot_inventory_state','SELECT,INSERT,UPDATE,DELETE') or has_function_privilege(r,'public.helm_pilot_inventory_append(bigint,jsonb)','EXECUTE') then raise exception 'Unexpected client access'; end if;
 end loop;
 if has_table_privilege('service_role','public.helm_pilot_inventory_state','INSERT,UPDATE,DELETE') then raise exception 'Direct mutation allowed'; end if;
end $$;
set local role service_role;
do $$
declare v bigint; j jsonb; n jsonb; changed jsonb; rejected boolean:=false;
begin
 select version,journal into v,j from public.helm_pilot_inventory_state where id=1;
 n:=jsonb_set(j,'{commands}',(j->'commands')||'[{"kind":"expire","now":0}]'::jsonb);
 if not public.helm_pilot_inventory_append(v,n) then raise exception 'First append failed'; end if;
 if public.helm_pilot_inventory_append(v,n) then raise exception 'Stale writer accepted'; end if;
 changed:=jsonb_set(n,'{commands}',(n->'commands')||'[{"kind":"expire","now":0}]'::jsonb);
 changed:=jsonb_set(changed,'{commands,0}', '{"kind":"expire","now":999999}'::jsonb);
 begin
  perform public.helm_pilot_inventory_append(v+1,changed);
 exception when raise_exception then
  if sqlerrm <> 'Inventory history rewrite refused' then raise; end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'History rewrite accepted'; end if;
 if (select version from public.helm_pilot_inventory_state where id=1)<>v+1 then raise exception 'Unexpected version'; end if;
 if (select journal from public.helm_pilot_inventory_state where id=1) is distinct from n then raise exception 'History changed'; end if;
end $$;
rollback;
select 'PASS: access restrictions, append, stale writer rejection and history protection; tests rolled back' as verification,
version,jsonb_array_length(journal->'commands') as retained_commands from public.helm_pilot_inventory_state where id=1;
