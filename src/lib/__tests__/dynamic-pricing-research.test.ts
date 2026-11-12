import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createPricingDemo} from '../dynamic-pricing-demo.ts';
import {validatePricingResearch,type PricingResearchSave} from '../dynamic-pricing-research.ts';
import {readPricingResearch,savePricingResearch} from '../dynamic-pricing-research.server.ts';
import {createPricingDraftServices} from '../dynamic-pricing-draft-services.ts';
import {pricingLiveRow,type PricingLiveCalendar} from '../dynamic-pricing-live.ts';
import {pricingPortfolioTotals,expirePricingMarketRows} from '../dynamic-pricing-portfolio.ts';
const now=new Date('2026-11-12T18:00:00Z'),fixture=createPricingDemo(now);
const input=():PricingResearchSave=>({propertyId:'sample',version:0,requestId:'00000000-0000-4000-8000-000000000001',data:{...structuredClone(fixture.snapshot.evidence!),propertyId:'sample'}});
function dbFixture({readError=false,wrongHome=false,missingHome=false,rpcError=null as null|{code:string}}={}) {
  const saved={version:1,data:input().data,updated_at:now.toISOString()},calls:{name:string;args:unknown}[]=[];
  const db={from(table:string){const q={select(){return q;},eq(){return q;},async maybeSingle(){return table==='properties'?{data:missingHome?null:{id:'sample'},error:null}:{data:wrongHome?{...saved,data:{...saved.data,propertyId:'other'}}:saved,error:readError?{code:'unavailable'}:null};}};return q;},async rpc(name:string,args:unknown){calls.push({name,args});return {data:saved,error:rpcError};}} as unknown as SupabaseClient;
  return {db,saved,calls};
}
test('research requires a matching listing, real daily data and original observation times',()=>{
  const i=input();assert.equal(validatePricingResearch(i,now).propertyId,'sample');
  assert.throws(()=>validatePricingResearch({...i,propertyId:'other'},now),/another listing/);
  assert.throws(()=>validatePricingResearch({...i,data:{...i.data,marketObservedAt:'2026-11-13T00:00:00Z'}},now),/future/);
  assert.throws(()=>validatePricingResearch({...i,data:{...i.data,market:[],history:[]}},now),/daily rows/);
  assert.throws(()=>validatePricingResearch({...i,data:{...i.data,guest_name:'Not allowed'}},now));
  assert.throws(()=>validatePricingResearch({...i,data:{...i.data,market:[i.data.market[0],i.data.market[0]]}},now));
});
test('research reader distinguishes unavailable or wrong-property records from empty storage',async()=>{
  assert.equal((await readPricingResearch(dbFixture().db,'sample')).ok,true);
  assert.equal((await readPricingResearch(dbFixture({readError:true}).db,'sample')).ok,false);
  assert.equal((await readPricingResearch(dbFixture({wrongHome:true}).db,'sample')).ok,false);
});
test('research saves only through its scoped RPC and preserves conflict failures',async()=>{
  const f=dbFixture(),r=await savePricingResearch(f.db,input(),'owner@synthetic.test');assert.equal(r.ok,true);
  assert.deepEqual(f.calls.map(c=>c.name),['helm_save_pricing_research']);
  assert.equal((await savePricingResearch(dbFixture({missingHome:true}).db,input(),'owner@synthetic.test')).ok,false);
  const conflict=await savePricingResearch(dbFixture({rpcError:{code:'40001'}}).db,input(),'owner@synthetic.test');assert.equal(conflict.ok,false);assert.ok(!conflict.ok&&conflict.conflict);
});
function adapterFixture() {
  const data=input().data,calendar:PricingLiveCalendar={home:{id:'sample',name:'12 Sample',city:'Example',bedrooms:3,authority:'guesty',timezone:'America/New_York'},snapshot:{...structuredClone(fixture.snapshot),evidence:data},source:'Synthetic',sourceObservedAt:now.toISOString(),researchStatus:'ready',evidenceVersion:1};
  const state={version:1 as const,groups:[],homes:{sample:{policy:fixture.policy,version:1,groupId:null,inheritRules:false,overrides:[]}}};
  let current=calendar,throws=true,changed=0;const requests:PricingResearchSave[]=[];
  const adapter=createPricingDraftServices(calendar,()=>state,()=>{throw Error('Research must not mutate rules');},async()=>({ok:true,value:current}),{save:async i=>{requests.push(i);if(throws)throw Error('Lost response');return {ok:true,value:{version:2,data:i.data,updated_at:new Date().toISOString()}};},changed:()=>{changed++;}});
  return {adapter,calendar,requests,recover:()=>{throws=false;},changed:()=>changed,setCurrent:(c:PricingLiveCalendar)=>{current=c;}};
}
test('lost-response import retries reuse one request and update the dashboard only after confirmation',async()=>{
  const f=adapterFixture(),data={...input().data,marketSource:'PriceLabs export · Updated synthetic set'};
  const call={propertyId:'sample',version:1,data},before=f.adapter.inspect();
  assert.equal((await f.adapter.evidence(call)).ok,false);assert.equal(f.changed(),0);assert.deepEqual(f.adapter.inspect(),before);
  f.recover();assert.equal((await f.adapter.evidence(call)).ok,true);assert.deepEqual(f.requests[0],f.requests[1]);assert.equal(f.changed(),1);
  assert.equal(f.adapter.inspect().snapshot.observedAt,f.calendar.snapshot.observedAt,'Saving an export cannot make the calendar fresher');
  assert.equal(f.adapter.inspect().snapshot.evidence?.marketObservedAt,data.marketObservedAt,'Save time cannot replace observation time');
  assert.equal(f.adapter.inspect().evidenceVersion,2);
});
test('a fresh adapter loads shared research while an unavailable refresh retains visible evidence',async()=>{
  const f=adapterFixture();assert.equal(f.adapter.inspect().evidenceVersion,1);assert.ok(f.adapter.inspect().snapshot.evidence?.market.length);
  f.setCurrent({...f.calendar,researchStatus:'unavailable',snapshot:{...f.calendar.snapshot,evidence:undefined}});
  assert.equal((await f.adapter.refresh('sample')).ok,true);assert.ok(f.adapter.inspect().snapshot.evidence?.market.length);
  assert.equal((await f.adapter.evidence({propertyId:'sample',version:1,data:input().data})).ok,false);assert.equal(f.requests.length,0);
});
test('market comparisons reach the live portfolio, exclude blocks and keep other homes unavailable',()=>{
  const f=adapterFixture(),snapshot=structuredClone(f.calendar.snapshot);
  snapshot.days.forEach(d=>{d.state='open';});snapshot.days[0].state='blocked';snapshot.days[1].state='booked';
  snapshot.evidence!.market.forEach(d=>{d.occupancyPct=40;});snapshot.evidence!.market[0].occupancyPct=100;
  const row=pricingLiveRow(f.calendar.home,snapshot,now,snapshot.today);
  assert.equal(row.windows[30].marketPct,40);assert.equal(row.marketObservedAt,snapshot.evidence!.marketObservedAt);assert.equal(row.marketSource,snapshot.evidence!.marketSource);
  const other=pricingLiveRow({...f.calendar.home,id:'other'},{...snapshot,evidence:undefined},now,snapshot.today),totals=pricingPortfolioTotals([row,other],30);
  assert.equal(totals.comparableHomes,1);assert.equal(totals.marketPct,40);assert.equal(totals.comparedOccupancyPct,100/29);
  const later=expirePricingMarketRows([row],new Date(now.getTime()+37*3600000))[0];
  assert.equal(later.windows[30].marketPct,null);assert.equal(later.windows[30].occupancyPct,100/29);assert.equal(row.windows[30].marketPct,40);
  assert.throws(()=>pricingLiveRow({...f.calendar.home,id:'wrong'},snapshot,now,snapshot.today),/another listing/);
  snapshot.evidence!.marketObservedAt='2026-11-10T00:00:00Z';const expired=pricingLiveRow(f.calendar.home,snapshot,now,snapshot.today);
  assert.equal(expired.windows[30].marketPct,null);assert.equal(expired.windows[30].marketIssue,'stale');assert.equal(expired.windows[30].occupancyPct,100/29);
});
test('research actions require owner access and cannot import a rate publisher',()=>{
  const action=readFileSync(new URL('../../app/channels/pricing/research-actions.ts',import.meta.url),'utf8');
  assert.match(action,/const actor=await requireOwnerEmail\(\);/);assert.match(action,/return savePricingResearch\(supabaseAdmin,input,actor\)/);
  const server=readFileSync(new URL('../dynamic-pricing-research.server.ts',import.meta.url),'utf8');
  assert.doesNotMatch(server,/property_rate_days|helm_apply_pricing_run|owner_payout/);
});
