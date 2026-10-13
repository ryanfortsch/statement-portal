import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planInventory, type PlanningState, type InventoryPlanningStore } from '../channex-staging/inventory-planner.ts';
import { emptyInventoryJournal, replayInventoryJournal } from '../channex-staging/inventory-journal.ts';
function fixture() {
 let now=1000;
 const state: PlanningState = { configurationVersion:1,journalVersion:0,journal:emptyInventoryJournal(),connection:'synthetic',property:'home',listing:'home',generation:1,
 snapshot:{version:1,resources:['home'],listings:[{id:'home',resources:['home']}],requiredSources:['canonical'],coverage:[{source:'canonical',resources:['home'],start:'2027-01-01',end:'2027-02-01',complete:true,freshUntil:2000}],bookings:[],holds:[]} };
 let beforeCommit=()=>{};
 const store:InventoryPlanningStore={read:async()=>structuredClone(state),commit:async(expected,journal,freshUntil)=>{
 beforeCommit();
 if(state.snapshot.version!==expected.snapshotVersion||state.configurationVersion!==expected.configurationVersion||state.journalVersion!==expected.journalVersion||now>=freshUntil)return false;
 state.journal=structuredClone(journal);state.journalVersion++;return true;
 }};
 return {state,store,clock:()=>now,changeBeforeCommit(fn:()=>void){beforeCommit=fn},expire(){now=2000}};
}
const run=(f:ReturnType<typeof fixture>)=>planInventory(f.store,'2027-01-01','2027-01-03',f.clock);
test('complete snapshot queues inventory once, preserving holds and without permission to send',async()=>{
 const f=fixture();f.state.snapshot.holds=[{id:'maintenance',resources:['home'],start:'2027-01-01',end:'2027-01-02'}];
 assert.equal((await run(f)).status,'queued');assert.equal((await run(f)).status,'unchanged');
 const jobs=replayInventoryJournal(f.state.journal).queue.list();assert.equal(jobs.length,1);assert.equal(jobs[0].status,'pending');
 assert.deepEqual(jobs[0].days,[{date:'2027-01-01',available:0,stopSell:true},{date:'2027-01-02',available:1,stopSell:false}]);
});
test('snapshot or configuration change during planning prevents stale enqueue',async()=>{
 for(const field of ['snapshot','configuration'] as const){const f=fixture();f.changeBeforeCommit(()=>{if(field==='snapshot')f.state.snapshot.version++;else f.state.configurationVersion++;});
 assert.equal((await run(f)).status,'superseded');assert.equal(f.state.journalVersion,0);}
});
test('competing planners cannot both append from the same journal version',async()=>{
 const f=fixture();const results=await Promise.all([run(f),run(f)]);
 assert.deepEqual(results.map(r=>r.status).sort(),['queued','superseded']);assert.equal(f.state.journalVersion,1);
});
test('expired or incomplete evidence never enters the outbox',async()=>{
 const f=fixture();f.state.snapshot.coverage[0].complete=false;assert.equal((await run(f)).status,'blocked');
 f.state.snapshot.coverage[0].complete=true;f.changeBeforeCommit(()=>f.expire());assert.equal((await run(f)).status,'superseded');assert.equal(f.state.journalVersion,0);
});
test('new booking version supersedes unsent availability; content cannot change under same version',async()=>{
 const f=fixture();await run(f);f.state.snapshot.bookings=[{id:'stay',listing:'home',start:'2027-01-01',end:'2027-01-03',status:'confirmed'}];
 await assert.rejects(()=>run(f),/identity conflict/);f.state.snapshot.version++;assert.equal((await run(f)).status,'queued');
 assert.deepEqual(replayInventoryJournal(f.state.journal).queue.list().map(j=>j.status),['superseded','pending']);
});
test('uncertain commit throws without blind retry or dispatch',async()=>{
 const f=fixture();let attempts=0;f.store.commit=async()=>{attempts++;throw new Error('response lost')};
 await assert.rejects(()=>run(f),/response lost/);assert.equal(attempts,1);
});
