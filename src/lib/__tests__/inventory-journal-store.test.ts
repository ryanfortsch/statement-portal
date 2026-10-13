import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryJournalStore} from '../channex-staging/inventory-journal-store.ts';
const url='https://jgkblfozftcvymvwhhii.supabase.co';
test('journal reader fails closed on missing or mismatched durable history without initialization',async()=>{
 for(const data of [null,{version:1,journal:{format:1,commands:[]}}]){
  const calls:string[]=[];
  const store=createInventoryJournalStore(url,'synthetic',async(input,init)=>{
   calls.push(init?.method ?? 'GET'); assert.ok(String(input).startsWith(url+'/rest/v1/helm_pilot_inventory_state?'));
   return Response.json(data);
  });
  await assert.rejects(()=>store.read(),/history (unavailable|version mismatch)/);
  assert.deepEqual(calls,['GET']);
 }
});
test('journal adapter refuses alternate hosts and uncertain append responses',async()=>{
 assert.throws(()=>createInventoryJournalStore('https://other.supabase.co','synthetic'),/isolated/);
 const store=createInventoryJournalStore(url,'synthetic',async()=>Response.json({unexpected:true}));
 await assert.rejects(()=>store.append(0,{format:1,commands:[{kind:'expire',now:1000}]}),/save uncertain/);
});
