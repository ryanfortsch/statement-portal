// Synthetic SQL integration. Called after the existing source-history harness.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { verifyMessageLifecycle } from './verify-message-lifecycle.mjs';
import { verifyMessageDateFeed } from './verify-message-date-feed.mjs';
import { verifyTimingCapture } from './verify-message-timing-capture.mjs';
import { prepareReviewedMessageQueue } from '../src/lib/channex-messaging/queue-preparation.ts';
export async function verifyQueuePreparation({db,a,b,bundle,scalar}) {
 let count=0;const pass=s=>{count++;console.log(`PASS queue preparation: ${s}`);};
 const baseline=await bundle();
 const oldContext=await scalar('select automation_channex_context($1) data',[baseline.send]);
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-queue-preparation.sql',import.meta.url),'utf8'));
 assert.equal(await scalar('select automation_channex_context($1) data',[baseline.send]),oldContext);
 assert.equal(await scalar('select automation_message_booking_context($1) data',[baseline.booking]),oldContext);
 pass('booking context is available before queue creation and preserves every existing worker digest');
 await verifyTimingCapture({db,bundle,scalar});
 await verifyMessageLifecycle({db,bundle,scalar});
 const fixture=async(keepHeld=false)=>{
  const f=await bundle();
  const rows=(await db.query('select id,automation_id,automation_key,fire_at from automation_sends where booking_id=$1',[f.booking])).rows;
  f.packet=f.entries.map(e=>{const s=rows.find(r=>r.id===e.send_id);return {automation_id:s.automation_id,fire_at:s.fire_at.toISOString(),review:e.review};});
  f.held=rows.find(r=>r.automation_key==='key_code').id;
  await db.query('delete from automation_sends where booking_id=$1 and ($2::uuid is null or id<>$2)',[f.booking,keepHeld?f.held:null]);
  const snapshot=await scalar('select automation_message_preparation_snapshot($1) data',[f.booking]);
  assert.equal(snapshot.context_revision,f.packet[0].review.context_revision);
  assert.equal(snapshot.canonical_revision,f.canonical);assert.equal(snapshot.observation_revision,f.observation);
  return f;
 };
 const prepare=(f,packet=f.packet,c=db)=>scalar('select automation_message_prepare_handoff($1,$2,$3) data',[f.booking,f.canonical,JSON.stringify(packet)],c);
 const rows=f=>scalar('select count(*)::int data from automation_sends where booking_id=$1',[f.booking]);
 let f=await fixture();const result=await prepare(f);
 assert.equal(await rows(f),6);assert.equal(result.filter(r=>r.result==='source_sent').length,1);assert.equal(result.filter(r=>r.result==='future_registered').length,5);
 assert.equal(await scalar('select count(*)::int data from automation_channex_jobs where booking_id=$1',[f.booking]),3);
 assert.equal(await scalar('select count(*)::int data from automation_cleaner_jobs j join automation_sends s on s.id=j.send_id where s.booking_id=$1',[f.booking]),4);
 assert.equal(await scalar('select enabled data from automation_channex_routes where property_id=$1',[f.property]),false);
 assert.equal(await scalar('select count(*)::int data from automation_cleaner_batches where property_id=$1 and enabled',[f.property]),0);
 assert.deepEqual(await prepare(f),result);assert.equal(await rows(f),6);
 pass('one complete packet creates all six canonical records, imports confirmation history, prepares both senders and replays without duplicates');
 const application=await prepareReviewedMessageQueue(async(name,args)=>{
  assert.equal(name,'automation_message_prepare_handoff');
  return {data:await scalar('select automation_message_prepare_handoff($1,$2,$3) data',
   [args.p_booking_id,args.p_canonical_revision,JSON.stringify(args.p_entries)]),error:null};
 },{bookingId:f.booking,snapshot:await scalar('select automation_message_preparation_snapshot($1) data',[f.booking]),entries:f.packet});
 assert.equal(application.canSend,false);assert.deepEqual(application.results.map(r=>r.send_id).sort(),result.map(r=>r.send_id).sort());
 pass('the application adapter accepts the actual PostgreSQL receipt without activating either sender');
 f=await fixture(true);const held=await scalar('select to_jsonb(s) data from automation_sends s where id=$1',[f.held]);
 const mixed=await prepare(f);assert.equal(mixed.find(x=>x.workflow==='key_code').send_id,f.held);
 assert.equal(await scalar('select status data from automation_sends where id=$1',[f.held]),'held');
 assert.equal(await scalar('select fire_at data from automation_sends where id=$1',[f.held]).then(x=>x.toISOString()),new Date(held.fire_at).toISOString());
 pass('partial existing queue keeps its held key-code record, original ID and exact schedule');
 f=await fixture();const bad=structuredClone(f.packet);bad.at(-1).review.uncertain=true;
 await assert.rejects(prepare(f,bad));assert.equal(await rows(f),0);
 assert.equal(await scalar('select count(*)::int data from automation_message_source_history where booking_id=$1',[f.booking]),0);
 assert.equal(await scalar('select count(*)::int data from automation_channex_jobs where booking_id=$1',[f.booking]),0);
 pass('a failed source review rolls back new schedules, imported history and every registration');
 f=await fixture(true);const before=await scalar('select to_jsonb(s) data from automation_sends s where id=$1',[f.held]);
 const broken=structuredClone(f.packet);broken.find(e=>e.review.workflow==='cleaner_arrival').review.recipient_phones=[];
 await assert.rejects(prepare(f,broken));assert.equal(await rows(f),1);
 assert.deepEqual(await scalar('select to_jsonb(s) data from automation_sends s where id=$1',[f.held]),before);
 pass('rollback preserves an existing held row byte for byte');
 for(const status of ['cancelled','failed','awaiting_approval','sending']){
  f=await fixture(true);await db.query('update automation_sends set status=$2 where id=$1',[f.held,status]);
  await assert.rejects(prepare(f));assert.equal(await rows(f),1);assert.equal(await scalar('select status data from automation_sends where id=$1',[f.held]),status);
 }pass('cancelled, failed, unapproved and in-flight rows cannot be revived by queue preparation');
 f=await fixture();for(const invalid of [f.packet.slice(0,5),[...f.packet.slice(0,5),f.packet[0]],
  f.packet.map((e,i)=>i===5?{...e,automation_id:randomUUID()}:e),
  f.packet.map((e,i)=>i===5?{...e,extra:'HELMTEST'}:e),
  f.packet.map((e,i)=>i===5?{...e,fire_at:'infinity'}:e)]){
  await assert.rejects(prepare(f,invalid));assert.equal(await rows(f),0);
 }pass('partial, repeated, unknown-rule, extra-field and invalid-clock packets leave no queue');
 f=await fixture();await db.query("update message_automations set body='HELMTEST changed' where id=$1",[f.packet[0].automation_id]);
 await assert.rejects(prepare(f),/context mismatch/);assert.equal(await rows(f),0);
 pass('template edits between source review and preparation require fresh review');
 f=await fixture();await db.query('update bookings set check_out=check_out+1 where id=$1',[f.booking]);
 assert.equal(await scalar('select automation_message_preparation_snapshot($1) data',[f.booking]),null);
 await assert.rejects(prepare(f),/current stay/);assert.equal(await rows(f),0);
 pass('reservation changes invalidate both the preparation snapshot and the complete write');
 f=await fixture();const foreign=await fixture();const foreignPacket=structuredClone(f.packet);
 foreignPacket[0].automation_id=foreign.packet[0].automation_id;
 await assert.rejects(prepare(f,foreignPacket),/rule binding/);assert.equal(await rows(f),0);
 pass('another property rule cannot be adopted even when workflow and times agree');
 f=await fixture(true);await db.query('update automation_sends set fire_at=fire_at+interval \'1 hour\' where id=$1',[f.held]);
 await assert.rejects(prepare(f),/schedule changed/);assert.equal(await rows(f),1);
 pass('queue preparation cannot silently retime an existing reviewed or held schedule');
 f=await fixture();const past=structuredClone(f.packet);past.find(e=>e.review.workflow==='key_code').fire_at=new Date(Date.now()-60000).toISOString();
 await assert.rejects(prepare(f,past));assert.equal(await rows(f),0);
 pass('unsent overdue events cannot become catch-up sends');
 f=await fixture();const paired=await Promise.all([prepare(f,f.packet,a),prepare(f,f.packet,b)]);
 assert.deepEqual(paired[0],paired[1]);assert.equal(await rows(f),6);
 pass('overlapping preparation requests converge on six identical durable records');
 for(const role of ['anon','authenticated','service_role']){
  await db.query(`set role ${role}`);
  for(const [sql,args] of [['select automation_message_prepare_handoff($1,$2,$3)',[f.booking,f.canonical,JSON.stringify(f.packet)]],
   ['select automation_message_preparation_snapshot($1)',[f.booking]],['select automation_message_booking_context($1)',[f.booking]]])await assert.rejects(db.query(sql,args),/permission denied/);
  await db.query('reset role');
 }pass('browser and sender roles cannot manufacture preparation evidence or populate the queue');
 console.log(`PASS ${count} additional queue-preparation PostgreSQL scenarios; no external IO`);
 await verifyMessageDateFeed({db,a,b,scalar});
}
