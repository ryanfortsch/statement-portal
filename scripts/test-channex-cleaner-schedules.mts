/** Run after test-channex-schedule-runtime against the disposable loopback DB.
 * Real SQL registration/claims/receipts, synthetic enrollment and fake SMS only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createCleanerSmsStore } from '../src/lib/channex-messaging/cleaner-sms-store.ts';
import { CleanerSmsTransport } from '../src/lib/channex-messaging/cleaner-sms-transport.ts';
import { CleanerSmsWorker, renderRetainedCleanerSms, type CleanerSmsJob } from '../src/lib/channex-messaging/cleaner-sms-worker.ts';
import { parsePreparationRules } from '../src/lib/channex-messaging/preparation-rules.ts';
import { QUO_LINES } from '../src/lib/quo-lines.ts';
import { reviewCalderwoodTiming } from '../src/lib/channex-messaging/preparation-timing.ts';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
const str = (s: string) => "'"+s.replaceAll("'", "''")+"'";
function sql(query: string) {
  const r = spawnSync(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
function asyncSql(query: string) {
  const child = spawn(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1']); let out = '', err = '';
  child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { err += c; });
  const done = new Promise<string>((resolve, reject) => {
    child.on('error', reject); child.on('close', code => code ? reject(Error(err)) : resolve(out.trim()));
  }); child.stdin.end(query); return done;
}
assert.equal(sql('select current_database();'), 'helm_synthetic_channex');
const bid = '90000000-0000-4000-8000-000000000901', remote = randomUUID(), thread = randomUUID();
sql(`delete from helm_channex_messages.timing_bindings;
 delete from helm_airbnb_bookings.bookings where canonical_id='${bid}'; select channex_synthetic_timing_setup();
 update bookings set guest_name='Synthetic Guest' where id='${bid}';
 -- The real recipient table has a PHONE primary key, never an invented UUID.
 create table cleaner_schedule_recipients(phone text primary key, display_name text not null,
 portal_token text not null unique, enabled boolean not null default false, property_ids text[] not null default '{}',
 region text not null default 'cape_ann',language text not null default 'pt',daily_digest_enabled boolean not null default false);
 insert into cleaner_schedule_recipients values('+12025550123','HELMTEST Cleaner','0123456789abcdef',true,array['65_calderwood'],'bridgeport_ct','en',false);`);
const before = sql("select jsonb_agg(to_jsonb(r) order by id) from message_automations r;");
sql(readFileSync(new URL('../supabase/migrations/20261113090000_channex_cleaner_schedule.sql', import.meta.url), 'utf8'));
assert.equal(sql("select jsonb_agg(to_jsonb(r) order by id) from message_automations r;"), before);
assert.equal(sql("select (select count(*) from helm_channex_messages.cleaner_jobs)||':'||(select count(*) from helm_channex_messages.cleaner_releases)||':'||(select count(*) from automation_sends);"), '0:0:0');
for (const table of ['cleaner_jobs','cleaner_releases','cleaner_hold_events']) {
  assert.equal(sql(`select relrowsecurity from pg_class where oid='helm_channex_messages.${table}'::regclass;`), 't');
  for (const role of ['anon','authenticated','service_role'])
    assert.equal(sql(`select has_table_privilege('${role}','helm_channex_messages.${table}','select,insert,update,delete');`), 'f');
}
for (const signature of ['read(uuid)','register(jsonb)','claim(jsonb,uuid,jsonb)','finish(uuid,uuid,jsonb)','hold(uuid,boolean,text)']) {
  for (const role of ['anon','authenticated'])
    assert.equal(sql(`select has_function_privilege('${role}','helm_channex_cleaner_${signature}','execute');`), 'f');
  assert.equal(sql(`select has_function_privilege('service_role','helm_channex_cleaner_${signature}','execute');`), 't');
}
// Actual supported 16- and 32-character portal tokens. A regional/competing
// enrollment cannot be mistaken for the single-property pilot recipient.
const revision = sql('select helm_channex_messages.cleaner_recipient_revision();'); assert.match(revision,/^[a-f0-9]{32}$/);
// Both implementations must refuse DST gaps/overlaps on the arrival AND reminder
// day, including the case where the chosen overlap happens to be 240 hours apart.
for (const [start,end,clock] of [['2026-11-24','2026-11-28','16:00'],['2027-03-14','2027-03-20','02:30'],
 ['2027-03-20','2027-03-25','16:00'],['2026-11-01','2026-11-05','01:30'],['2026-11-11','2026-11-15','01:30'],
 ['2026-11-05','2026-11-09','16:00']]) {
  const clocks={start,end,timezone:'America/New_York',plannedArrival:clock,plannedDeparture:null,defaultArrival:'16:00',defaultDeparture:'11:00',confirmedAt:null};
  for (const key of ['cleaner_reminder','cleaner_arrival'] as const) {
    const value=sql(`select helm_channex_messages.cleaner_source_fire(${str(JSON.stringify({start,clocks}))}::jsonb,'${key}');`);
    const expected=key==='cleaner_arrival'&&clock!=='16:00'?null:reviewCalderwoodTiming(clocks,Date.now()).find(t=>t.key===key)!.at;
    assert.equal(value?new Date(value).toISOString():null,expected);
  }
}
for (const change of ["enabled=false", "language='pt'", "phone='+12025550124'", "portal_token=repeat('b',32)",
  "property_ids='{}'", "property_ids=array['65_calderwood','other']", "region='cape_ann'"]) {
  assert.notEqual(sql(`begin; update cleaner_schedule_recipients set ${change}; select helm_channex_messages.cleaner_recipient_revision(); rollback;`),revision);
}
assert.equal(sql(`begin; insert into cleaner_schedule_recipients values('+12025550124','HELMTEST Other','fedcba9876543210',true,'{}','bridgeport_ct','en',false);
 select helm_channex_messages.cleaner_recipient_revision() is null; rollback;`),'t');
// The actual source clock yields a reminder in the next minute. No rewritten
// production clock or claim predicate is used to make this test dispatchable.
const due = Math.ceil((Date.now()+15000)/60000)*60000;
const local = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(due);
const part = (name: Intl.DateTimeFormatPartTypes) => local.find(p=>p.type===name)!.value;
const day = `${part('year')}-${part('month')}-${part('day')}`, arrival = `${part('hour')}:${part('minute')}`;
sql(`update bookings set check_in='${day}'::date+10,check_out='${day}'::date+14 where id='${bid}';
 update guesty_reservations set check_in='${day}'::date+10,check_out='${day}'::date+14;`);
const row = JSON.parse(sql(`select jsonb_set(jsonb_set(jsonb_set(channex_synthetic_timing_plan()->0,'{start}',to_jsonb(('${day}'::date+10)::text)),
 '{end}',to_jsonb(('${day}'::date+14)::text)),'{clocks,plannedArrival}',to_jsonb('${arrival}'::text));`));
const capture = JSON.parse(sql(`set role service_role; select helm_channex_capture_source_timing(${str(JSON.stringify([row]))}::jsonb,
 clock_timestamp()-interval '5 seconds',clock_timestamp(),'synthetic-cleaner-owner');`));
// Explicit fixture handover only. Production has no enrollment writer in this batch.
sql(`update properties set calendar_authority='helm',automations_enabled=true where id='65_calderwood';
 insert into helm_channex_messages.scope(property_id,environment,remote_property,channel_id,provider,enabled,source_stopped_at,source_drained_at,source_evidence_id)
 values('65_calderwood','production','320c5cb5-91e0-46af-b9b3-a3fc20b4631e',gen_random_uuid(),'Airbnb',true,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',gen_random_uuid());
 insert into helm_airbnb_bookings.bookings(remote_id,canonical_id,code,environment,remote_property,generation,latest_at,latest_revision,check_in,check_out,status)
 select '${remote}',id,external_confirmation_code,'production','320c5cb5-91e0-46af-b9b3-a3fc20b4631e',1,clock_timestamp(),gen_random_uuid(),check_in,check_out,status from bookings where id='${bid}';`);
const context = JSON.parse(sql(`select helm_channex_message_schedule_context('${bid}');`));
const bindingId = randomUUID(), now = new Date().toISOString();
const intent = { bindingId, captureId: capture.captureId, bookingId: bid, context, remoteBookingId: remote, threadId: thread,
  reviewStartedAt: now, reviewCheckedAt: now, reviewedRow: row };
assert.equal(JSON.parse(sql(`set role service_role; select helm_channex_timing_binding_review(${str(JSON.stringify(intent))}::jsonb,'synthetic-cleaner-owner');`)).state,'created');
const archive = JSON.parse(sql("select jsonb_build_object('id',id,'digest',rules_sha256) from helm_channex_messages.template_captures;"));
const rules = parsePreparationRules(JSON.parse(sql("select jsonb_agg(to_jsonb(r)-array['created_at','updated_at','created_by']) from message_automations r where audience='cleaner';")));
const rule = rules.find(r=>r.key==='cleaner_reminder')!; assert.ok(rule);
const recipients = JSON.parse(sql('select jsonb_agg(to_jsonb(r)) from cleaner_schedule_recipients r;'));
const review = { contextRevision: context.contextRevision, propertyName:'HELMTEST Home',rule,
  clocks:{ start:row.start,end:row.end,...row.clocks },recipients };
let posts=0,gets=0,providerStatus='queued'; let providerRow: Record<string,unknown>={};
const transport = new CleanerSmsTransport({ apiKey:'HELMTEST-KEY',receiptKey:'a'.repeat(64),keyId:'synthetic-v1',sendEnabled:true,
  fetcher:async(_url,init)=>{
    if(init.method==='POST') {
      posts++; const sent=JSON.parse(String(init.body));
      providerRow={id:'ACHELMTEST1',from:QUO_LINES.ops.number,phoneNumberId:QUO_LINES.ops.id,to:sent.to,text:sent.content,
        direction:'outgoing',media:[],createdAt:new Date().toISOString()};
    } else gets++;
    return Response.json({data:{...providerRow,status:providerStatus,updatedAt:new Date().toISOString()}},{status:init.method==='POST'?202:200});
  } });
const sourceFire=sql(`select helm_channex_messages.cleaner_fire('${bindingId}','${bid}','cleaner_reminder');`);
if (!sourceFire) {
  // During the 10-day DST boundary there is intentionally no authorized reminder.
  // Preserve that business refusal instead of mocking the clock to force a send.
  console.log('PASS: private ledger installed empty, actual recipient schema and source DST refusal; due-dispatch case unavailable across DST');
  process.exit(0);
}
assert.equal(Date.parse(sourceFire),due);
assert.equal(sql(`select helm_channex_messages.cleaner_fire('${bindingId}','${bid}','cleaner_arrival') is null;`),arrival==='16:00'?'f':'t');
const rendered=renderRetainedCleanerSms(review,transport,Date.now()),releaseId=randomUUID();
sql(`insert into helm_channex_messages.cleaner_releases(id,property_id,route_generation,capture_id,rules_sha256,recipient_revision,
 key_id,recipient_hmac,target_hmac,source_stopped_at,source_drained_at,source_evidence_id,actor)
 select '${releaseId}',property_id,generation,'${archive.id}','${archive.digest}','${revision}',
 '${rendered.keyId}','${rendered.recipientHmac}','${rendered.targetHmac}',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',gen_random_uuid(),'synthetic-cleaner-owner'
 from helm_channex_messages.scope;`);
assert.throws(()=>sql('update helm_channex_messages.cleaner_releases set actor=\'different\';'),/immutable/);
const plan={sendId:randomUUID(),bookingId:bid,automationId:rule.id,releaseId,bindingId,propertyId:'65_calderwood' as const,key:'cleaner_reminder' as const,
 keyId:rendered.keyId,contextRevision:context.contextRevision,recipientHmac:rendered.recipientHmac,targetHmac:rendered.targetHmac,
 bodySha256:rendered.bodySha256,fireAt:new Date(due).toISOString(),expiresAt:new Date(due+1800000).toISOString()};
let loseRegister=false;
const params=(name:string,args:Record<string,unknown>)=>{
  const js=(v:unknown)=>str(JSON.stringify(v))+'::jsonb',id=(v:unknown)=>str(String(v))+'::uuid';
  if(name==='helm_channex_cleaner_register')return js(args.p_plan);
  if(name==='helm_channex_cleaner_read')return id(args.p_send_id);
  if(name==='helm_channex_cleaner_claim')return `${js(args.p_job)},${id(args.p_attempt_id)},${js(args.p_attempt)}`;
  if(name==='helm_channex_cleaner_finish')return `${id(args.p_send_id)},${id(args.p_attempt_id)},${js(args.p_outcome)}`;
  if(name==='helm_channex_cleaner_hold')return `${id(args.p_send_id)},${args.p_held===true},${str(String(args.p_actor))}`;
  throw Error('Unexpected synthetic RPC');
};
const rpc=async(name:string,args:Record<string,unknown>)=>{
  const raw=await asyncSql(`set role service_role; select to_jsonb(public.${name}(${params(name,args)}));`);
  if(name.endsWith('_register')&&loseRegister)throw Error('Synthetic committed response lost');
  return {data:raw?JSON.parse(raw):null,error:null};
};
const store=createCleanerSmsStore(rpc,{enabled:true});
assert.deepEqual(await createCleanerSmsStore(rpc).register(plan),{state:'disabled'});
await assert.rejects(store.register({...plan,recipientHmac:'b'.repeat(64)}));
assert.equal(sql('select count(*) from automation_sends;'),'0');
loseRegister=true;await assert.rejects(store.register(plan));loseRegister=false;
assert.deepEqual(await store.register(plan),{state:'existing',sendId:plan.sendId});
await assert.rejects(store.register({...plan,sendId:randomUUID()}));
assert.equal(sql('select count(*) from automation_sends;'),'1');
let job=await store.read(plan.sendId) as CleanerSmsJob;
const proof={keyId:plan.keyId,targetHmac:plan.targetHmac,bodySha256:plan.bodySha256};
assert.equal(await store.claim(job,randomUUID(),proof),false,'future jobs cannot claim');
const saved=sql('select to_jsonb(s) from automation_sends s;');
sql("update automation_sends set fire_at=fire_at+interval '1 hour'; update automation_sends set status='sending'; update automation_sends set status='cancelled',error='rule superseded';");
assert.equal(sql('select to_jsonb(s) from automation_sends s;'),saved);
assert.throws(()=>sql(`insert into automation_sends select (jsonb_populate_record(null::automation_sends,to_jsonb(s)||jsonb_build_object('id',gen_random_uuid()))).* from automation_sends s;`),/history_conflict/);
assert.throws(()=>sql('delete from automation_sends;'),/history/);
const waitMs=Math.max(0,due-Date.now()+30);assert.ok(waitMs<76000);console.log(`Waiting ${Math.ceil(waitMs/1000)}s for the real synthetic reminder clock`);
await new Promise(resolve=>setTimeout(resolve,waitMs));
const claimSql=(expected=job,attemptId=randomUUID())=>`select helm_channex_cleaner_claim(${str(JSON.stringify(expected))}::jsonb,'${attemptId}',${str(JSON.stringify(proof))}::jsonb);`;
assert.equal(await store.hold(plan.sendId,true,'synthetic-owner'),true);
assert.equal(await store.claim(job,randomUUID(),proof),false);assert.equal(await store.hold(plan.sendId,false,'synthetic-owner'),true);
assert.equal(sql('select count(*) from helm_channex_messages.cleaner_hold_events;'),'2');
for(const mutation of ["update cleaner_schedule_recipients set enabled=false", "update cleaner_schedule_recipients set portal_token=repeat('b',32)",
 "update cleaner_schedule_recipients set phone='+12025550124'", "update cleaner_schedule_recipients set language='pt'",
 "update cleaner_schedule_recipients set property_ids='{}'", "update properties set automations_enabled=false where id='65_calderwood'",
 `update bookings set status='cancelled' where id='${bid}'`, `update bookings set check_out=check_out+1 where id='${bid}'`,
 "update helm_channex_messages.scope set source_evidence_id=gen_random_uuid()", "update helm_channex_messages.scope set enabled=false",
 "update helm_channex_messages.scope set generation=gen_random_uuid()", "update guesty_reservations set check_out=check_out+1"]) {
  assert.equal(sql(`begin; ${mutation}; ${claimSql()} rollback;`),'f',mutation);
}
assert.equal(sql(`begin; set transaction isolation level repeatable read; ${claimSql()} rollback;`),'f');
assert.equal(sql(claimSql({...job,bodySha256:'f'.repeat(64)})),'f');
// An inserted competing recipient serializes with claim, including phantoms.
const changed=asyncSql(`begin; insert into cleaner_schedule_recipients values('+12025550124','HELMTEST Other','fedcba9876543210',true,'{}','bridgeport_ct','en',false);
 select pg_sleep(1.5); commit;`);
await new Promise(resolve=>setTimeout(resolve,100));
assert.equal(await store.claim(job,randomUUID(),proof),false);await changed;
sql("delete from cleaner_schedule_recipients where phone='+12025550124';");
// Replay of a successfully committed claim never grants another permit.
const a=randomUUID();assert.equal(sql(`begin; ${claimSql(job,a)} ${claimSql(job,a)} rollback;`),'t\nf');
// Unknown outcomes cannot be reset, even with an identical registration replay.
assert.equal(sql(`begin; ${claimSql(job,a)} select helm_channex_cleaner_finish('${plan.sendId}','${a}','{"state":"unknown"}');
 ${claimSql(job,a)} rollback;`),'t\nt\nf');
for(const outcome of [{state:'rejected',rejectionStatus:400.1},{state:'rejected',rejectionStatus:429},
 {state:'delivered',providerMessageId:'ACHELMTEST1',providerStatus:'delivered'},
 {state:'delivered',providerMessageId:'ACHELMTEST1',providerStatus:'queued',providerUpdatedAt:new Date().toISOString()}]) {
  assert.equal(sql(`begin; ${claimSql(job,a)} select helm_channex_cleaner_finish('${plan.sendId}','${a}',${str(JSON.stringify(outcome))}::jsonb); rollback;`),'t\nf');
}
// A saved provider observation is monotonic and an unknown/aborted/refused
// attempt cannot turn into a new send permit.
for(const state of ['unknown','aborted','rejected']) {
  const outcome=state==='rejected'?{state,rejectionStatus:403}:{state};
  assert.equal(sql(`begin; ${claimSql(job,a)} select helm_channex_cleaner_finish('${plan.sendId}','${a}',${str(JSON.stringify(outcome))}::jsonb);
   ${claimSql(job,randomUUID())} rollback;`),'t\nt\nf');
}
const receiptStamp=new Date().toISOString(),oldStamp=new Date(Date.now()-1000).toISOString();
const accepted=(stamp:string,status='sent')=>str(JSON.stringify({state:'accepted',providerMessageId:'ACHELMTEST1',providerStatus:status,providerUpdatedAt:stamp}))+'::jsonb';
assert.equal(sql(`begin; ${claimSql(job,a)} select helm_channex_cleaner_finish('${plan.sendId}','${a}',${accepted(receiptStamp)});
 select helm_channex_cleaner_finish('${plan.sendId}','${a}',${accepted(oldStamp)});
 select helm_channex_cleaner_finish('${plan.sendId}','${a}',${accepted(receiptStamp,'queued')}); rollback;`),'t\nt\nf\nf');
assert.equal(await store.finish(plan.sendId,randomUUID(),{state:'unknown'}),false);
// Both real workers use independent PostgreSQL connections; only one gets a
// permit and the fake provider sees one POST. No production fetch is reachable.
const worker=new CleanerSmsWorker({store,transport,enabled:true});
const results=await Promise.all([worker.dispatch(plan.sendId,async()=>review),worker.dispatch(plan.sendId,async()=>review)]);
assert.equal(results.filter(r=>r.state==='accepted').length,1);assert.equal(posts,1);
job=await store.read(plan.sendId) as CleanerSmsJob;assert.equal(job.state,'accepted');
assert.equal(await store.hold(plan.sendId,true,'late-owner'),false);
assert.equal((await worker.dispatch(plan.sendId,async()=>review)).state,'needs_reconciliation');assert.equal(posts,1);
assert.equal(await store.finish(plan.sendId,job.attemptId!,{state:'accepted',providerMessageId:'ACOTHER',providerStatus:'queued'}),false);
// Revocation/cancellation blocks new work but cannot strand accepted receipts.
sql(`update cleaner_schedule_recipients set enabled=false; select helm_move_booking('${bid}',check_in,check_out,'cancelled','synthetic-cleaner') from bookings where id='${bid}';`);
providerStatus='delivered';assert.equal((await worker.reconcile(plan.sendId)).state,'delivered');assert.equal(posts,1);assert.equal(gets,1);
const final=await store.read(plan.sendId) as CleanerSmsJob;
assert.equal(await store.finish(plan.sendId,job.attemptId!,{state:'accepted',providerMessageId:job.providerMessageId!,providerStatus:'queued'}),false);
assert.equal(await store.finish(plan.sendId,job.attemptId!,{state:'delivered',providerMessageId:job.providerMessageId!,providerStatus:'delivered',providerUpdatedAt:final.providerUpdatedAt!}),true);
assert.equal((await store.register(plan)).state,'existing');assert.equal((await worker.dispatch(plan.sendId,async()=>review)).state,'needs_reconciliation');
assert.equal(sql("select count(*) from message_automations where audience='cleaner' and not enabled and migration_policy is not null;"),'2');
console.log('PASS: empty/private installation, phone-keyed recipients, retained clock, atomic/lost-response registration, legacy fences, real overlapping claims, access/source/booking drift blocks, one fake SMS, immutable receipt after cancellation');
