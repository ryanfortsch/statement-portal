// Disposable PostgreSQL fixture only; no live providers or sender activation.
import assert from 'node:assert/strict';
import { verifyNewStayTiming } from './verify-message-new-stay-timing.mjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
export async function verifyReceiptTiming({db,scalar,connection,generation}) {
 let count=0;const pass=s=>{count++;console.log('PASS receipt timing: '+s);};
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-receipt-timing.sql',import.meta.url),'utf8'));
 const stamp=new Date(Date.now()-10000).toISOString();
 await db.query("insert into helm_channex_revisions.message_receipt_policy values(true,$1,$2,$3,clock_timestamp()+interval '1 day',false)",[connection,generation,stamp]);
 const fixture=async({status='new',outcome='applied',receivedAt=new Date().toISOString(),prior=false,migration=false,rollback=false}={})=>{
  const booking=randomUUID(),remote=randomUUID(),revision=randomUUID();
  await db.query("insert into bookings(id,property_id,status,check_in,check_out,channel,guest_name,source_ref,source) values($1,'HELMTEST-calderwood','confirmed','2027-02-01','2027-02-04','other','HELMTEST',$2,'manual')",[booking,'channex-staging:'+remote]);
  await db.query('insert into helm_channex_revisions.bookings values($1,$2,$3,clock_timestamp(),$4)',[remote,booking,'HELMTEST-'+remote,revision]);
  if(migration) await db.query("insert into automation_channex_stay_times values($1,'2027-02-01','2027-02-04','16:00','11:00',clock_timestamp()-interval '1 day',clock_timestamp(),'HELMTEST-migration')",[booking]);
  if(prior) await db.query("insert into helm_channex_revisions.receipts(revision_id,canonical_id,revision,outcome) values($1,$2,$3,'applied')",[randomUUID(),booking,{status:'modified',bookingId:remote,receivedAt}]);
  if(rollback)await db.query('begin');
  await db.query('insert into helm_channex_revisions.receipts(revision_id,canonical_id,revision,outcome) values($1,$2,$3,$4)',[revision,booking,{status,bookingId:remote,receivedAt},outcome]);
  if(rollback)await db.query('rollback');
  return {booking,remote,revision};
 };
 const anchor=f=>scalar('select automation_message_confirmation_anchor($1) data',[f.booking]);
 const saved=f=>scalar('select (select to_jsonb(a) from helm_channex_revisions.message_receipt_anchors a where booking_id=$1) data',[f.booking]);
 let f=await fixture();assert.equal(await anchor(f),null);pass('default-disabled policy records no anchors');
 await db.query('update helm_channex_revisions.message_receipt_policy set enabled=true');
 assert.equal(await anchor(f),null);pass('enablement does not backfill existing bookings');
 f=await fixture();let original=await saved(f);
 assert.equal(original.basis,'helm-first-durable-receipt');
 const committed=await scalar('select committed_at data from helm_channex_revisions.receipts where revision_id=$1',[f.revision]);
 assert.equal(Date.parse(original.received_at),committed.getTime());
 assert.equal((await anchor(f)).getTime(),committed.getTime());
 assert.equal(await scalar('select count(*)::int data from automation_channex_stay_times where booking_id=$1',[f.booking]),0);
 pass('first durable Helm commit is the anchor; no invented original confirmation');
 // Exercise the actual schedule function with a complete fictional render context.
 const send=randomUUID(),rule=randomUUID();
 await db.query("select automation_message_observe_times($1,automation_message_stay_revision($1),null,$2)",[f.booking,{check_in:'2027-02-01',check_out:'2027-02-04',arrival_time:'16:00',departure_time:'11:00',confirmed_at:null,observed_at:new Date().toISOString(),source_revision:'HELMTEST-clock-review',evidence_id:'HELMTEST-receipt-clocks'}]);
 await db.query("insert into message_automations(id,property_id,key,audience,send_mode,enabled,configured_in_ota,channel_exclusions,body,timezone,trigger) values($1,'HELMTEST-calderwood','confirmation','guest','auto',false,false,'{}','HELMTEST','America/New_York','booking_confirmed')",[rule]);
 await db.query("insert into automation_sends(id,booking_id,property_id,automation_id,automation_key,status) values($1,$2,'HELMTEST-calderwood',$3,'confirmation','scheduled')",[send,f.booking,rule]);
 const schedule=flow=>db.query('select * from automation_message_schedule_candidates($1,$2)',[send,flow]).then(r=>r.rows[0]);
 assert.equal((await schedule('confirmation')).calendar_at.getTime(),committed.getTime()+1800000);
 const expected={pre_arrival:'2027-01-31T21:00:00.000Z',key_code:'2027-02-01T20:00:00.000Z',pre_checkout:'2027-02-03T16:00:00.000Z',cleaner_advance:'2027-01-22T21:00:00.000Z',cleaner_arrival:'2027-02-01T14:00:00.000Z'};
 for(const [flow,at] of Object.entries(expected))assert.equal((await schedule(flow)).calendar_at.toISOString(),at);
 pass('real scheduler uses receipt plus 30 minutes; all five existing offsets preserved');
 await db.query("insert into helm_channex_revisions.receipts(revision_id,canonical_id,revision,outcome) values($1,$2,$3,'applied')",[randomUUID(),f.booking,{status:'modified',bookingId:f.remote,receivedAt:new Date().toISOString()}]);
 assert.deepEqual(await saved(f),original);assert.equal((await schedule('confirmation')).calendar_at.getTime(),committed.getTime()+1800000);
 pass('later booking revision cannot restart the countdown');
 await db.query("update bookings set status='cancelled' where id=$1",[f.booking]);assert.equal(await anchor(f),null);
 await db.query("update bookings set status='confirmed' where id=$1",[f.booking]);
 await db.query('update helm_channex_revisions.message_receipt_policy set enabled=false');assert.equal(await anchor(f),null);
 await db.query('update helm_channex_revisions.message_receipt_policy set enabled=true');assert.deepEqual(await saved(f),original);
 pass('cancellation or disabled policy suppresses receipt timing without resetting its identity');
 for(const opts of [{status:'modified'},{status:'cancelled'},{outcome:'stale'},{prior:true},{receivedAt:'2020-01-01T00:00:00Z'},{receivedAt:'2099-01-01T00:00:00Z'},{rollback:true}]){
  const bad=await fixture(opts);assert.equal(await anchor(bad),null);
 }
 pass('old backlog, stale/out-of-order revisions, future clocks and rolled-back receipts cannot start a timer');
 const migrated=await fixture({migration:true});assert.equal(await saved(migrated),null);
 const actual=await scalar('select confirmed_at data from automation_channex_stay_times where booking_id=$1',[migrated.booking]);
 assert.equal((await anchor(migrated)).getTime(),actual.getTime());
 pass('migrated stay retains actual confirmation and never adopts receipt timing');
 for(const role of ['anon','authenticated','service_role']){
  await db.query('set role '+role);try{
   await assert.rejects(db.query('select * from helm_channex_revisions.message_receipt_anchors'),/permission denied/);
   await assert.rejects(db.query('update helm_channex_revisions.message_receipt_policy set enabled=true'),/permission denied/);
   await assert.rejects(anchor(f),/permission denied/);
  }finally{await db.query('reset role');}
 }
 pass('browser and worker roles cannot manufacture receipt anchors or enable policy');
 console.log(`PASS ${count} additional receipt timing PostgreSQL scenarios; no live sends`);
 await verifyNewStayTiming({db,scalar,connection,generation});
}
