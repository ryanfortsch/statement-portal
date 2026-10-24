import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanerConfig, runScheduledCleanerMessages } from '../cleaner-messaging/scheduled.ts';
const id='00000000-0000-0000-0000-000000000001';
const config={propertyId:'HELMTEST-home',apiKey:'HELMTEST-key'};
test('cleaner runtime requires explicit enable and scoped property with existing Quo key',()=>{
 const env={CLEANER_MESSAGES_PROPERTY_ID:config.propertyId,QUO_API_KEY:config.apiKey};
 for(const flag of [undefined,'false','1','TRUE'])assert.equal(cleanerConfig({...env,CLEANER_MESSAGES_ENABLED:flag}),null);
 assert.deepEqual(cleanerConfig({...env,CLEANER_MESSAGES_ENABLED:'true'}),config);
 assert.throws(()=>cleanerConfig({CLEANER_MESSAGES_ENABLED:'true'}),/configuration incomplete/);
});
test('disabled and wrong property call neither database nor provider',async()=>{
 for(const override of [{config:null},{propertyId:'HELMTEST-other'}]){
  let calls=0;await runScheduledCleanerMessages({config,rpc:async()=>{calls++;throw Error('unexpected');},...override});assert.equal(calls,0);
 }
});
test('dry run loads only bounded candidate IDs',async()=>{
 const names:string[]=[];const result=await runScheduledCleanerMessages({config,dry:true,rpc:async(name)=>{names.push(name);return {data:[id],error:null};}});
 assert.equal(result.candidates,1);assert.deepEqual(names,['automation_cleaner_candidates']);
});
test('malformed and cross-property snapshots fail closed without exposing raw values',async()=>{
 for(const data of [{private:'HELMTEST-secret'},null,{propertyId:'HELMTEST-other'}]){
  const result=await runScheduledCleanerMessages({config,rpc:async(name)=>({data:name==='automation_cleaner_candidates'?[id]:data,error:null}),
   transport:{send:async()=>{throw Error('must not send');},receipt:async()=>{throw Error('must not read');}}});
  assert.equal(result.blocked,1);assert.equal(JSON.stringify(result).includes('HELMTEST-secret'),false);
 }
});

import { quoFromNumber } from '../quo-lines.ts';
import { messageHash, type CleanerTransport } from '../cleaner-messaging/transport.ts';

