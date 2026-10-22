// Real PostgreSQL + canonical application DDL. No env/hosted/provider access.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildCanonicalPilotInstall } from './build-canonical-pilot-install.mjs';
import { buildMessagePilotInstall } from './build-message-pilot-install.mjs';
import { buildRevisionRoutingInstall } from './build-revision-routing-install.mjs';
import { buildMessageQueueInstall } from './build-message-queue-install.mjs';
import { buildMessageDateFeedInstall } from './build-message-date-feed-install.mjs';
assert.ok(isAbsolute(process.argv[2]??'')&&isAbsolute(process.argv[3]??''),'Pass absolute native-bin and pg module paths');
const bin=process.argv[2],{default:pg}=await import(pathToFileURL(process.argv[3]).href);
const root=mkdtempSync(join(tmpdir(),'helm-message-install-')),data=join(root,'data');
const ctl=(...args)=>execFileSync(join(bin,'pg_ctl'),['-D',data,...args],{stdio:'ignore'});
let db,running=false,count=0;const pass=label=>{count++;console.log('PASS '+label);};
try{
 execFileSync(join(bin,'initdb'),['-D',data,'-A','trust','-U','helmtest','--no-locale','-E','UTF8'],{stdio:'ignore'});
 ctl('-l',join(root,'server.log'),'-o',`-h '' -k ${root} -p 55484`,'-w','start');running=true;
 db=new pg.Client({host:root,port:55484,user:'helmtest',database:'postgres'});await db.connect();
 await db.query('create role anon;create role authenticated;create role service_role bypassrls;create schema helm_cleaner_rehearsal;create table helm_cleaner_rehearsal.delivery(id int,version int);insert into helm_cleaner_rehearsal.delivery values(1,6)');
 await db.query(buildCanonicalPilotInstall().sql);
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/canonical-hosted-rehearsal.sql',import.meta.url),'utf8'));
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/calendar-app.sql',import.meta.url),'utf8'));
 await db.query(`insert into helm_booking_inventory_consumers(property_id,configuration) values('HELMTEST-calderwood','{"environment":"staging","topology":"single-unit","connection":"calderwood-hosted-inventory","listing":"f795ae2c-f47d-4751-86ff-e883b6d30800","generation":1,"publishEnabled":false,"timeZone":"America/New_York"}')`);
 const bundle=buildMessagePilotInstall(),scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].data;
 const reject=async(sql,pattern)=>{await assert.rejects(db.query(sql),pattern);await db.query('rollback');};
 await db.query("update helm_pilot_installation.manifest set project_ref='wrong'");await reject(bundle.sql,/Reviewed isolated/);
 await db.query("update helm_pilot_installation.manifest set project_ref='jgkblfozftcvymvwhhii'");pass('wrong project rejected before installing');
 for(const [label,on,off] of [
  ['property sender',"update properties set automations_enabled=true","update properties set automations_enabled=false"],
  ['enabled rule',"insert into message_automations(key,property_id,trigger,body,enabled) values('HELMTEST-rule-guard','HELMTEST-calderwood','pre_arrival','HELMTEST',true)","delete from message_automations where key='HELMTEST-rule-guard'"],
  ['connected channel',"insert into channel_listings(property_id,channel) values('HELMTEST-calderwood','airbnb')","delete from channel_listings"],
  ['inventory publishing',"update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true')","update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','false')"],
 ]){
  await db.query(on);await reject(bundle.sql,/Paused fictional-only/);await db.query(off);pass('active '+label+' refused');
 }
 // Rejecting a late test assertion must remove ALL newly installed schema too.
 const broken=bundle.sql.replace("if after_rows is distinct from before_rows then",'if true then');
 await reject(broken,/Rehearsal changed persistent data/);
 assert.equal(await scalar("select to_regclass('public.automation_channex_jobs') data"),null);
 assert.equal(await scalar("select to_regclass('public.property_access') data"),null);
 pass('late assertion rolls back schema and all fixture writes');
 await db.query(bundle.sql);
 const report=await scalar('select summary data from helm_pilot_installation.messaging');
 assert.equal(report.workflows,6);assert.equal(report.future_guest_jobs,3);assert.equal(report.future_cleaner_batches,2);
 assert.equal(report.existing_rows_preserved,true);assert.equal(report.fixture_rolled_back,true);assert.equal(report.provider_calls,0);
 assert.equal(await scalar('select count(*)::int data from automation_channex_jobs'),0);
 assert.equal(await scalar('select count(*)::int data from automation_cleaner_jobs'),0);
 assert.equal(await scalar('select count(*)::int data from automation_message_source_history'),0);
 assert.equal(await scalar('select version data from helm_cleaner_rehearsal.delivery'),6);
 pass('canonical six-message rehearsal, replay, late rejection, hold and private-data preservation');
 const status=(await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-pilot-status.sql',import.meta.url),'utf8')))[1].rows.map(x=>x['Isolated messaging verification']);
 assert.equal(status.length,8);assert.equal(status[0],'Six-message rehearsal: PASS');assert.equal(status[1],'Retained test jobs: 0');assert.equal(status[2],'Active send controls: 0');pass('same read-only status artifact verifies committed installation');
 await reject(bundle.sql,/Messaging collision/);pass('repeat installation refuses replacement');
 for(const table of bundle.newTables){
  assert.equal(await scalar('select relrowsecurity data from pg_class where oid=$1::regclass',['public.'+table]),true);
  for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') data",[role,'public.'+table]),false);
 }
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'public.automation_message_handoff_stay(uuid,text,jsonb)','EXECUTE') data",[role]),false);
 pass('RLS and owner-only handoff verified on actual canonical schema');
 // The incremental installer upgrades the actual installed canonical fixture.
 const upgrade=buildMessageQueueInstall();
 const contextBefore=await scalar("select pg_get_functiondef('public.automation_channex_context(uuid)'::regprocedure) data");
 const contextAcl=await scalar("select proacl::text data from pg_proc where oid='public.automation_channex_context(uuid)'::regprocedure");
 await db.query("update helm_pilot_installation.messaging set bundle_digest='wrong'");
 await reject(upgrade.sql,/Reviewed isolated messaging/);
 await db.query('update helm_pilot_installation.messaging set bundle_digest=$1',[bundle.digest]);
 pass('incremental installer rejects the wrong prior bundle');
 await db.query("create or replace function public.automation_channex_context(p_send_id uuid) returns text language sql stable security definer set search_path='' as $$select 'changed'::text$$");
 await reject(upgrade.sql,/context implementation changed/);await db.query(contextBefore);
 pass('incremental installer refuses unexpected function drift');
 await db.query('grant execute on function public.automation_message_handoff_stay(uuid,text,jsonb) to service_role');
 await reject(upgrade.sql,/permissions changed/);
 await db.query('revoke all on function public.automation_message_handoff_stay(uuid,text,jsonb) from service_role');
 pass('incremental installer rejects widened source-handoff permissions');
 await db.query("update properties set automations_enabled=true");await reject(upgrade.sql,/Paused fictional-only/);
 await db.query("update properties set automations_enabled=false");pass('incremental installer refuses an active sender');
 await db.query("insert into automation_channex_routes(property_id,environment,channex_property_id,channel_id,provider,generation,enabled,source_stopped_at,source_drained_at) values('HELMTEST-calderwood','staging',gen_random_uuid(),gen_random_uuid(),'Airbnb',gen_random_uuid(),false,now()-interval '2 minutes',now()-interval '1 minute')");
 await reject(upgrade.sql,/support must remain empty/);await db.query('delete from automation_channex_routes');
 pass('incremental installer refuses existing messaging data');
 await reject(upgrade.sql.replace("if after_rows is distinct from before_rows then",'if true then'),/Rehearsal changed persistent data/);
 assert.equal(await scalar("select to_regprocedure('public.automation_message_prepare_handoff(uuid,text,jsonb)')::text data"),null);
 assert.equal(await scalar("select to_regclass('helm_pilot_installation.message_queue') data"),null);
 assert.equal(await scalar("select pg_get_functiondef('public.automation_channex_context(uuid)'::regprocedure) data"),contextBefore);
 pass('late incremental failure restores original implementation and removes all new objects');
 await db.query(upgrade.sql);
 const prepared=await scalar('select summary data from helm_pilot_installation.message_queue');
 assert.equal(prepared.workflows,6);assert.equal(prepared.new_schedules,5);assert.equal(prepared.held_identity_preserved,true);
 assert.equal(prepared.fixture_rolled_back,true);assert.equal(prepared.existing_rows_preserved,true);
 assert.equal(prepared.future_guest_jobs,3);assert.equal(prepared.fictional_cleaner_recipient_jobs,4);
 assert.equal(await scalar('select count(*)::int data from automation_channex_jobs'),0);
 assert.equal(await scalar('select count(*)::int data from automation_cleaner_jobs'),0);
 assert.equal(await scalar('select version data from helm_cleaner_rehearsal.delivery'),6);
 assert.equal(await scalar("select proacl::text data from pg_proc where oid='public.automation_channex_context(uuid)'::regprocedure"),contextAcl);
 pass('guarded queue upgrade creates five schedules, preserves held identity and rolls back every fictional row');
 await reject(upgrade.sql,/Queue installation collision/);pass('repeat incremental installation refuses replacement');
 for(const role of ['anon','authenticated','service_role']){
  for(const name of ['automation_message_prepare_handoff(uuid,text,jsonb)',
   'automation_message_preparation_snapshot(uuid)','automation_message_booking_context(uuid)'])
   assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE') data",[role,'public.'+name]),false);
  assert.equal(await scalar("select has_table_privilege($1,'helm_pilot_installation.message_queue','SELECT,INSERT,UPDATE,DELETE') data",[role]),false);
 }
 pass('incremental preparation and receipt remain owner-only without widening existing execution grants');
 const queueStatus=(await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-queue-status.sql',import.meta.url),'utf8')))[1].rows.map(x=>x['Isolated queue verification']);
 assert.equal(queueStatus.length,9);assert.equal(queueStatus[0],'Queue creation rehearsal: PASS');
 assert.equal(queueStatus[1],'New schedules created / existing held identity preserved: 5 / true');
 assert.equal(queueStatus[2],'Retained test jobs: 0');assert.equal(queueStatus[3],'Active send controls: 0');
 pass('independent queue status confirms the persisted result and disabled empty queues');
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/canonical-conflicts.sql',import.meta.url),'utf8'));
 const routing=buildRevisionRoutingInstall();
 await db.query("update helm_pilot_installation.message_queue set project_ref='wrong'");
 await reject(routing.sql,/Reviewed isolated installation required/);
 await db.query("update helm_pilot_installation.message_queue set project_ref='jgkblfozftcvymvwhhii'");pass('route installer rejects unverified project');
 await db.query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true')");
 await reject(routing.sql,/Paused fictional-only route/);
 await db.query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','false')");pass('route installer refuses active publishing');
 await reject(routing.sql.replace('if h is distinct from t.row_digest then','if true then'),/Existing staging rows changed/);
 assert.equal(await scalar("select to_regclass('public.helm_staging_inventory_routes') data"),null);
 assert.equal(await scalar("select to_regprocedure('public.helm_pilot_revision_route()')::text data"),null);pass('route installer late failure removes all candidate objects and registration');
 await db.query(routing.sql);
 assert.equal(await scalar('select bundle_digest data from helm_pilot_installation.revision_routing'),routing.digest);
 assert.equal((await scalar('select helm_pilot_revision_route() data')).generation,1);
 assert.equal(await scalar('select count(*)::int data from helm_staging_inventory_routes'),1);
 pass('exact route installer preserves every prior table row and verifies retained canonical receipts');
 await reject(routing.sql,/Routing installation collision/);pass('route reinstall refuses replacement');
 for(const role of ['anon','authenticated','service_role'])
   assert.equal(await scalar("select has_table_privilege($1,'helm_pilot_installation.revision_routing','SELECT,INSERT,UPDATE,DELETE') data",[role]),false);
 pass('routing installation manifest remains owner-only');
 const dateFeed=buildMessageDateFeedInstall();
 await db.query("update helm_pilot_installation.revision_routing set bundle_digest='wrong'");
 await reject(dateFeed.sql,/Reviewed isolated date-feed prerequisites/);
 await db.query('update helm_pilot_installation.revision_routing set bundle_digest=$1',[routing.digest]);
 pass('date-feed installer requires the reviewed route installation');
 await db.query("update properties set automations_enabled=true");
 await reject(dateFeed.sql,/Paused fictional-only date-feed/);
 await db.query("update properties set automations_enabled=false");
 pass('date-feed installer refuses active senders');
 const observeDefinition=await scalar("select pg_get_functiondef('public.automation_message_observe_times(uuid,text,uuid,jsonb)'::regprocedure) data");
 await db.query("create or replace function public.automation_message_observe_times(p_booking_id uuid,p_canonical_revision text,p_expected_revision uuid,p_observation jsonb) returns uuid language sql as $$select null::uuid$$");
 await reject(dateFeed.sql,/Reviewed date-feed dependency changed/);
 await db.query(observeDefinition);
 pass('date-feed installer detects observation implementation drift');
 await reject(dateFeed.sql.replace('if after_rows is distinct from before_rows then','if true then'),/Date-feed rehearsal changed persistent data/);
 assert.equal(await scalar("select to_regclass('helm_channex_revisions.message_timing_policies') data"),null);
 assert.equal(await scalar("select to_regclass('helm_pilot_installation.message_date_feed') data"),null);
 assert.equal(await scalar("select to_regprocedure('public.helm_pilot_message_times_refresh(text,bigint,integer)')::text data"),null);
 pass('late date-feed rejection rolls back schema, canonical CRUD and observation writes');
 await db.query(dateFeed.sql);
 const dateProof=await scalar('select summary data from helm_pilot_installation.message_date_feed');
 for(const key of ['mapped_create_move_cancel','reviewed_clocks_preserved','confirmation_preserved','service_refresh_verified','repeat_is_idempotent','unproven_dates_blocked','cancellation_inactive','fixture_rolled_back','existing_rows_preserved'])assert.equal(dateProof[key],true,key);
 assert.equal(dateProof.provider_calls,0);assert.equal(dateProof.message_jobs_created,0);
 assert.equal(await scalar('select count(*)::int data from helm_channex_revisions.message_timing_policies'),0);
 assert.equal(await scalar('select count(*)::int data from automation_message_observations'),0);
 pass('actual mapped CRUD moves reviewed clocks, rejects unproven edits and stops on cancellation');
 assert.equal(await scalar('select count(*)::int data from bookings'),1);
 assert.equal(await scalar('select count(*)::int data from automation_sends'),6);
 assert.equal(await scalar('select count(*)::int data from helm_channex_revisions.receipts'),4);
 assert.equal(await scalar('select version data from helm_cleaner_rehearsal.delivery'),6);
 pass('installer retains original booking, six ledger rows, four receipts and cleaner state');
 await reject(dateFeed.sql,/Date-feed installation collision/);
 pass('date-feed reinstall refuses replacement');
 for(const role of ['anon','authenticated','service_role']) {
  assert.equal(await scalar("select has_function_privilege($1,'public.helm_pilot_message_times_register(uuid,uuid,text,bigint,text,timestamptz,boolean)','EXECUTE') data",[role]),false);
  assert.equal(await scalar("select has_function_privilege($1,'public.helm_pilot_message_times_refresh(text,bigint,integer)','EXECUTE') data",[role]),role==='service_role');
  for(const table of ['helm_channex_revisions.message_timing_policies','helm_pilot_installation.message_date_feed'])assert.equal(await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') data",[role,table]),false);
 }
 pass('only the existing service role can refresh; policy registration and receipts remain private');
 const dateStatus=(await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-date-feed-status.sql',import.meta.url),'utf8')))[1].rows;
 assert.equal(dateStatus.length,12);assert.equal(dateStatus[0].Result,'PASS');
 assert.equal(dateStatus[1].Result,'0');assert.equal(dateStatus[2].Result,'0');assert.equal(dateStatus[3].Result,'1 / 6 / 4');
 assert.equal(dateStatus[4].Result,'0');assert.equal(dateStatus[5].Result,'0');assert.equal(dateStatus[6].Result,'false');
 assert.equal(dateStatus[7].Result,'Owner only');assert.equal(dateStatus[8].Result,'Existing service role only');assert.equal(dateStatus[9].Result,dateFeed.digest);
 pass('independent committed date-feed readback verifies controls, retained rows, grants and exact digest');
 console.log(`PASS ${count} installation/preparation scenarios; original digest ${bundle.digest}; no external IO`);
}catch(e){console.error('FAIL',e.message,e.where??'');process.exitCode=1;}
finally{if(db)await db.end();if(running)ctl('-m','immediate','-w','stop');rmSync(root,{recursive:true,force:true});}
