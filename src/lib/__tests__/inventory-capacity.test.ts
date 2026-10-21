import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InventoryHistoryCapacityError, inventoryJournalCapacity, replayInventoryJournal, recordInventoryCommand,
  type InventoryJournal, type InventoryJournalStore } from '../channex-staging/inventory-journal.ts';
import { prepareInventoryDispatch } from '../channex-staging/inventory-worker.ts';
import { runInventoryScheduler } from '../channex-staging/booking-inventory-scheduler.ts';
import type { InventoryJob, DispatchContext } from '../channex-staging/inventory-outbox.ts';
const intent={id:'fixture',environment:'staging' as const,connection:'fixture',property:'HELMTEST-calderwood',generation:1,version:1,
  days:[{date:'2027-02-01',available:0 as const,stopSell:true}]};
function fixture(size:number){
  let journal:InventoryJournal={format:1,commands:[{kind:'enqueue',intent,now:0},
    ...Array.from({length:size-1},()=>({kind:'expire' as const,now:0}))]};
  const store:InventoryJournalStore={read:async()=>({version:journal.commands.length,journal:structuredClone(journal)}),
    append:async(v,j)=>{if(v!==journal.commands.length)return false;journal=structuredClone(j);return true;}};
  return {store,read:()=>journal};
}
const context=(j:InventoryJob):DispatchContext=>({environment:'staging',connection:j.connection,property:j.property,
  generation:j.generation,version:j.version,digest:j.digest,authority:'helm',enabled:true,complete:true,freshUntil:10000});
test('nearly full history refuses a fresh attempt before it can return a dispatch permit',async()=>{
  for(const size of [9990,9999,10000]){
    const f=fixture(size),before=structuredClone(f.read());
    await assert.rejects(()=>prepareInventoryDispatch(f.store,intent.id,()=>0,100,async j=>context(j)),InventoryHistoryCapacityError);
    assert.deepEqual(f.read(),before);assert.equal(replayInventoryJournal(f.read()).queue.list()[0].status,'pending');
  }
});
test('a threshold crossed after claim blocks dispatch, and the unused lease can still expire',async()=>{
  const f=fixture(9989);
  await assert.rejects(()=>prepareInventoryDispatch(f.store,intent.id,()=>0,100,async j=>context(j)),InventoryHistoryCapacityError);
  assert.equal(replayInventoryJournal(f.read()).queue.list()[0].status,'leased');
  assert.equal((await recordInventoryCommand(f.store,{kind:'expire',now:101})).saved,true);
  assert.equal(replayInventoryJournal(f.read()).queue.list()[0].status,'pending');
});
test('an already dispatched attempt retains room for acceptance, expiry and successful reconciliation',async()=>{
  const f=fixture(9988);
  const job=await prepareInventoryDispatch(f.store,intent.id,()=>0,100,async j=>context(j));assert.ok(job);
  assert.equal(f.read().commands.length,9990);
  await recordInventoryCommand(f.store,{kind:'accepted',id:intent.id,token:job.token!,task:'fixture-task'});
  await recordInventoryCommand(f.store,{kind:'expire',now:101});
  const result=await recordInventoryCommand(f.store,{kind:'reconcile',id:intent.id,token:job.token!,
    evidence:{settled:true,complete:true,digest:job.digest,generation:1}});
  assert.equal(result.result,true);assert.equal(replayInventoryJournal(f.read()).queue.list()[0].status,'verified');
  assert.equal(f.read().commands.length,9993);
});
test('idle expiry at the absolute ceiling is a no-op rather than an exception or history reset',async()=>{
  const f=fixture(10000);assert.equal((await recordInventoryCommand(f.store,{kind:'expire',now:1})).saved,false);
  assert.equal(f.read().commands.length,10000);
  assert.deepEqual(inventoryJournalCapacity(10000),{commands:10000,remaining:0,status:'needs-archive'});
  assert.equal(inventoryJournalCapacity(8000).status,'warning');assert.equal(inventoryJournalCapacity(70).status,'healthy');
  assert.throws(()=>inventoryJournalCapacity(10001));
});
test('history capacity has an explicit worker diagnosis and backoff',async()=>{
  const logs:unknown[]=[];
  const result=await runInventoryScheduler({signal:new AbortController().signal,once:true,cycle:async()=>{throw new InventoryHistoryCapacityError();},log:e=>logs.push(e)});
  assert.equal(result.failed,true);assert.deepEqual({...logs[0] as object,at:'omitted'},
    {event:'canonical-inventory-cycle',at:'omitted',failures:1,phase:'history',status:'needs-review'});
});