function deliveryFixture() {
 const body = 'HELMTEST cleaner arrival reminder.';
 const snap = { jobId:id,sendId:id,propertyId:config.propertyId,status:'scheduled',
  state:'prepared',attemptId:null as string|null,providerMessageId:null as string|null,
  from:quoFromNumber('ops'),to:'+12025550101',bodySha256:messageHash(body),
  revision:'a'.repeat(32),fireAt:'2027-01-01T20:00:00Z',renderAt:'2027-01-01T20:00:01Z',body,
  input:{booking:{guest_name:'HELMTEST',check_in:'2027-01-01',check_out:'2027-01-04'},
   guest:{first_name:'HELMTEST',full_name:null},
   property:{name:'HELMTEST-home',title:null,address:null,wifi_name:null,parking:null},
   plan:{checkin_time:'16:00',checkout_time:'11:00'},
   access:{smart_lock_code:null,key_code_location:null,wifi_password:null},
   stayCode:null,lockMapped:false,trashDay:null,timeZone:'America/New_York'} };
 const calls:string[]=[]; let posts=0,reads=0,finishFailures=0;
 let outcome:'accepted'|'unknown'='accepted';
 const rpc:Parameters<typeof runScheduledCleanerMessages>[0]['rpc']=async(name,args)=>{
  calls.push(name);
  if(name==='automation_cleaner_candidates')return {data:[id,id],error:null};
  if(name==='automation_cleaner_snapshot')return {data:{...snap},error:null};
  if(name==='automation_cleaner_refresh'||name==='automation_cleaner_checked')return {data:true,error:null};
  if(name==='automation_cleaner_claim'){
   const allowed=snap.state==='prepared';
   if(allowed){snap.state='attempting';snap.attemptId=args.p_attempt_id as string;}
   return {data:allowed,error:null};
  }
  if(name==='automation_cleaner_finish'){
   if(finishFailures>0){finishFailures--;throw Error('HELMTEST lost save response');}
   snap.state=args.p_state as string;snap.providerMessageId=args.p_provider_id as string|null;
   return {data:true,error:null};
  }
  throw Error('Unexpected RPC');
 };
 const transport:CleanerTransport={
  send:async(target,text,claim)=>{
   assert.equal(target.bodySha256,messageHash(text));
   if(!await claim())return {state:'blocked'};
   posts++;
   return outcome==='unknown'?{state:'unknown'}:{state:'accepted',providerMessageId:'HELMTEST-message'};
  },
  receipt:async(target,providerId)=>{
   reads++;assert.equal(providerId,'HELMTEST-message');assert.equal(target.to,snap.to);
   return 'delivered';
  }
 };
 return {snap,calls,posts:()=>posts,reads:()=>reads,
  failFinishes:(n:number)=>{finishFailures=n;},uncertain:()=>{outcome='unknown';},
  run:()=>runScheduledCleanerMessages({config,rpc,transport})};
}
test('cleaner scheduled send runs once across duplicate scan IDs and reconciles receipt next run',async()=>{
 const f=deliveryFixture();
 assert.equal((await f.run()).accepted,1);
 assert.equal(f.posts(),1);
 assert.equal((await f.run()).delivered,1);
 assert.equal(f.posts(),1);assert.equal(f.reads(),1);
 await f.run();assert.equal(f.posts(),1);
});
test('receipt persistence retry never repeats the provider send',async()=>{
 const f=deliveryFixture();f.failFinishes(1);
 assert.equal((await f.run()).accepted,1);
 assert.equal(f.calls.filter(n=>n==='automation_cleaner_finish').length,2);
 assert.equal(f.posts(),1);
});
test('exhausted persistence retries leave an attempted job unresolved without automatic resend',async()=>{
 const f=deliveryFixture();f.failFinishes(2);
 assert.equal((await f.run()).attention,1);
 assert.equal(f.snap.state,'attempting');
 assert.equal((await f.run()).attention,1);
 assert.equal(f.posts(),1);assert.equal(f.reads(),0);
});
test('unknown provider outcome stays unresolved on subsequent scheduler runs',async()=>{
 const f=deliveryFixture();f.uncertain();
 assert.equal((await f.run()).attention,1);
 assert.equal(f.snap.state,'unknown');
 await f.run();assert.equal(f.posts(),1);assert.equal(f.reads(),0);
});
test('held and future cleaner jobs never claim or send',async()=>{
 for(const mode of ['held','future']){
  const f=deliveryFixture();
  if(mode==='held')f.snap.status='held';else f.snap.fireAt='2027-01-02T20:00:00Z';
  await f.run();
  assert.equal(f.posts(),0);
  assert.ok(!f.calls.includes('automation_cleaner_claim'));
 }
});

test('malformed timing never refreshes, claims or sends a prepared cleaner job',async()=>{
 for(const field of ['fireAt','renderAt'] as const){
  for(const invalid of ['invalid','2027-01-01T20:00:00','2027-02-30T20:00:00Z','2027-01-01T24:00:00Z']){
   const f=deliveryFixture();f.snap[field]=invalid;
   const result=await f.run();
   assert.equal(result.blocked,1,field+': '+invalid);
   assert.equal(f.posts(),0);
   assert.ok(!f.calls.includes('automation_cleaner_refresh'));
   assert.ok(!f.calls.includes('automation_cleaner_claim'));
  }
 }
});
test('explicit timezone offsets are compared as instants for cleaner dispatch',async()=>{
 const f=deliveryFixture();
 f.snap.fireAt='2027-01-01T15:00:00-05:00';
 assert.equal((await f.run()).accepted,1);
 assert.equal(f.posts(),1);
});
test('receipt reconciliation survives invalid current schedule fields',async()=>{
 const f=deliveryFixture();await f.run();
 f.snap.fireAt='invalid';f.snap.renderAt='invalid';
 assert.equal((await f.run()).delivered,1);
 assert.equal(f.posts(),1);assert.equal(f.reads(),1);
});
