// Emits one guarded, atomic SQL artifact. No credentials, environment or network.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export function buildMessagePilotInstall() {
 const sources={},parts=[];
 const read=path=>{const s=readFileSync(new URL('../'+path,import.meta.url),'utf8');sources[path]=createHash('sha256').update(s).digest('hex');return s;};
 const section=(s,from,to)=>{const a=s.indexOf(from),b=s.indexOf(to,a);assert.ok(a>=0&&b>a,from);return s.slice(a,b);};
 // Exact canonical definitions; exclude customer seeds and unrelated legacy policies.
 parts.push(section(read('supabase/migrations/20260620b_property_access_isolation.sql'),'create table if not exists public.property_access (','comment on table'));
 parts.push(section(read('supabase/migrations/20260622c_guest_access_codes.sql'),'create table if not exists public.guest_access_codes (','alter table public.guest_access_codes'));
 parts.push(section(read('supabase/migrations/20260520_seam_lock_integration.sql'),'create table public.lock_devices (','alter table public.lock_devices'));
 const cleaner=read('supabase/migrations/20260824d_cleaner_checkout_schedule.sql');
 parts.push(section(cleaner,'CREATE TABLE IF NOT EXISTS checkout_adjustments (','INSERT INTO cleaner_schedule_recipients'));
 const plumbing=read('supabase/migrations/20260926200000_helm_pms_plumbing.sql');
 parts.push(section(plumbing,'alter table public.cleaner_schedule_recipients','alter table public.cleaner_schedule_digests'));
 const dependencies=['property_access','guest_access_codes','lock_devices','checkout_adjustments','cleaner_schedule_recipients'];
 for(const t of dependencies)parts.push(`alter table public.${t} enable row level security; revoke all on public.${t} from public,anon,authenticated,service_role; grant select on public.${t} to service_role;`);
 for(const name of ['automation-holds','channex-message-worker','channex-message-schedule','cleaner-message-worker','message-handoff-registration','message-history-handoff']){
  let s=read(`docs/guesty-exit/staging-storage/${name}.sql`);assert.match(s,/^begin;$/m);assert.match(s,/commit;\s*$/);
  parts.push(s.replace(/^begin;\s*$/m,'').replace(/commit;\s*$/,''));
 }
 const rehearsal=read('docs/guesty-exit/staging-storage/message-hosted-rehearsal.sql');
 read('scripts/build-message-pilot-install.mjs');
 const manifest=JSON.stringify(sources),body=parts.join('\n'),digest=createHash('sha256').update(body+rehearsal+manifest).digest('hex');
 const newTables=[...dependencies,...new Set([...body.matchAll(/create table (?:if not exists )?public\.(automation_[a-z_]+)/g)].map(m=>m[1]))];
 const names=newTables.map(x=>`'${x}'`).join(',');
 const sql=`-- OWNER ONLY: Helm Channex Staging, project jgkblfozftcvymvwhhii.
-- Installs EMPTY messaging support, tests one fictional stay in a rolled-back
-- subtransaction, then persists only the installation/result receipt. No sends.
-- Bundle SHA-256: ${digest}
begin;
set local lock_timeout='5s'; set local statement_timeout='90s'; set local timezone='UTC';
lock table public.properties,public.channel_listings,public.message_automations,
 public.bookings,public.automation_sends,public.helm_booking_inventory_consumers in share mode;
do $$ begin
 if to_regclass('helm_pilot_installation.manifest') is null or not exists(select 1 from helm_pilot_installation.manifest
  where project_ref='jgkblfozftcvymvwhhii' and bundle_digest='79762c13691b7285d76bcac51f4c45e30a41f29f6fd90e1bc02812fb324fa441') then
  raise exception 'Reviewed isolated installation required'; end if;
 if not exists(select 1 from public.properties where id='HELMTEST-calderwood' and calendar_authority='helm')
  or exists(select 1 from public.properties where id<>'HELMTEST-calderwood' or automations_enabled)
  or exists(select 1 from public.channel_listings) or exists(select 1 from public.message_automations where enabled)
  or exists(select 1 from public.helm_booking_inventory_consumers where property_id<>'HELMTEST-calderwood' or configuration->>'publishEnabled' is distinct from 'false')
  or exists(select 1 from public.automation_sends where status in ('sending','sent') or provider_message_id is not null)
 then raise exception 'Paused fictional-only messaging required'; end if;
 if to_regclass('helm_pilot_installation.messaging') is not null
  or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${names}))
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'automation_%')
 then raise exception 'Messaging collision; inspect existing installation instead of replacing it'; end if;
end $$;
${body}
create temporary table helm_message_rehearsal_result(summary jsonb) on commit drop;
${rehearsal}
create table helm_pilot_installation.messaging(singleton boolean primary key default true check(singleton),
 project_ref text not null,bundle_digest text not null,sources jsonb not null,summary jsonb not null,installed_at timestamptz not null default now());
alter table helm_pilot_installation.messaging enable row level security;
revoke all on helm_pilot_installation.messaging from public,anon,authenticated,service_role;
insert into helm_pilot_installation.messaging(project_ref,bundle_digest,sources,summary)
 select 'jgkblfozftcvymvwhhii','${digest}','${manifest}'::jsonb,summary from helm_message_rehearsal_result;
notify pgrst,'reload schema';
commit;
select project_ref,bundle_digest,summary,installed_at from helm_pilot_installation.messaging;
`;
 return {sql,digest,sources,newTables};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.equal(process.argv.length,3);const b=buildMessagePilotInstall();writeFileSync(process.argv[2],b.sql,{mode:0o600});
 console.log(JSON.stringify({path:process.argv[2],digest:b.digest,bytes:Buffer.byteLength(b.sql),tables:b.newTables.length}));
}
