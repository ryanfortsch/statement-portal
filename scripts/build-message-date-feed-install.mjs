// Build a single atomic, owner-run upgrade for the isolated Calderwood database.
// No credentials, environment reads, provider calls or application activation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function buildMessageDateFeedInstall() {
 const sources={};
 const read=path=>{const s=readFileSync(new URL('../'+path,import.meta.url),'utf8');sources[path]=createHash('sha256').update(s).digest('hex');return s;};
 const candidate=read('docs/guesty-exit/staging-storage/message-date-feed.sql');
 assert.match(candidate,/^begin;$/m);assert.match(candidate,/commit;\s*$/);
 const body=candidate.replace(/^begin;\s*$/m,'').replace(/commit;\s*$/,'');
 const rehearsal=read('docs/guesty-exit/staging-storage/message-date-feed-rehearsal.sql');
 const prior=[
  ['canonical-revision-routing.sql','helm_channex_revisions.lock_route','text,bigint'],
  ['canonical-revision-routing.sql','public.helm_pilot_revision_observe_mapped','jsonb,text,bigint'],
  ['message-handoff-registration.sql','public.automation_message_observe_times','uuid,text,uuid,jsonb'],
  ['message-handoff-registration.sql','public.automation_message_observation_current','uuid'],
 ].map(([file,name,args])=>{
  const s=read('docs/guesty-exit/staging-storage/'+file);
  const fn=s.match(new RegExp('create (?:or replace )?function '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;'))?.[1];
  assert.ok(fn,'Missing reviewed function '+name);return {signature:name+'('+args+')',md5:createHash('md5').update(fn).digest('hex')};
 });
 read('scripts/build-message-date-feed-install.mjs');
 const manifest=JSON.stringify(sources),digest=createHash('sha256').update(body+rehearsal+manifest).digest('hex');
 const sql=`-- OWNER ONLY: Helm Channex Staging jgkblfozftcvymvwhhii.
-- Bundle SHA-256: ${digest}. Constructed revisions, no provider IO or activation.
begin;
set local lock_timeout='5s'; set local statement_timeout='90s'; set local timezone='UTC';
do $guard$ declare t record; begin
 if not exists(select 1 from helm_pilot_installation.message_queue where project_ref='jgkblfozftcvymvwhhii'
  and bundle_digest='bd916ca47ac1d3b323f169e8d2d0065e80f02763440b0e7802812b669b3afc81')
  or not exists(select 1 from helm_pilot_installation.revision_routing where project_ref='jgkblfozftcvymvwhhii'
  and bundle_digest='82fb9806b470e2bc387b436443d1072041693f80dabfdafa177412f385aaf1b9')
 then raise exception 'Reviewed isolated date-feed prerequisites required'; end if;
 if to_regclass('helm_channex_revisions.message_timing_policies') is not null
  or to_regclass('helm_pilot_installation.message_date_feed') is not null
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('helm_pilot_message_times_register','helm_pilot_message_times_refresh'))
 then raise exception 'Date-feed installation collision; inspect instead of replacing'; end if;
 ${prior.map(f=>`if (select md5(prosrc) from pg_proc where oid=to_regprocedure('${f.signature}')) is distinct from '${f.md5}' then raise exception 'Reviewed date-feed dependency changed: ${f.signature}'; end if;`).join('\n ')}
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','helm_channex_revisions','helm_cleaner_rehearsal','helm_pilot_installation','helm_inventory_history') and c.relkind='r' order by 1,2 loop
  execute format('lock table %I.%I in share mode',t.nspname,t.relname);
 end loop;
 if (select count(*) from properties)<>1 or not exists(select 1 from properties where id='HELMTEST-calderwood' and calendar_authority='helm' and not automations_enabled)
  or exists(select 1 from channel_listings) or exists(select 1 from message_automations where enabled)
  or exists(select 1 from automation_channex_routes) or exists(select 1 from automation_cleaner_batches)
  or exists(select 1 from automation_sends where status in ('sending','sent') or provider_message_id is not null)
  or (select count(*) from helm_booking_inventory_consumers)<>1
  or not exists(select 1 from helm_booking_inventory_consumers where property_id='HELMTEST-calderwood'
   and configuration @> '{"environment":"staging","topology":"single-unit","connection":"calderwood-hosted-inventory","generation":1,"publishEnabled":false,"timeZone":"America/New_York"}')
 then raise exception 'Paused fictional-only date-feed installation required'; end if;
 perform public.helm_pilot_revision_route();
end $guard$;
${body}
create temporary table helm_date_feed_result(summary jsonb) on commit drop;
${rehearsal}
do $grants$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(role_name,'public.helm_pilot_message_times_register(uuid,uuid,text,bigint,text,timestamptz,boolean)','EXECUTE')
   or has_table_privilege(role_name,'helm_channex_revisions.message_timing_policies','SELECT,INSERT,UPDATE,DELETE')
   or has_function_privilege(role_name,'public.helm_pilot_message_times_refresh(text,bigint,integer)','EXECUTE') is distinct from (role_name='service_role')
  then raise exception 'Unexpected message timing grants'; end if;
 end loop;
 if not (select relrowsecurity from pg_class where oid='helm_channex_revisions.message_timing_policies'::regclass)
 then raise exception 'Message timing RLS missing'; end if;
end $grants$;
create table helm_pilot_installation.message_date_feed(singleton boolean primary key default true check(singleton),
 project_ref text not null,bundle_digest text not null,sources jsonb not null,summary jsonb not null,
 installed_at timestamptz not null default clock_timestamp());
alter table helm_pilot_installation.message_date_feed enable row level security;
revoke all on helm_pilot_installation.message_date_feed from public,anon,authenticated,service_role;
insert into helm_pilot_installation.message_date_feed(project_ref,bundle_digest,sources,summary)
 select 'jgkblfozftcvymvwhhii','${digest}','${manifest}'::jsonb,summary from helm_date_feed_result;
notify pgrst,'reload schema';
commit;
select project_ref,bundle_digest,summary,installed_at from helm_pilot_installation.message_date_feed;
`;
 return {sql,digest,sources};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.equal(process.argv.length,3);const b=buildMessageDateFeedInstall();writeFileSync(process.argv[2],b.sql,{mode:0o600});
 console.log(JSON.stringify({path:process.argv[2],digest:b.digest,bytes:Buffer.byteLength(b.sql)}));
}
