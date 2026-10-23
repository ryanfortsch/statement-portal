import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processAirbnbBookingCycle} from '../channex-bookings/cycle.ts';
const id='11111111-1111-4111-8111-111111111111';
const mapping={environment:'staging' as const,propertyId:id,roomTypeId:id,ratePlanId:id,generation:1};
const store={commit:async()=>{throw Error('unexpected');},receipt:async()=>{throw Error('unexpected');}};
const empty={scanned:0,prepared:0,refreshed:0,blocked:0,canSend:false};
test('cycle recovers durable work before provider read and sweeps again after intake',async()=>{
 const events:string[]=[];
 const client={inspect:async()=>{events.push('inspect');},feed:async()=>{events.push('feed');return [];},revision:async()=>null,acknowledge:async()=>{}};
 const rpc=async(name:string,args:Record<string,unknown>)=>{assert.equal(name,'helm_airbnb_messages_tick');assert.deepEqual(args,{p_limit:25});events.push('sweep');return {data:empty,error:null};};
 const result=await processAirbnbBookingCycle(client,store,mapping,rpc);
 assert.deepEqual(events,['sweep','inspect','feed','sweep']);assert.equal(result.canSend,false);
});
test('provider outage does not prevent recovery of previously committed work',async()=>{
 let recovered=0;
 const client={inspect:async()=>{throw Error('secret');},feed:async()=>[],revision:async()=>null,acknowledge:async()=>{}};
 await assert.rejects(()=>processAirbnbBookingCycle(client,store,mapping,async()=>{recovered++;return {data:empty,error:null};}),/ingestion incomplete/);
 assert.equal(recovered,1);
});
test('invalid recovery responses and limits fail before provider calls without exposing errors',async()=>{
 let calls=0;
 const client={inspect:async()=>{calls++;},feed:async()=>[],revision:async()=>null,acknowledge:async()=>{}};
 for(const data of [{...empty,scanned:26},{...empty,prepared:1},{...empty,canSend:true},null])
  await assert.rejects(()=>processAirbnbBookingCycle(client,store,mapping,async()=>({data,error:null})),/recovery incomplete/);
 await assert.rejects(()=>processAirbnbBookingCycle(client,store,mapping,async()=>{throw Error('secret');}),/recovery incomplete/);
 await assert.rejects(()=>processAirbnbBookingCycle(client,store,mapping,async()=>({data:empty,error:null}),101),/Invalid/);
 assert.equal(calls,0);
});
