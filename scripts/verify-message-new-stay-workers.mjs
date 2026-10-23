// Integrates generated queues with actual renderer, stores and final claim SQL.
// No network. Transport spies may call claim but must never perform a POST.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { renderScheduledMessage, runScheduledChannexMessages } from '../src/lib/channex-messaging/scheduled.ts';
import { ChannexMessageWorker, createChannexJobStore } from '../src/lib/channex-messaging/worker.ts';
import { runScheduledCleanerMessages } from '../src/lib/cleaner-messaging/scheduled.ts';
export async function verifyNewStayWorkers({db,scalar,fresh}) {
 let count=0,posts=0,claims=0;const pass=s=>{count++;console.log('PASS new stay workers: '+s);};
 const property='HELMTEST-calderwood',f=await fresh();
 const rpc=async(name,args)=>{
  const calls={
   automation_channex_read:['select automation_channex_read($1) data',[args.p_send_id]],
   automation_channex_claim:['select automation_channex_claim($1,$2,$3) data',[args.p_send_id,args.p_attempt_id,args.p_attempt]],
   automation_channex_candidates:['select automation_channex_candidates($1,$2,$3) data',[args.p_property_id,args.p_environment,args.p_limit]],
   automation_cleaner_candidates:['select automation_cleaner_candidates($1) data',[args.p_property_id]],
  };
  assert.ok(calls[name],'Unexpected worker call: '+name);
  if(name==='automation_channex_claim')claims++;
  await db.query('set role service_role');try{return {data:await scalar(...calls[name]),error:null};}finally{await db.query('reset role');}
 };
 const store=createChannexJobStore(rpc);
 const guest=(await db.query('select send_id from automation_channex_jobs where booking_id=$1',[f.booking])).rows;
 const cleaners=(await db.query('select j.id from automation_cleaner_jobs j join automation_cleaner_batches c on c.send_id=j.send_id where c.booking_id=$1',[f.booking])).rows;
 for(const {send_id} of guest){
  const snapshot=await scalar('select automation_channex_snapshot($1) data',[send_id]);
  const rendered=renderScheduledMessage(snapshot);assert.equal(rendered.text,'HELMTEST');
  assert.equal(await scalar('select automation_channex_refresh($1,$2,$3,$4) data',[send_id,snapshot.revision,rendered.bodySha256,snapshot.fireAt]),true);
 }
 for(const {id} of cleaners){
  const snapshot=await scalar('select automation_cleaner_snapshot($1) data',[id]);
  assert.equal(renderScheduledMessage(snapshot).text,'HELMTEST');
  assert.equal(await scalar('select automation_cleaner_refresh($1,$2,$3) data',[id,snapshot.revision,snapshot.fireAt]),true);
 }
 assert.equal(guest.length,4);assert.equal(cleaners.length,2);
 pass('all six automatically prepared jobs render and refresh through the real provider worker interfaces');
 const dispatch=async sendId=>{
  const job=await store.read(sendId);
  const worker=new ChannexMessageWorker({store,enabled:true,transport:{
   sendText:async(_message,claim)=>{
    const attempt={environment:job.environment,propertyId:job.propertyId,channelId:job.channelId,provider:job.provider,
     bookingId:job.bookingId,threadId:job.threadId,bodySha256:job.bodySha256};
    if(!await claim(attempt))return {state:'blocked'};
    posts++;throw Error('HELMTEST unexpected outbound permission');
   },verifyReceipt:async()=>{throw Error('No receipt exists for an unsent test booking');},
  }});
  return worker.dispatch(sendId,async()=>renderScheduledMessage(await scalar('select automation_channex_snapshot($1) data',[sendId])));
 };
 for(const {send_id} of guest)assert.equal((await dispatch(send_id)).state,'blocked');
 assert.equal(claims,4);assert.equal(posts,0);
 for(const {id} of cleaners){
  const snapshot=await scalar('select automation_cleaner_snapshot($1) data',[id]);
  const rendered=renderScheduledMessage(snapshot);
  assert.equal(await scalar('select automation_cleaner_claim($1,$2,$3,$4,$5) data',[id,randomUUID(),snapshot.revision,snapshot.fireAt,{from:snapshot.from,to:snapshot.to,bodySha256:rendered.bodySha256}]),false);
 }
 pass('all held jobs fail actual final claims; transport spies receive no send permission');
 const token=await scalar('select automation_new_stay_queue_snapshot($1) data',[f.booking]);
 assert.equal(await scalar("select automation_new_stay_queue_release($1,$2,'HELMTEST') data",[f.booking,token]),true);
 for(let retry=0;retry<2;retry++)for(const {send_id} of guest)assert.equal((await dispatch(send_id)).state,'blocked');
 assert.equal(posts,0);assert.equal(await scalar('select count(*)::int data from automation_channex_jobs where booking_id=$1 and attempt_id is not null',[f.booking]),0);
 assert.equal(await scalar('select count(*)::int data from automation_sends where booking_id=$1 and (sent_at is not null or provider_message_id is not null)',[f.booking]),0);
 pass('release and repeated dispatch do not bypass disabled/future/rehearsal gates or invent receipts');
 const g=await runScheduledChannexMessages({config:{propertyId:property,environment:'staging',apiKey:'HELMTEST'},rpc,
  transportFactory:()=>{throw Error('Disabled route must not create transport');}});
 const c=await runScheduledCleanerMessages({config:{propertyId:property,apiKey:'HELMTEST'},rpc,
  transport:{send:async()=>{posts++;throw Error('Unexpected cleaner send');},receipt:async()=>{throw Error('Unexpected cleaner receipt');}}});
 assert.equal(g.candidates,0);assert.equal(c.candidates,0);assert.equal(posts,0);
 assert.equal(await scalar('select channel::text data from bookings where id=$1',[f.booking]),'other');
 pass('configured schedulers respect disabled routes/batches; fictional channel remains unchanged');
 console.log(`PASS ${count} additional new-stay worker integration scenarios; successful live delivery is NOT verified`);
}
