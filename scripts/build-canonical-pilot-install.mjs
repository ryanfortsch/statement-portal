// Produces a reviewed SQL artifact only. Never connects to any database.
import { canonicalPilotSchema } from './canonical-pilot-schema.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
export function buildCanonicalPilotInstall() {
  const {parts,sources}=canonicalPilotSchema();
  for(const name of ['booking-inventory-events','booking-inventory-planning','canonical-revisions']) {
    const path=`docs/guesty-exit/staging-storage/${name}.sql`;
    let sql=readFileSync(new URL('../'+path,import.meta.url),'utf8');
    sources[path]=createHash('sha256').update(sql).digest('hex');
    // All components run inside ONE outer transaction. No intermediate commits.
    assert.match(sql,/^begin;$/m);assert.match(sql,/commit;\s*$/);
    sql=sql.replace(/^begin;\s*$/m,'').replace(/commit;\s*$/,'');parts.push(sql);
  }
  for(const path of ['scripts/canonical-pilot-schema.mjs','scripts/build-canonical-pilot-install.mjs']) sources[path]=createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex');
  const manifest=JSON.stringify(sources),digest=createHash('sha256').update(parts.join('\n')+manifest).digest('hex');
  const publicSql=parts.join('\n');
  const tables=[...new Set([...publicSql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)].map(m=>m[1]))];
  const existing=['helm_airbnb_message_state','helm_pilot_closure_history','helm_pilot_closure_state','helm_pilot_inventory_snapshot','helm_pilot_inventory_state','helm_pilot_message_state','helm_pilot_ownership_history','helm_pilot_ownership_state','helm_pilot_worker_health'];
  const functions=[...new Set([...publicSql.matchAll(/create or replace function public\.([a-z_]+)/g)].map(m=>m[1]))];
  const literals=xs=>xs.map(v=>"'"+v.replaceAll("'","''")+"'").join(',');
  const sql=`-- ISOLATED SYNTHETIC PILOT ONLY: project jgkblfozftcvymvwhhii (Helm Channex Staging).
-- Verify project name/URL before Run. Refuses an existing canonical database.
-- The nine previously inspected public rehearsal tables are preserved.
-- No customer seeds, credentials, channel actions, message sends or recurring jobs.
-- Bundle digest: ${digest}
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
do $$ begin
  if to_regclass('helm_cleaner_rehearsal.delivery') is null then raise exception 'Existing isolated rehearsal marker required'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f') and c.relname not in (${literals(existing)})) then
    raise exception 'Canonical or unknown public relation exists; never install over an existing application'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${literals(functions)})) then
    raise exception 'Canonical function collision; installation refused'; end if;
  if to_regnamespace('helm_pilot_installation') is not null or to_regnamespace('helm_channex_revisions') is not null then
    raise exception 'Pilot namespace already exists; inspect instead of reinstalling'; end if;
  if exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname in ('booking_channel','booking_status','booking_source')) then
    raise exception 'Booking type collision'; end if;
end $$;
${publicSql}
-- Override legacy public policies/grants before this transaction becomes visible.
-- Only newly created canonical tables: preserve existing rehearsal policies/grants.
do $$ declare r record; begin
  for r in select tablename,policyname from pg_policies where schemaname='public' and tablename in (${literals(tables)}) loop
    execute format('drop policy %I on public.%I',r.policyname,r.tablename);
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname in (${literals(tables)}) loop
    execute format('alter table public.%I enable row level security',r.relname);
    execute format('revoke all on public.%I from public,anon,authenticated',r.relname);
  end loop;
end $$;
create schema helm_pilot_installation;
revoke all on schema helm_pilot_installation from public,anon,authenticated,service_role;
create table helm_pilot_installation.manifest(singleton boolean primary key default true check(singleton),project_ref text not null,bundle_digest text not null,sources jsonb not null,installed_at timestamptz not null default now());
alter table helm_pilot_installation.manifest enable row level security;
revoke all on helm_pilot_installation.manifest from public,anon,authenticated,service_role;
insert into helm_pilot_installation.manifest(project_ref,bundle_digest,sources) values('jgkblfozftcvymvwhhii','${digest}','${manifest}'::jsonb);
notify pgrst,'reload schema';
commit;
select project_ref,bundle_digest,installed_at from helm_pilot_installation.manifest;
`;
  return {sql,digest,sources};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3)throw Error('Usage: node scripts/build-canonical-pilot-install.mjs /absolute/output.sql');
  const bundle=buildCanonicalPilotInstall();writeFileSync(process.argv[2],bundle.sql,{mode:0o600});
  console.log(JSON.stringify({path:process.argv[2],digest:bundle.digest,bytes:Buffer.byteLength(bundle.sql),sources:Object.keys(bundle.sources).length}));
}
