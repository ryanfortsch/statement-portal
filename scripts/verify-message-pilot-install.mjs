// Real PostgreSQL + canonical application DDL. No env/hosted/provider access.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildCanonicalPilotInstall } from './build-canonical-pilot-install.mjs';
import { buildMessagePilotInstall } from './build-message-pilot-install.mjs';
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
 await db.query(`insert into helm_booking_inventory_consumers(property_id,configuration) values('HELMTEST-calderwood','{"publishEnabled":false}')`);
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
 // Verify the separate incremental candidate on the ACTUAL canonical schema.
 // The prior installer remains byte-for-byte reproducible and is never rerun as
 // an upgrade. This additional six-message rehearsal still rolls back all rows.
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-queue-preparation.sql',import.meta.url),'utf8'));
 let automatic=readFileSync(new URL('../docs/guesty-exit/staging-storage/message-hosted-rehearsal.sql',import.meta.url),'utf8');
 assert.ok(automatic.includes("jsonb_build_object('send_id',row_send.id,'review',review)"));
 automatic=automatic.replace("jsonb_build_object('send_id',row_send.id,'review',review)",
  "jsonb_build_object('automation_id',row_send.automation_id,'fire_at',row_send.fire_at,'review',review)")
  .replaceAll('public.automation_message_handoff_stay(b,canon,','public.automation_message_prepare_handoff(b,canon,')
  .replace('  -- Last entry rejects AFTER earlier writes,',
   "  delete from public.automation_sends where booking_id=b and status<>'held';\n  -- Last entry rejects AFTER earlier writes,");
 const automaticResult=await db.query('begin;create temporary table helm_message_rehearsal_result(summary jsonb) on commit drop;'+automatic+
  'select summary from helm_message_rehearsal_result;rollback;');
 const prepared=automaticResult.at(-2).rows[0].summary;
 assert.equal(prepared.workflows,6);assert.equal(prepared.fixture_rolled_back,true);assert.equal(prepared.existing_rows_preserved,true);
 assert.equal(prepared.future_guest_jobs,3);assert.equal(prepared.fictional_cleaner_recipient_jobs,4);
 assert.equal(await scalar('select count(*)::int data from automation_channex_jobs'),0);
 pass('incremental queue preparation reuses the held row and creates the other five on canonical tables; all fixture data rolls back');
 for(const role of ['anon','authenticated','service_role'])for(const name of ['automation_message_prepare_handoff(uuid,text,jsonb)',
  'automation_message_preparation_snapshot(uuid)','automation_message_booking_context(uuid)'])
  assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE') data",[role,'public.'+name]),false);
 pass('incremental preparation remains owner-only on canonical schema');
 console.log(`PASS ${count} installation/preparation scenarios; original digest ${bundle.digest}; no external IO`);
}catch(e){console.error('FAIL',e.message,e.where??'');process.exitCode=1;}
finally{if(db)await db.end();if(running)ctl('-m','immediate','-w','stop');rmSync(root,{recursive:true,force:true});}
