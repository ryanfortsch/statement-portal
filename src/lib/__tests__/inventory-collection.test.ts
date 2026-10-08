import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectInventorySnapshot} from '../channex-staging/inventory-collection.ts';
import type {PlanningState} from '../channex-staging/inventory-planner.ts';
import type {InventorySnapshotStore} from '../channex-staging/inventory-planning-store.ts';
const start='2027-01-01',end='2027-01-03';
function fixture(){
 const events:string[]=[];
 const state:PlanningState={configurationVersion:1,journalVersion:0,journal:{format:1,commands:[]},connection:'synthetic',property:'home',listing:'home',generation:1,
 snapshot:{version:1,resources:['home'],listings:[{id:'home',resources:['home']}],requiredSources:['canonical'],coverage:[],bookings:[],holds:[]}};
 const store:Pick<InventorySnapshotStore,'read'|'replaceSnapshot'>={read:async()=>{events.push('read');return state},replaceSnapshot:async(expected,snapshot)=>{
 events.push('save');if(expected.snapshotVersion!==state.snapshot.version||expected.configurationVersion!==state.configurationVersion)return false;
 state.snapshot=structuredClone(snapshot);return true;
 }};
 const scan={source:'canonical',resources:['home'],start,end,observedAt:900,freshUntil:2000,pages:[{scan:'one',cursor:null,next:null,bookings:[]}]};
 return {state,store,events,scan};
}
test('baseline is read before collection and saved exactly once; collector cannot mutate routing',async()=>{
 const f=fixture();const result=await collectInventorySnapshot(f.store,async r=>{f.events.push('collect');r.configuration.resources.push('untrusted');return [f.scan]},start,end,()=>1000);
 assert.equal(result.status,'saved');assert.deepEqual(f.events,['read','collect','save']);assert.deepEqual(f.state.snapshot.resources,['home']);assert.equal(f.state.snapshot.version,2);
});
test('concurrent snapshot or configuration changes reject import without reread or rebase',async()=>{
 for(const field of ['snapshot','configuration']){const f=fixture();const result=await collectInventorySnapshot(f.store,async()=>{
 f.events.push('collect');if(field==='snapshot')f.state.snapshot.version++;else f.state.configurationVersion++;return [f.scan]},start,end,()=>1000);
 assert.equal(result.status,'superseded');assert.deepEqual(f.events,['read','collect','save']);}
});
test('missing and expired sources save incomplete evidence, never a complete empty calendar',async()=>{
 for(const scans of ['missing','expired']){const f=fixture();f.scan.freshUntil=1000;
 assert.equal((await collectInventorySnapshot(f.store,async()=>scans==='missing'?[]:[f.scan],start,end,()=>1000)).status,'saved-incomplete');}
});
test('collector failures and uncertain saves propagate without retries',async()=>{
 const f=fixture();await assert.rejects(()=>collectInventorySnapshot(f.store,async()=>{throw new Error('source unavailable')},start,end,()=>1000),/source unavailable/);assert.deepEqual(f.events,['read']);
 let attempts=0;f.store.replaceSnapshot=async()=>{attempts++;throw new Error('uncertain')};
 await assert.rejects(()=>collectInventorySnapshot(f.store,async()=>[f.scan],start,end,()=>1000),/uncertain/);assert.equal(attempts,1);
});
