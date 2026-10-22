// Called by the existing disposable PostgreSQL harness; no provider/network I/O.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { diffPlan } from '../src/lib/automations-core.ts';
import { quoFromNumber } from '../src/lib/quo-lines.ts';
import { verifyQueuePreparation } from './verify-message-queue-preparation.mjs';
export async function verifySourceHistory({ db, a, b, fixture, scalar }) {
 await db.query("alter table automation_sends add column body_rendered text, add column subject_rendered text, add column to_address text, add column missing_fields text[] default '{}', add column secrets_sent boolean default false");
 let count=0;const pass=s=>{count++;console.log(`PASS source history: ${s}`);};
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-history-handoff.sql',import.meta.url),'utf8'));
 const history=(f,flow=f.flow)=>({review_id:randomUUID(),context_revision:f.review.context_revision,observation_revision:f.observation,
  complete:true,sent:true,queued:false,uncertain:false,evidence_id:`HELMTEST:${randomUUID()}`,observed_at:f.obs.observed_at,workflow:flow,
  source_account_id:'HELMTEST-account',source_reservation_id:`HELMTEST:${f.booking}`,
  recipient_refs:flow.startsWith('cleaner')?['HELMTEST-cleaner-a','HELMTEST-cleaner-b']:['guest'],
  messages:(flow.startsWith('cleaner')?['HELMTEST-cleaner-a','HELMTEST-cleaner-b']:['guest']).map(recipient_ref=>({
   id:`HELMTEST:${randomUUID()}`,recipient_ref,sent_at:new Date(Date.parse(f.obs.observed_at)-3600000).toISOString()}))});
 const record=(f,review,c=db)=>scalar('select automation_message_import_history($1,$2) data',[f.send,review],c);
 const handoff=(f,entries=f.entries,c=db)=>scalar('select automation_message_handoff_stay($1,$2,$3) data',[f.booking,f.canonical,JSON.stringify(entries)],c);
 const read=f=>scalar('select to_jsonb(s) data from automation_sends s where id=$1',[f.send]);
 const bundle=async()=>{
  const f=await fixture('confirmation');f.entries=[{send_id:f.send,review:history(f)}];
  for(const flow of ['pre_arrival','key_code','pre_checkout','cleaner_advance','cleaner_arrival']){
   const rule=randomUUID(),send=randomUUID(),cleaner=flow.startsWith('cleaner');
   const trigger={pre_arrival:'pre_arrival',key_code:'checkin_day',pre_checkout:'pre_checkout',cleaner_advance:'pre_arrival',cleaner_arrival:'checkin_day'}[flow];
   const arrival=Date.parse(f.obs.check_in+'T16:00:00Z'),departure=Date.parse(f.obs.check_out+'T11:00:00Z');
   const at=new Date(flow==='pre_checkout'?departure-86400000:arrival-({pre_arrival:86400000,key_code:3600000,cleaner_advance:864000000,cleaner_arrival:25200000}[flow]));
   await db.query("insert into message_automations values($1,$2,$3,$4,'auto',true,false,'{}','HELMTEST synthetic reminder','UTC',null,$5)",[rule,f.property,flow,cleaner?'cleaner':'guest',trigger]);
   await db.query("insert into automation_sends(id,booking_id,property_id,automation_id,automation_key,status,fire_at,planned_check_in,planned_check_out,delivery_used,provider_message_id,sent_at,updated_at,error) select $1,id,property_id,$2,$3,$4,$5,check_in,check_out,null,null,null,clock_timestamp(),null from bookings where id=$6",[send,rule,flow,flow==='key_code'?'held':'scheduled',at,f.booking]);
   const review={...f.review,review_id:randomUUID(),workflow:flow,expires_at:new Date(at.getTime()+86400000).toISOString()};
   if(cleaner){review.from_number=quoFromNumber('ops');review.recipient_phones=['+12025550141','+12025550142'];}
   f.entries.push({send_id:send,review});
  }
  // The render context includes all effective rules. Capture it after setup.
  for(const e of f.entries)e.review.context_revision=await scalar('select automation_channex_context($1) data',[e.send_id]);
  return f;
 };
 let f=await fixture('confirmation'),review=history(f);
 await db.query("update automation_sends set body_rendered='HELMTEST unsent draft',to_address='HELMTEST-unsent-target',missing_fields='{HELMTEST}' where id=$1",[f.send]);
 assert.equal(await record(f,review),true);const row=await read(f);
 assert.equal(row.body_rendered,null);assert.equal(row.to_address,null);assert.deepEqual(row.missing_fields,[]);
 assert.equal(row.status,'sent');assert.equal(row.delivery_used,'guesty_history');assert.equal(row.provider_message_id,null);
 assert.equal(Date.parse(row.sent_at),Date.parse(review.messages[0].sent_at));
 assert.equal(await record(f,review),true);assert.equal(await scalar('select count(*)::int data from automation_message_source_receipts where send_id=$1',[f.send]),1);
 assert.equal(await scalar('select count(*)::int data from automation_channex_jobs where send_id=$1',[f.send]),0);
 pass('actual source time is preserved once; imported history never creates a new provider send');
 for(const sql of ["update automation_sends set status='scheduled' where id=$1","update automation_sends set delivery_used='sms' where id=$1",
  "update automation_sends set automation_key='HELMTEST-replaced' where id=$1","delete from automation_sends where id=$1"]){await assert.rejects(db.query(sql,[f.send]));}
 await assert.rejects(record(f,{...review,review_id:randomUUID()}),/identity conflict/);
 pass('terminal history cannot be requeued, rerouted, renamed, deleted or replaced by a conflicting review');
 const planned={booking_id:f.booking,automation_id:randomUUID(),automation_key:'confirmation',fire_at:new Date().toISOString(),status:'scheduled',error:null,planned_check_in:f.obs.check_in,planned_check_out:f.obs.check_out};
 assert.equal(diffPlan([planned],[row]).keyed,1);assert.deepEqual(diffPlan([planned],[row]).inserts,[]);
 await assert.rejects(db.query("insert into automation_sends(id,booking_id,property_id,automation_id,automation_key,status,fire_at,planned_check_in,planned_check_out,delivery_used,provider_message_id,sent_at,updated_at,error) select $1,booking_id,property_id,automation_id,automation_key,'scheduled',fire_at,planned_check_in,planned_check_out,null,null,null,clock_timestamp(),null from automation_sends where id=$2",[randomUUID(),f.send]),/cannot be replayed/);
 pass('real planner and database both prevent a replacement rule from replaying the same stay/message key');
 f=await fixture('cleaner_advance');review=history(f);
 await assert.rejects(record(f,{...review,messages:review.messages.slice(0,1)}),/incomplete/);
 await assert.rejects(record(f,{...review,recipient_refs:[review.recipient_refs[0],review.recipient_refs[0]]}),/set mismatch/);
 assert.equal(await record(f,review),true);
 assert.equal(await scalar('select count(*)::int data from automation_message_source_receipts where send_id=$1',[f.send]),2);
 pass('cleaner history needs a distinct source receipt for every reviewed recipient');
 const other=await fixture('cleaner_advance'),otherReview=history(other);
 otherReview.messages[0].id=review.messages[0].id;
 await assert.rejects(record(other,otherReview),/duplicate key/);
 assert.equal((await read(other)).status,'scheduled');assert.equal(await scalar('select count(*)::int data from automation_message_source_history where send_id=$1',[other.send]),0);
 pass('one source message cannot settle two stays; conflicting receipt import rolls back');
 const alias=await fixture('cleaner_advance'),aliasReview=history(alias);
 aliasReview.source_reservation_id=review.source_reservation_id;
 await assert.rejects(record(alias,aliasReview),/another canonical stay/);
 assert.equal((await read(alias)).status,'scheduled');
 pass('one Guesty reservation cannot be rebound to a different canonical stay using different message IDs');
 f=await fixture('confirmation');review=history(f);
 const aPid=await scalar('select pg_backend_pid() data',[],a),bPid=await scalar('select pg_backend_pid() data',[],b);
 await a.query('begin');assert.equal(await record(f,review,a),true);
 const pending=b.query("insert into automation_sends(id,booking_id,property_id,automation_id,automation_key,status,fire_at,planned_check_in,planned_check_out,delivery_used,provider_message_id,sent_at,updated_at,error) select $1,booking_id,property_id,automation_id,automation_key,'scheduled',fire_at,planned_check_in,planned_check_out,null,null,null,clock_timestamp(),null from automation_sends where id=$2",[randomUUID(),f.send]);
 const rejected=assert.rejects(pending,/cannot be replayed/);
 let waiting=false;for(let n=0;n<200;n++){
  waiting=await scalar('select $1::int=any(pg_blocking_pids($2)) data',[aPid,bPid]);if(waiting)break;await delay(10);
 }
 assert.equal(waiting,true);await a.query('commit');await rejected;
 pass('a concurrent replacement-rule insert waits for the history import and cannot slip through before its commit');
 f=await fixture('confirmation');review=history(f);
 for(const patch of [{complete:false},{queued:true},{uncertain:true},{sent:'true'},
  {observed_at:new Date(Date.now()-3600000).toISOString()},
  {messages:[{...review.messages[0],sent_at:new Date(Date.now()+3600000).toISOString()}]},
  {messages:[{...review.messages[0],body:'HELMTEST must not persist'}]},
  {recipient_refs:['other']},{workflow:'cleaner_arrival'},{observation_revision:randomUUID()}]){
  await assert.rejects(record(f,{...review,...patch}));assert.equal((await read(f)).status,'scheduled');
 }
 pass('unknown/queued history, stale observation, future receipts, raw body fields and mismatched identities cannot suppress a message');
 f=await bundle();const result=await handoff(f);
 assert.equal(result.length,6);assert.equal(result.filter(x=>x.result==='source_sent').length,1);assert.equal(result.filter(x=>x.result==='future_registered').length,5);
 const statuses=(await db.query('select automation_key,status,delivery_used from automation_sends where booking_id=$1',[f.booking])).rows;
 assert.equal(statuses.find(x=>x.automation_key==='key_code').status,'held');assert.equal(statuses.filter(x=>x.delivery_used==='channex').length,3);
 assert.equal(statuses.filter(x=>x.delivery_used==='quo_cleaner').length,2);
 assert.equal(await scalar('select enabled data from automation_channex_routes where property_id=$1',[f.property]),false);
 assert.equal(await scalar('select count(*)::int data from automation_cleaner_batches where property_id=$1 and enabled',[f.property]),0);
 assert.deepEqual(await handoff(f),result);
 pass('one atomic mixed handoff imports past confirmation, registers five future workflows, retains key-code hold and leaves all senders off');
 f=await bundle();const broken=structuredClone(f.entries).sort((x,y)=>x.send_id.localeCompare(y.send_id));broken.at(-1).review.uncertain=true;
 await assert.rejects(handoff(f,broken));
 assert.equal(await scalar('select count(*)::int data from automation_message_source_history where booking_id=$1',[f.booking]),0);
 assert.equal(await scalar('select count(*)::int data from automation_message_handoffs h join automation_sends s on s.id=h.send_id where s.booking_id=$1',[f.booking]),0);
 assert.equal(await scalar('select count(*)::int data from automation_sends where booking_id=$1 and delivery_used is not null',[f.booking]),0);
 pass('one bad final workflow rolls back every earlier history record, receipt and future registration');
 for(const invalid of [f.entries.slice(0,5),[...f.entries.slice(0,5),f.entries[0]],f.entries.map((e,i)=>i===5?{...e,send_id:randomUUID()}:e)])await assert.rejects(handoff(f,invalid));
 await db.query('update bookings set check_out=check_out+1 where id=$1',[f.booking]);await assert.rejects(handoff(f),/current stay/);
 pass('partial, duplicate, foreign and stale stay manifests cannot be handed over');
 f=await bundle();const attempts=await Promise.all([handoff(f,f.entries,a),handoff(f,f.entries,b)]);
 assert.deepEqual(attempts[0],attempts[1]);
 assert.equal(await scalar('select count(*)::int data from automation_message_source_history where booking_id=$1',[f.booking]),1);
 assert.equal(await scalar('select count(*)::int data from automation_message_handoffs h join automation_sends s on s.id=h.send_id where s.booking_id=$1',[f.booking]),5);
 pass('overlapping full-stay imports converge on the same six durable results');
 f=await fixture('confirmation');review=history(f);
 for(const role of ['anon','authenticated','service_role']){
  await db.query(`set role ${role}`);
  for(const [sql,args] of [['select automation_message_import_history($1,$2)',[f.send,review]],
   ['select automation_message_handoff_stay($1,$2,$3)',[f.booking,f.canonical,[]]],
   ['select * from automation_message_source_stays',[]],['select * from automation_message_source_history',[]],['select * from automation_message_source_receipts',[]]])await assert.rejects(db.query(sql,args),/permission denied/);
  await db.query('reset role');
 }
 pass('browser and execution-worker roles cannot manufacture source history or run the migration handoff');
 console.log(`PASS ${count} additional PostgreSQL source-history scenarios; synthetic evidence only`);
 await verifyQueuePreparation({db,a,b,bundle,scalar});
}
