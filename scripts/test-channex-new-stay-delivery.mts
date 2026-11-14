/** Executed by the full new-scheduling chain. All rows are synthetic; all HTTP
 * is fake. SQL claims use real time. Later stay dates use an explicitly in-memory
 * one-use store to exercise transport orchestration without waiting weeks. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dispatchNewStayGuest, dispatchNewStayCleaner } from '../src/lib/channex-messaging/new-stay-delivery.ts';
import { runNewStayDeliveryTick } from '../src/lib/channex-messaging/new-stay-delivery-tick.ts';
import { retainedGuestSendId } from '../src/lib/channex-messaging/schedule-coordinator.ts';
import { retainedCleanerSendId } from '../src/lib/channex-messaging/cleaner-runtime.ts';
import { PRODUCTION_DB_URL } from '../src/lib/channex-production-runtime.ts';
import { QUO_LINES } from '../src/lib/quo-lines.ts';
import type { MessageRpc } from '../src/lib/channex-messaging/store.ts';
import type { deliveryFixture } from './test-channex-new-stay-scheduling.mts';
export async function testNewStayDelivery(f: typeof deliveryFixture) {
 if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback only');
 const {sql,quote:q,booking,run,provider,ref}=f;
 const json=(s:string)=>JSON.parse(sql(s)||'null');
 const before=f.counts();
 sql(readFileSync('supabase/migrations/20261114120000_channex_new_stay_delivery_worklist.sql','utf8'));
 assert.equal(f.counts(),before);
 const fn='helm_channex_new_stay_delivery_worklist(text)';
 for(const role of ['anon','authenticated']) assert.equal(sql(`select has_function_privilege('${role}','${fn}','execute');`),'f');
 assert.equal(sql(`select has_function_privilege('service_role','${fn}','execute');`),'t');
 const signatures:Record<string,(a:Record<string,unknown>)=>string>={
  helm_channex_message_read:a=>q(a.p_send_id)+'::uuid',
  helm_channex_cleaner_read:a=>q(a.p_send_id)+'::uuid',
  helm_channex_message_claim:a=>[q(a.p_send_id)+'::uuid',q(a.p_attempt_id)+'::uuid',q(JSON.stringify(a.p_attempt))+'::jsonb'].join(','),
  helm_channex_message_finish:a=>[q(a.p_send_id)+'::uuid',q(a.p_attempt_id)+'::uuid',q(a.p_state),a.p_provider_id?q(a.p_provider_id)+'::uuid':'null',a.p_rejection_status??'null'].join(','),
  helm_channex_cleaner_claim:a=>[q(JSON.stringify(a.p_job))+'::jsonb',q(a.p_attempt_id)+'::uuid',q(JSON.stringify(a.p_attempt))+'::jsonb'].join(','),
  helm_channex_cleaner_finish:a=>[q(a.p_send_id)+'::uuid',q(a.p_attempt_id)+'::uuid',q(JSON.stringify(a.p_outcome))+'::jsonb'].join(','),
  helm_channex_new_stay_delivery_worklist:a=>q(a.p_audience),
 };
 const rpc:MessageRpc=async(name,args)=>signatures[name]
  ? {data:json(`set role service_role; select to_jsonb(${name}(${signatures[name](args)}));`),error:null}:f.rpc(name,args);
 const keys={apiKey:'synthetic-quo',receiptKey:'a'.repeat(64),keyId:'synthetic-v1'};
 const env={VERCEL_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:PRODUCTION_DB_URL,SUPABASE_SERVICE_ROLE_KEY:'synthetic',CRON_SECRET:'synthetic',
  CHANNEX_PRODUCTION_API_KEY:'synthetic',QUO_API_KEY:keys.apiKey,HELM_CHANNEX_CLEANER_RECEIPT_KEY:keys.receiptKey,
  HELM_CHANNEX_CLEANER_KEY_ID:keys.keyId,HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE:JSON.stringify(ref),
  HELM_CHANNEX_NEW_GUEST_MODE:'calderwood-v1',HELM_CHANNEX_NEW_CLEANER_MODE:'calderwood-v1'};
 const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 const fixture=booking(); assert.equal((await run(fixture)).state,'complete');
 const workflowKeys=['booking_confirmed','pre_arrival','checkin_day','pre_checkout','cleaner_reminder','cleaner_arrival'] as const;
 for(const key of workflowKeys){
  const cleaner=key.startsWith('cleaner_'), sendId=cleaner?retainedCleanerSendId(fixture.bookingId,key as 'cleaner_reminder'):retainedGuestSendId(fixture.bookingId,key as 'booking_confirmed');
  const readName=cleaner?'helm_channex_cleaner_read':'helm_channex_message_read';
  const original=(await rpc(readName,{p_send_id:sendId})).data as Record<string,unknown>;
  const time=Date.parse(sql(`select fire_at from automation_sends where id='${sendId}';`))+1000;
  for(const scenario of ['success','slow_provider','backward_clock','lost_claim','lost_post','lost_finish','changed_provider','changed_context','changed_recipient','held'] as const){
   // This store deliberately does not pretend SQL time has advanced. Its rows,
   // render hashes and inputs come from actual atomic schedule registration.
   let job=structuredClone(original),posts=0,claims=0,providerReads=0;
   const now=()=>time+(scenario==='slow_provider'?providerReads*1000:scenario==='backward_clock'&&providerReads?-1:0);
   let providerMessage:Record<string,unknown>|null=null;
   const testRpc:MessageRpc=async(name,args)=>{
    if(name===readName)return{data:structuredClone(job),error:null};
    if(name.endsWith('_claim')){
     claims++; if(scenario==='held')return{data:false,error:null};
     if(job.state!=='prepared')return{data:false,error:null};
     job={...job,state:'attempting',attemptId:args.p_attempt_id};
     if(scenario==='lost_claim')throw Error('lost claim');return{data:true,error:null};
    }
    if(name.endsWith('_finish')){
     if(scenario==='lost_finish')throw Error('lost finish');
     const o=cleaner?args.p_outcome as Record<string,unknown>:{state:args.p_state,providerMessageId:args.p_provider_id};
     job={...job,...o}; return{data:true,error:null};
    }
    if(name.endsWith('delivery_worklist'))return {data:{dispatch:{state:'ready',jobs:[]},receipts:{state:'ready',jobs:[{bookingId:fixture.bookingId,sendId}]}},error:null};
    const out=await rpc(name,args),data=structuredClone(out.data) as {
     observedAt?:string;admission?:{observedAt?:string};context?:{contextRevision:string};recipients?:{enabled:boolean}[];
    };
    if(data?.observedAt)data.observedAt=new Date(now()).toISOString();
    if(data?.admission?.observedAt)data.admission.observedAt=new Date(now()).toISOString();
    if(scenario==='changed_context' && data?.context)data.context.contextRevision='f'.repeat(32);
    if(scenario==='changed_recipient' && cleaner && data?.recipients)data.recipients[0].enabled=false;
    return{...out,data};
   };
   const fetcher:typeof fetch=async(url,init)=>{
    const u=new URL(String(url));
    if(init?.method==='POST'){
     posts++;assert.equal(posts,1);assert.equal(job.state,'attempting');
     const body=JSON.parse(String(init.body));
     if(scenario==='lost_post')throw Error('lost provider response');
     if(cleaner){providerMessage={id:'ACSyntheticNewStay',direction:'outgoing',from:QUO_LINES.ops.number,
      phoneNumberId:QUO_LINES.ops.id,to:body.to,text:body.content,status:'queued',media:[],
      createdAt:new Date(now()).toISOString(),updatedAt:new Date(now()).toISOString()};return response({data:providerMessage},202);}
     providerMessage={id:randomUUID(),type:'message',attributes:{sender:'property',message:body.message.message,attachments:[]},
      relationships:{message_thread:{data:{id:fixture.threadId,type:'message_thread'}}}};
     return response({data:providerMessage});
    }
    assert.equal(init?.method,'GET');
    if(u.origin==='https://api.quo.com')return response({data:{...providerMessage,status:'delivered'}});
    if(u.pathname.endsWith('/messages'))return response({data:[providerMessage],meta:{page:1,limit:100,total:1}});
    providerReads++;
    return provider(fixture,scenario==='changed_provider'?(payload,path)=>{
     if(path.includes('/bookings/'))(payload.data as {attributes:{status:string}}).attributes.status='cancelled';
    }:undefined)(url,init);
   };
   const deps={rpc:testRpc,channexKey:async()=>'synthetic',sms:async()=>keys,fetcher,clock:now};
   const dispatch=()=> (cleaner?dispatchNewStayCleaner:dispatchNewStayGuest)({bookingId:fixture.bookingId,sendId,...ref},deps,{enabled:true});
   const out=await dispatch();
   if(scenario==='success'||scenario==='slow_provider'){
    assert.equal(out.state,'accepted',key+JSON.stringify(out)); assert.equal(posts,1);assert.equal(claims,1);assert.ok(providerReads>=12);
    assert.equal((await dispatch()).state,'needs_reconciliation');assert.equal(posts,1);
    // Receipt-only recovery must not resolve a current source, booking or recipient.
    const receiptEnv={...env,HELM_CHANNEX_NEW_GUEST_MODE:'receipts-only',HELM_CHANNEX_NEW_CLEANER_MODE:'receipts-only',
     HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE:undefined,CHANNEX_PRODUCTION_API_KEY:cleaner?undefined:'synthetic'};
    const receipt=await runNewStayDeliveryTick(cleaner?'cleaner':'guest',receiptEnv,{...deps,rpc:async(name,args)=>{
     assert.ok(!name.includes('inputs')&&!name.includes('enrollment')&&!name.includes('capture'));return testRpc(name,args);
    }});
    assert.equal(receipt.receipts[0].state,cleaner?'delivered':'recorded');assert.equal(posts,1);
    assert.ok(!JSON.stringify(receipt).includes(sendId));
   } else if(scenario==='lost_claim'){
    assert.equal(out.state,'ledger_uncertain');assert.equal(posts,0);assert.equal((await dispatch()).state,'needs_reconciliation');
   } else if(scenario==='lost_post'||scenario==='lost_finish'){
    assert.equal(out.state,scenario==='lost_post'?'unknown':'ledger_uncertain');assert.equal(posts,1);
    assert.equal((await dispatch()).state,'needs_reconciliation');assert.equal(posts,1);
   } else if(scenario==='changed_recipient'&&!cleaner){assert.equal(out.state,'accepted');}
   else {assert.equal(out.state,'blocked',key+':'+scenario+JSON.stringify(out));assert.equal(posts,0);}
  }
 }
 // Test-only initial evidence age. These changes precede the new fixtures and
 // never alter production functions, existing job timestamps or claim predicates.
 // All subsequent admission, registration, holds and claims use actual SQL.
 sql(`begin; alter table helm_channex_messages.new_stay_epochs disable trigger new_stay_epoch_immutable;
  update helm_channex_messages.scope set source_stopped_at=clock_timestamp()-interval '2 hours',source_drained_at=clock_timestamp()-interval '90 minutes';
  update helm_channex_messages.new_stay_epochs set opened_at=clock_timestamp()-interval '1 hour',
   source_drained_at=(select source_drained_at from helm_channex_messages.scope where property_id='65_calderwood');
  alter table helm_channex_messages.new_stay_epochs enable trigger new_stay_epoch_immutable; commit;`);
 const fire=Date.now()+45000, received=new Date(fire-1800000).toISOString();
 const cases:ReturnType<typeof booking>[]=[];
 for(let offset=180;cases.length<7&&offset<450;offset+=5){
  const start=new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const end=new Date(Date.parse(start)+3*86400000).toISOString().slice(0,10);
  const available=sql(`select not exists(select 1 from bookings where property_id='65_calderwood'
   and check_in<'${end}'::date and check_out>'${start}'::date)
   and helm_channex_messages.new_stay_instant('${start}','16:00')-helm_channex_messages.new_stay_instant('${start}'::date-10,'16:00')=interval '10 days'
   and helm_channex_messages.new_stay_instant('${end}','11:00')-helm_channex_messages.new_stay_instant('${end}'::date-1,'11:00')=interval '1 day';`);
  if(available==='t')cases.push(booking(start,received));
 }
 assert.equal(cases.length,7);
 for(const b of cases) assert.equal((await run(b)).state,'complete');
 const wait=Math.max(0,fire-Date.now()+100);assert.ok(wait<46000);
 console.log(`Waiting ${Math.ceil(wait/1000)}s for the real new-booking confirmation clock`);
 await new Promise(resolve=>setTimeout(resolve,wait));
 const work=()=>json("set role service_role; select helm_channex_new_stay_delivery_worklist('guest');");
 assert.equal(work().dispatch.jobs.length,4,'seven due jobs must remain bounded');
 const current=cases[0],sendId=retainedGuestSendId(current.bookingId,'booking_confirmed');
 let posts=0,acceptedMessage:Record<string,unknown>|null=null;
 const fetcher:typeof fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(init?.method==='POST'){
   posts++; const body=JSON.parse(String(init.body));
   acceptedMessage={id:randomUUID(),type:'message',attributes:{sender:'property',message:body.message.message,attachments:[]},
    relationships:{message_thread:{data:{id:current.threadId,type:'message_thread'}}}};return response({data:acceptedMessage});
  }
  if(path.endsWith('/messages'))return response({data:[acceptedMessage],meta:{page:1,limit:100,total:1}});
  return provider(current)(url,init);
 };
 const deps={rpc,channexKey:async()=>'synthetic',sms:async()=>keys,fetcher};
 const dispatch=()=>dispatchNewStayGuest({bookingId:current.bookingId,sendId,...ref},deps,{enabled:true});
 sql(`set role service_role; select helm_channex_message_set_hold('${sendId}',1,true,'synthetic-owner');`);
 assert.equal((await dispatch()).state,'blocked');assert.equal(posts,0);assert.ok(!work().dispatch.jobs.some((j:{sendId:string})=>j.sendId===sendId));
 sql(`set role service_role; select helm_channex_message_set_hold('${sendId}',2,false,'synthetic-owner');`);
 const race=await Promise.all([dispatch(),dispatch()]);
 assert.equal(race.filter(r=>r.state==='accepted').length,1,JSON.stringify(race));assert.equal(posts,1);
 assert.equal((await dispatch()).state,'needs_reconciliation');assert.equal(posts,1);
 // Real SQL commits survive missing client/provider replies. None can grant a
 // replacement permit or repeat the external POST on a later invocation.
 for(const [index,scenario] of ['lost_claim','lost_post','lost_finish'].entries()){
  const b=cases[index+1],sid=retainedGuestSendId(b.bookingId,'booking_confirmed');let fakePosts=0;
  const failed={...deps,rpc:async(name:string,args:Record<string,unknown>)=>{
   if(scenario==='lost_finish'&&name.endsWith('_finish'))throw Error('lost finish');
   const result=await rpc(name,args);if(scenario==='lost_claim'&&name.endsWith('_claim'))throw Error('lost claim');return result;
  },fetcher:async(url:string|URL|Request,init?:RequestInit)=>{
   if(init?.method!=='POST')return provider(b)(url,init);
   fakePosts++;if(scenario==='lost_post')throw Error('lost POST');
   const body=JSON.parse(String(init.body));return response({data:{id:randomUUID(),type:'message',
    attributes:{sender:'property',message:body.message.message,attachments:[]},
    relationships:{message_thread:{data:{id:b.threadId,type:'message_thread'}}}}});
  }};
  const attempt=()=>dispatchNewStayGuest({bookingId:b.bookingId,sendId:sid,...ref},failed,{enabled:true});
  assert.equal((await attempt()).state,scenario==='lost_post'?'unknown':'ledger_uncertain');
  assert.equal(fakePosts,scenario==='lost_claim'?0:1);
  assert.equal((await attempt()).state,'needs_reconciliation');assert.equal(fakePosts,scenario==='lost_claim'?0:1);
  assert.equal(sql(`select state from helm_channex_messages.jobs where send_id='${sid}';`),scenario==='lost_post'?'unknown':'attempting');
 }
 // Revoke source and cancel after acceptance. Work discovery and GET receipt
 // recovery must continue, with no new provider POST or source revalidation.
 sql(`update bookings set status='cancelled' where id='${current.bookingId}'; update helm_channex_messages.scope set enabled=false;`);
 assert.ok(work().receipts.jobs.some((j:{sendId:string})=>j.sendId===sendId));
 const recovered=await runNewStayDeliveryTick('guest',{...env,HELM_CHANNEX_NEW_GUEST_MODE:'receipts-only',HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE:undefined},deps);
 assert.equal(recovered.receipts[0].state,'recorded');assert.equal(posts,1);
 assert.equal(sql(`select state from helm_channex_messages.jobs where send_id='${sendId}';`),'recorded');
 // Rotation arithmetic is nonnegative for real epoch minutes and bounded for
 // every lane size, including wrap-around. More than 200 fails closed.
 for(const total of [1,3,4,5,7,199,200])assert.equal(Number(sql(`select count(*) from generate_series(0,${total-1}) pos
  where mod(pos-mod(floor(extract(epoch from statement_timestamp())/60)::bigint,${total})+${total},${total})<4;`)),Math.min(total,4));
 assert.equal(f.counts().split(':')[0],sql('select count(*) from automation_sends;'));
 console.log('PASS: all six new-stay delivery paths, one-use/lost-response safeguards, independent receipt-only modes; real SQL due worklist, hold, concurrent confirmation claim and receipt after cancellation/revocation; no real provider calls');
}
