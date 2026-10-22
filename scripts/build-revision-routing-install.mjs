// Owner-only isolated upgrade artifact. Builds SQL locally; no env or external IO.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function buildRevisionRoutingInstall() {
 const sources={};
 const read=path=>{const s=readFileSync(new URL('../'+path,import.meta.url),'utf8');sources[path]=createHash('sha256').update(s).digest('hex');return s;};
 const files=['inventory-routes.sql','canonical-revision-routing.sql'];
 const parts=files.map(f=>{const s=read('docs/guesty-exit/staging-storage/'+f);assert.match(s,/^begin;$/m);assert.match(s,/commit;\s*$/);return s.replace(/^begin;\s*$/m,'').replace(/commit;\s*$/,'');});
 const legacy=[['canonical-revisions.sql','helm_pilot_revision_commit','jsonb'],['canonical-conflicts.sql','helm_pilot_revision_observe','jsonb']].map(([file,name,args])=>{
   const s=read('docs/guesty-exit/staging-storage/'+file),body=s.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;'))?.[1];
   assert.ok(body);return {name,args,md5:createHash('md5').update(body).digest('hex')};
 });
 read('scripts/build-revision-routing-install.mjs');
 const manifest=JSON.stringify(sources),body=parts.join('\n'),digest=createHash('sha256').update(body+manifest).digest('hex');
 const sql=`-- OWNER ONLY: Helm Channex Staging jgkblfozftcvymvwhhii. No activation or provider IO.
-- Bundle SHA-256: ${digest}
begin;
set local lock_timeout='5s'; set local statement_timeout='90s'; set local timezone='UTC';
do $guard$ declare t record; begin
 if not exists(select 1 from helm_pilot_installation.manifest where project_ref='jgkblfozftcvymvwhhii'
   and bundle_digest='79762c13691b7285d76bcac51f4c45e30a41f29f6fd90e1bc02812fb324fa441')
   or not exists(select 1 from helm_pilot_installation.message_queue where project_ref='jgkblfozftcvymvwhhii'
   and bundle_digest='bd916ca47ac1d3b323f169e8d2d0065e80f02763440b0e7802812b669b3afc81')
 then raise exception 'Reviewed isolated installation required'; end if;
 if to_regclass('public.helm_staging_inventory_routes') is not null or to_regclass('helm_pilot_installation.revision_routing') is not null
   or to_regprocedure('public.helm_pilot_revision_route()') is not null
 then raise exception 'Routing installation collision; inspect instead of replacing'; end if;
 ${legacy.map(f=>`if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.${f.name}(${f.args})')) is distinct from '${f.md5}' then raise exception 'Legacy revision implementation changed'; end if;`).join('\n ')}
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','helm_channex_revisions','helm_cleaner_rehearsal','helm_pilot_installation','helm_inventory_history')
     and c.relkind='r' order by 1,2 loop
   execute format('lock table %I.%I in share mode',t.nspname,t.relname);
 end loop;
 if (select count(*) from properties)<>1 or not exists(select 1 from properties where id='HELMTEST-calderwood' and calendar_authority='helm' and not automations_enabled)
   or exists(select 1 from channel_listings) or exists(select 1 from message_automations where enabled)
   or exists(select 1 from automation_channex_routes where enabled) or exists(select 1 from automation_cleaner_batches where enabled)
   or not exists(select 1 from helm_channex_revisions.scope where enabled)
   or (select count(*) from helm_booking_inventory_consumers)<>1
   or not exists(select 1 from helm_booking_inventory_consumers where property_id='HELMTEST-calderwood'
     and configuration @> '{"environment":"staging","topology":"single-unit","connection":"calderwood-hosted-inventory","listing":"f795ae2c-f47d-4751-86ff-e883b6d30800","generation":1,"publishEnabled":false,"timeZone":"America/New_York"}')
 then raise exception 'Paused fictional-only route prerequisites required'; end if;
end $guard$;
create temporary table helm_route_preserved(schema_name text,table_name text,row_digest text) on commit drop;
do $before$ declare t record; h text; begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','helm_channex_revisions','helm_cleaner_rehearsal','helm_pilot_installation','helm_inventory_history') and c.relkind='r' order by 1,2 loop
   execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from %I.%I t',t.nspname,t.relname) into h;
   insert into helm_route_preserved values(t.nspname,t.relname,h);
 end loop;
end $before$;
${body}
insert into public.helm_staging_inventory_routes(property_id,connection,generation,provider_property_id,room_type_id,rate_plan_id,
 property_title,rate_plan_title,adults,children,infants)
values('HELMTEST-calderwood','calderwood-hosted-inventory',1,'30584a9a-8784-4eb1-a387-e26bd43aec1c',
 'f795ae2c-f47d-4751-86ff-e883b6d30800','7f95b731-ff05-4c41-99c9-f39b3e772fec','65 Calderwood - Isolated Staging',
 'TEST ONLY - Calderwood - CLOSED - $100 placeholder',6,0,0);
do $after$ declare t record; h text; r record; begin
 perform public.helm_pilot_revision_route();
 for r in select revision_id from helm_channex_revisions.receipts loop
   if public.helm_pilot_revision_receipt_mapped(r.revision_id,'calderwood-hosted-inventory',1) is null then raise exception 'Receipt lost'; end if;
 end loop;
 for t in select * from helm_route_preserved loop
   execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from %I.%I t',t.schema_name,t.table_name) into h;
   if h is distinct from t.row_digest then raise exception 'Existing staging rows changed'; end if;
 end loop;
end $after$;
create table helm_pilot_installation.revision_routing(singleton boolean primary key default true check(singleton),
 project_ref text not null,bundle_digest text not null,sources jsonb not null,installed_at timestamptz not null default clock_timestamp());
alter table helm_pilot_installation.revision_routing enable row level security;
revoke all on helm_pilot_installation.revision_routing from public,anon,authenticated,service_role;
insert into helm_pilot_installation.revision_routing(project_ref,bundle_digest,sources)
 values('jgkblfozftcvymvwhhii','${digest}','${manifest}'::jsonb);
notify pgrst,'reload schema';
commit;
select project_ref,bundle_digest,installed_at from helm_pilot_installation.revision_routing;
`;
 return {sql,digest,sources};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.equal(process.argv.length,3);const b=buildRevisionRoutingInstall();writeFileSync(process.argv[2],b.sql,{mode:0o600});
 console.log(JSON.stringify({path:process.argv[2],digest:b.digest,bytes:Buffer.byteLength(b.sql)}));
}
