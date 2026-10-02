import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runClosure, type ClosureState, type ClosureStore } from '../channex-staging/closure-worker.ts';
import { nights, TEST_START, TEST_END } from '../channex-staging/core.ts';
import type { StagingSnapshot } from '../channex-staging/client.ts';
function fixture() {
 let state:ClosureState={version:0,operation:{id:'test',dates:['2027-02-01'],status:'pending',ownershipVerified:false}};
 let writes=0, inventory:0|1=1, failAfterWrite=false, failSave=false;
 const store:ClosureStore={read:async()=>structuredClone(state),replace:async(v,op)=>{if(failSave&&v>0) throw new Error('storage offline'); if(v!==state.version)return false; state={version:v+1,operation:structuredClone(op)};return true;}};
 const client={readSnapshot:async():Promise<StagingSnapshot>=>({mappings:[],bookings:[],inventory:(['front','back'] as const).flatMap(unit=>nights(TEST_START,TEST_END).map(date=>({unit,date,inventory,stopSell:true,minStay:20})))}),publishStoppedInventory:async(days: {availability:number}[])=>{assert.ok(days.every(d=>d.availability===0));writes++;inventory=0;if(failAfterWrite)throw new Error('response lost');return {verifiedNights:days.length};}};
 return {store,client,get state(){return state},get writes(){return writes},set failAfterWrite(v:boolean){failAfterWrite=v},set failSave(v:boolean){failSave=v}};
}
test('closure persists intent and verifies inventory without claiming block ownership',async()=>{
 const f=fixture();const result=await runClosure(f.store,f.client);
 assert.equal(result.status,'observed-closed');assert.equal(result.ownershipVerified,false);assert.equal(f.writes,1);assert.equal(f.state.version,2);
 await runClosure(f.store,f.client);assert.equal(f.writes,1);
});
test('ambiguous network result reconciles by reading, never repeating the write',async()=>{
 const f=fixture();f.failAfterWrite=true;await assert.rejects(runClosure(f.store,f.client),/response lost/);
 assert.equal(f.state.operation.status,'needs-review');await assert.rejects(runClosure(f.store,f.client),/reconciliation/);
 assert.equal((await runClosure(f.store,f.client,true)).status,'observed-closed');assert.equal(f.writes,1);
});
test('failed completion persistence leaves intent recoverable without another send',async()=>{
 const f=fixture();f.failSave=true;await assert.rejects(runClosure(f.store,f.client));assert.equal(f.state.operation.status,'in-flight');
 f.failSave=false;await runClosure(f.store,f.client,true);assert.equal(f.writes,1);
});
test('atomic acquisition permits only one concurrent sender',async()=>{
 const f=fixture();const results=await Promise.allSettled([runClosure(f.store,f.client),runClosure(f.store,f.client)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.writes,1);
});
test('unsafe snapshot blocks writes and mismatched recovery stays review-only',async()=>{
 const f=fixture();const bad={...f.client,readSnapshot:async()=>{const s=await f.client.readSnapshot();s.inventory[0].stopSell=false;return s;}};
 await assert.rejects(runClosure(f.store,bad),/Unsafe/);assert.equal(f.writes,0);
 assert.equal((await runClosure(f.store,f.client,true)).status,'needs-review');assert.equal(f.writes,0);
});
test('cannot send when durable intent fails',async()=>{
 const f=fixture();const store={...f.store,replace:async()=>{throw new Error('offline')}};
 await assert.rejects(runClosure(store,f.client),/offline/);assert.equal(f.writes,0);
});
