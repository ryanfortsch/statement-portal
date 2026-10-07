import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CheckoutCommitmentSchema, scheduleUpdateLabel } from '../checkout-commitment.ts';
import { assembleOutcomes } from '../message-outcomes.ts';
import { recentFollowups } from '../recent-followups.ts';

const event = {event_key:'checkout:test',listing_id:'test_home',reservation_id:'stay',conversation_id:'thread',
  check_in:'2090-10-03',check_out:'2090-10-05',sent_at:'2090-10-04T18:00:00Z',time:'12:00',date:'',evidence:'Noon checkout is approved.',confidence:'high'};
const code = ts.transpileModule(readFileSync(new URL('../../app/api/checkout-commitments/route.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness({status='pending', prior=false, failDraft=false, deny=false, standing=null as Record<string,unknown>|null}={}) {
  let saved: Record<string,unknown>|null = prior ? {id:'adjustment',status:'active',original_check_out:event.check_out} : null;
  let writes=0, drafts=0, confidence='';
  const db={from(table:string) {
    const filters:Record<string,unknown>={};
    const query={select:()=>query, eq:(key:string,value:unknown)=>{filters[key]=value;return query;},
      single:async()=>result(),maybeSingle:async()=>result()};
    function result() {
      if(table==='guesty_listings') return {data:{property_id:'test_home'},error:null};
      if(table==='properties') return {data:{id:'test_home',region:'cape_ann'},error:null};
      if(table==='cleaner_schedule_digests') return {data:{id:'digest',status},error:null};
      return {data:filters.miner_key ? saved : standing,error:null};
    }
    return query;
  }};
  const exports: { POST?: (req:Request)=>Promise<Response> }={};
  const deps:Record<string,unknown>={
    'next/server':{NextResponse:{json:(value:unknown,opts?:ResponseInit)=>Response.json(value,opts)}},
    '@/lib/stay-concierge-auth':{authorizeStayConcierge:()=>deny ? Response.json({}, {status:401}) : null},
    '@/lib/supabase-admin':{supabaseAdmin:db},
    '@/lib/checkout-commitment':{CheckoutCommitmentSchema},
    '@/lib/checkout-schedule':{todayET:()=> '2090-10-04',insertAdjustment:async (_db:unknown,input:Record<string,unknown>)=>{
      writes++; confidence=String(input.confidence); saved={id:'adjustment',status:confidence==='high'?'active':'proposed',original_check_out:event.check_out};
    }},
    '@/lib/cleaner-digest':{upsertDigestDraft:async()=>{drafts++;if(failDraft)throw Error('offline');return {digest:{id:'digest',status:'pending'}};}},
  };
  new Function('require','exports',code)((name:string)=>{if(!(name in deps))throw Error(name);return deps[name];},exports);
  return {run:(payload:unknown=event)=>exports.POST!(new Request('https://example.test/api/checkout-commitments',{method:'POST',body:JSON.stringify(payload)})),counts:()=>({writes,drafts,confidence})};
}
test('invalid dates, times, missing stay, and unauthenticated calls fail before writes',async()=>{
  for(const change of [{time:'25:00'},{check_in:'2090-02-30'},{reservation_id:''},{time:'',date:''}]){
    const h=harness();assert.equal((await h.run({...event,...change})).status,400);assert.equal(h.counts().writes,0);
  }
  const h=harness({deny:true});assert.equal((await h.run()).status,401);assert.equal(h.counts().writes,0);
});
test('confirmed checkout updates the pending digest; retry reuses adjustment',async()=>{
  const h=harness();assert.equal((await h.run()).status,200);await h.run();assert.equal(h.counts().writes,1);assert.equal(h.counts().drafts,2);
});
test('sent and skipped schedules are never overwritten or automatically texted',async()=>{
  for(const status of ['sent','skipped']){const h=harness({status});const r=await (await h.run()).json();assert.equal(r.digest_status,status);assert.equal(h.counts().drafts,0);}
});
test('uncertain digest result stays retryable and does not duplicate adjustment',async()=>{
  const h=harness({failDraft:true});assert.equal((await h.run()).status,503);assert.equal((await h.run()).status,503);assert.equal(h.counts().writes,1);
  assert.equal((await harness({status:'sending'}).run()).status,503);
});
test('a later standing decision or date change requires review',async()=>{
  const h=harness({standing:{created_at:'2090-10-04T19:00:00Z'}});await h.run();assert.equal(h.counts().confidence,'low');assert.equal(h.counts().drafts,0);
  const date=harness();await date.run({...event,date:'2090-10-06'});assert.equal(date.counts().confidence,'low');
});
test('schedule-only followups stay visible with honest status',()=>{
  const schedule={status:'active',error:'',digest_status:'sent',date:event.check_out};
  const outcomes=assembleOutcomes({id:'a',schedule_update:schedule},[]);
  assert.equal(recentFollowups([{id:'a',status:'approved',created_at:'',resolved_at:'',outcomes}]).length,1);
  assert.match(scheduleUpdateLabel(schedule),/correction ready/);
  assert.match(scheduleUpdateLabel({...schedule,status:'pending',digest_status:''}),/Updating/);
});

test('composer Guesty listing IDs resolve through the property registry',async()=>{
  const h=harness();assert.equal((await h.run({...event,listing_id:'aaaaaaaaaaaaaaaaaaaaaaaa'})).status,200);
  assert.equal(h.counts().writes,1);
});

test('send-now keeps reservation context and does not become a scheduled message', async()=>{
  const actionCode=ts.transpileModule(readFileSync(new URL('../../app/messaging/thread-actions.ts',import.meta.url),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let received: unknown[]=[];
  const exported: {sendThreadMessage?:(...args:unknown[])=>Promise<unknown>}={};
  new Function('require','exports',actionCode)((name:string)=>({
    '@/auth':{auth:async()=>({user:{email:'operator@example.test'}})},
    '@/lib/stay-concierge':{sendConversationMessage:async(...args:unknown[])=>{received=args;return {ok:true,data:{}};}},
    '@/lib/helm-inbox':{}, '@/lib/helm-inbox-core':{isHelmConversationId:()=>false},
  }[name]),exported);
  const context={reservationId:'stay',checkIn:event.check_in,checkOut:event.check_out};
  await exported.sendThreadMessage!('thread','Noon is approved','airbnb2','test_home',context);
  assert.deepEqual(received[4],context);
});
