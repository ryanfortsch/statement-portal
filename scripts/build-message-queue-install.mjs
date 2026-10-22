// Incremental, owner-only installation in the existing isolated pilot.
// Builds SQL locally; no credentials, environment reads, hosted or provider IO.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildMessagePilotInstall } from './build-message-pilot-install.mjs';

const priorDigest = 'd565811589a8df2182093c6799005e91ba7ac35e3af4fcbe07a241e93ab13094';
export function buildMessageQueueInstall() {
 const sources = {};
 const read = path => {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  sources[path] = createHash('sha256').update(source).digest('hex');
  return source;
 };
 const prior = buildMessagePilotInstall();
 assert.equal(prior.digest, priorDigest, 'Review the prior installed bundle before building an upgrade');
 const original = read('docs/guesty-exit/staging-storage/channex-message-worker.sql');
 const oldContext = original.match(/create function public\.automation_channex_context\(p_send_id uuid\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];
 assert.ok(oldContext);
 const contextMd5 = createHash('md5').update(oldContext).digest('hex');
 const candidate = read('docs/guesty-exit/staging-storage/message-queue-preparation.sql');
 assert.match(candidate, /^begin;$/m); assert.match(candidate, /commit;\s*$/);
 const body = candidate.replace(/^begin;\s*$/m, '').replace(/commit;\s*$/, '');
 let rehearsal = read('docs/guesty-exit/staging-storage/message-hosted-rehearsal.sql');
 const replaceOnce = (from, to) => {
  assert.equal(rehearsal.split(from).length, 2, 'Rehearsal marker changed: ' + from);
  rehearsal = rehearsal.replace(from, to);
 };
 replaceOnce('entries jsonb:=', 'held_id uuid;\n entries jsonb:=');
 replaceOnce("jsonb_build_object('send_id',row_send.id,'review',review)",
  "jsonb_build_object('automation_id',row_send.automation_id,'fire_at',row_send.fire_at,'review',review)");
 assert.equal(rehearsal.split('public.automation_message_handoff_stay(b,canon,').length, 4);
 rehearsal = rehearsal.replaceAll('public.automation_message_handoff_stay(b,canon,', 'public.automation_message_prepare_handoff(b,canon,');
 replaceOnce('  -- Last entry rejects AFTER earlier writes,', `  select id into held_id from public.automation_sends where booking_id=b and status='held';
  delete from public.automation_sends where booking_id=b and status<>'held';
  if held_id is null or (select count(*) from public.automation_sends where booking_id=b)<>1 then
   raise exception 'Expected one existing held schedule'; end if;
  -- Last entry rejects AFTER earlier writes,`);
 replaceOnce("  result:=public.automation_message_prepare_handoff(b,canon,entries);", `  if (select count(*) from public.automation_sends where booking_id=b)<>1 then
   raise exception 'Failed preparation retained newly created rows'; end if;
  result:=public.automation_message_prepare_handoff(b,canon,entries);
  if (select count(*) from public.automation_sends where booking_id=b)<>6 or not exists(
   select 1 from public.automation_sends where id=held_id and booking_id=b and status='held') then
   raise exception 'Preparation failed to create five schedules and preserve held identity'; end if;`);
 replaceOnce("'workflows',6,'already_sent_imported',1", "'workflows',6,'new_schedules',5,'held_identity_preserved',true,'already_sent_imported',1");
 read('scripts/build-message-queue-install.mjs');
 const manifest = JSON.stringify(sources);
 const digest = createHash('sha256').update(body + rehearsal + manifest).digest('hex');
 const sql = `-- OWNER ONLY: Helm Channex Staging, project jgkblfozftcvymvwhhii.
-- Incremental queue preparation. No customer fixtures, external calls or activation.
-- Bundle SHA-256: ${digest}
begin;
set local lock_timeout='5s'; set local statement_timeout='90s'; set local timezone='UTC';
do $guard$
declare t record; role_name text;
begin
 if to_regclass('helm_pilot_installation.messaging') is null or not exists(
  select 1 from helm_pilot_installation.messaging where project_ref='jgkblfozftcvymvwhhii'
   and bundle_digest='${priorDigest}' and summary @> '{"workflows":6,"fixture_rolled_back":true,"existing_rows_preserved":true}')
 then raise exception 'Reviewed isolated messaging installation required'; end if;
 if to_regclass('helm_pilot_installation.message_queue') is not null or exists(
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and p.proname in ('automation_message_booking_context','automation_message_preparation_snapshot','automation_message_prepare_handoff'))
 then raise exception 'Queue installation collision; inspect instead of replacing'; end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.automation_channex_context(uuid)')) is distinct from '${contextMd5}'
 then raise exception 'Existing context implementation changed'; end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(role_name,'public.automation_message_handoff_stay(uuid,text,jsonb)','EXECUTE')
  then raise exception 'Existing source handoff permissions changed'; end if;
 end loop;
 -- Freeze the complete small isolated fixture, including private inventory data.
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','helm_channex_revisions','helm_cleaner_rehearsal','helm_pilot_installation') and c.relkind='r' order by 1,2 loop
  execute format('lock table %I.%I in share mode',t.nspname,t.relname);
 end loop;
 if not exists(select 1 from properties where id='HELMTEST-calderwood' and calendar_authority='helm')
  or exists(select 1 from properties where id<>'HELMTEST-calderwood' or automations_enabled)
  or exists(select 1 from channel_listings) or exists(select 1 from message_automations where enabled)
  or exists(select 1 from helm_booking_inventory_consumers where property_id<>'HELMTEST-calderwood' or configuration->>'publishEnabled' is distinct from 'false')
  or exists(select 1 from automation_sends where status in ('sending','sent') or provider_message_id is not null)
 then raise exception 'Paused fictional-only messaging required'; end if;
 ${prior.newTables.map(t => `if exists(select 1 from public.${t}) then raise exception 'Messaging support must remain empty before upgrade'; end if;`).join('\n ')}
end $guard$;
${body}
create temporary table helm_message_rehearsal_result(summary jsonb) on commit drop;
${rehearsal}
do $grants$ declare role_name text; signature text; begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  foreach signature in array array['public.automation_message_prepare_handoff(uuid,text,jsonb)',
   'public.automation_message_preparation_snapshot(uuid)','public.automation_message_booking_context(uuid)'] loop
   if has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'Queue preparation exposed to %',role_name; end if;
  end loop;
 end loop;
end $grants$;
create table helm_pilot_installation.message_queue(singleton boolean primary key default true check(singleton),
 project_ref text not null,prior_bundle_digest text not null,bundle_digest text not null,sources jsonb not null,
 summary jsonb not null,installed_at timestamptz not null default now());
alter table helm_pilot_installation.message_queue enable row level security;
revoke all on helm_pilot_installation.message_queue from public,anon,authenticated,service_role;
insert into helm_pilot_installation.message_queue(project_ref,prior_bundle_digest,bundle_digest,sources,summary)
 select 'jgkblfozftcvymvwhhii','${priorDigest}','${digest}','${manifest}'::jsonb,summary from helm_message_rehearsal_result;
notify pgrst,'reload schema';
commit;
select project_ref,prior_bundle_digest,bundle_digest,summary,installed_at from helm_pilot_installation.message_queue;
`;
 return { sql, digest, sources, priorDigest };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 assert.equal(process.argv.length, 3); const b = buildMessageQueueInstall();
 writeFileSync(process.argv[2], b.sql, { mode: 0o600 });
 console.log(JSON.stringify({ path: process.argv[2], digest: b.digest, bytes: Buffer.byteLength(b.sql) }));
}
