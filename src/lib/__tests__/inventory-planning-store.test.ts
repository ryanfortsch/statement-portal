import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryPlanningStore} from '../channex-staging/inventory-planning-store.ts';
import type {InventoryJournal} from '../channex-staging/inventory-journal.ts';
const url='https://jgkblfozftcvymvwhhii.supabase.co';
const journal:InventoryJournal={format:1,commands:[{kind:'enqueue',now:1000,intent:{id:'test',environment:'staging',connection:'synthetic',property:'home',generation:1,version:1,days:[{date:'2027-01-01',available:0,stopSell:true}]}}]};
const expected={snapshotVersion:1,configurationVersion:2,journalVersion:0};
test('planning adapter confines access and commits versions through one RPC',async()=>{
 const calls:Array<{url:string;body:unknown}>=[];
 const store=createInventoryPlanningStore(url,'synthetic',async(input,init)=>{
  calls.push({url:String(input),body:JSON.parse(String(init?.body))});return Response.json(true);
 });
 assert.equal(await store.commit(expected,journal,2000),true);
 assert.deepEqual(calls,[{url:url+'/rest/v1/rpc/helm_pilot_inventory_plan_commit',body:{expected_snapshot:1,expected_configuration:2,expected_journal:0,next_journal:journal,fresh_until:2000}}]);
 assert.throws(()=>createInventoryPlanningStore('https://other.supabase.co','synthetic'),/isolated/);
});
test('stale commit returns false while malformed responses and save errors remain uncertain',async()=>{
 const stale=createInventoryPlanningStore(url,'synthetic',async()=>Response.json(false));assert.equal(await stale.commit(expected,journal,2000),false);
 for(const response of [()=>Response.json({unexpected:true}),()=>new Response('private server details',{status:400})]){
 const store=createInventoryPlanningStore(url,'synthetic',async()=>response());await assert.rejects(()=>store.commit(expected,journal,2000),/Planning save uncertain/);}
});
test('missing snapshot refuses initialization and invalid append never calls storage',async()=>{
 let calls=0;const store=createInventoryPlanningStore(url,'synthetic',async()=>{calls++;return Response.json(null)});
 await assert.rejects(()=>store.read(),/unavailable/);assert.equal(calls,1);
 await assert.rejects(()=>store.commit(expected,{format:1,commands:[]},2000),/Expected one/);assert.equal(calls,1);
});
