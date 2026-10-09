import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectPersistedChannexInventory} from '../channex-staging/inventory-channex-source.ts';
import {assembleInventorySnapshot} from '../channex-staging/inventory-snapshot.ts';
import {projectInventory} from '../channex-staging/inventory-projection.ts';
import {emptyOwnershipJournal, type OwnershipJournal} from '../channex-staging/ownership-journal.ts';
import {applyRevision,emptyLedger} from '../channex-staging/core.ts';
const request={connection:'synthetic',property:'home',generation:1,start:'2027-01-01',end:'2027-01-03',configuration:{version:1,resources:['front','back'],listings:[{id:'front',resources:['front']},{id:'back',resources:['back']}],requiredSources:['channex-staging'],holds:[]}};
const mapping={front:'front',back:'back'};
const reader=(journal:OwnershipJournal)=>({read:async()=>({version:journal.events.length,journal})});
test('empty acknowledged history never proves an empty calendar',async()=>{
 const scans=await collectPersistedChannexInventory(reader(emptyOwnershipJournal()),request,mapping,1000);
 const snapshot=assembleInventorySnapshot(request.configuration,scans,request.start,request.end,1000);
 const projection=projectInventory(snapshot,'front',request.start,request.end,1000);
 assert.equal(projection.complete,false);assert.ok(projection.days.every(d=>d.stopSell));
});
test('durable revisions select latest status despite late older delivery and scope booking IDs by unit',async()=>{
 let ledger=emptyLedger();
 for(const r of [{id:'new',member:'front' as const,status:'new' as const,receivedAt:'2026-01-01T00:00:00Z'},
 {id:'cancel',member:'front' as const,status:'cancelled' as const,receivedAt:'2026-01-03T00:00:00Z'},
 {id:'late',member:'front' as const,status:'modified' as const,receivedAt:'2026-01-02T00:00:00Z'},
 {id:'back',member:'back' as const,status:'new' as const,receivedAt:'2026-01-01T00:00:00Z'}]){
 ledger=applyRevision(ledger,{...r,bookingId:'same',checkIn:request.start,checkOut:request.end}).ledger;
 }
 const journal=emptyOwnershipJournal();journal.events.push({id:'observed',kind:'snapshot',ledger,holds:[],complete:false});
 const scans=await collectPersistedChannexInventory(reader(journal),request,mapping,1000);
 assert.equal(scans[0].complete,false);
 assert.deepEqual(scans[0].pages[0].bookings.map(b=>[b.id,b.status]),[['channex:front:same','cancelled'],['channex:back:same','confirmed']]);
});
test('mapping and durable version mismatches fail closed',async()=>{
 await assert.rejects(()=>collectPersistedChannexInventory(reader(emptyOwnershipJournal()),request,{front:'missing',back:'back'},1000),/Unmapped/);
 await assert.rejects(()=>collectPersistedChannexInventory({read:async()=>({version:1,journal:emptyOwnershipJournal()})},request,mapping,1000),/version mismatch/);
});
