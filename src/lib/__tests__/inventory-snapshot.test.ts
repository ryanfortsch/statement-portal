import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleInventorySnapshot, type InventorySourceScan, type SnapshotConfiguration} from '../channex-staging/inventory-snapshot.ts';
import {projectInventory} from '../channex-staging/inventory-projection.ts';
const start='2027-01-01',end='2027-01-03',now=1000;
function fixture(){
 const config:SnapshotConfiguration={version:1,resources:['home'],listings:[{id:'home',resources:['home']}],requiredSources:['direct'],holds:[]};
 const scan:InventorySourceScan={source:'direct',resources:['home'],start,end,observedAt:900,freshUntil:2000,pages:[{scan:'stable-1',cursor:null,next:null,bookings:[]}]};
 return {config,scan};
}
const assemble=(f:ReturnType<typeof fixture>)=>assembleInventorySnapshot(f.config,[f.scan],start,end,now);
const project=(snapshot:ReturnType<typeof assemble>)=>projectInventory(snapshot,'home',start,end,now);
test('complete stable pages deduplicate explicit canonical IDs and preserve holds',()=>{
 const f=fixture();const booking={id:'stay',listing:'home',start,end:'2027-01-02',status:'confirmed' as const};
 f.scan.pages=[{scan:'stable-1',cursor:null,next:'second',bookings:[booking]},{scan:'stable-1',cursor:'second',next:null,bookings:[booking]}];
 f.config.holds=[{id:'maintenance',resources:['home'],start:'2027-01-02',end}];
 const snapshot=assemble(f);assert.equal(snapshot.bookings.length,1);assert.equal(project(snapshot).complete,true);
 assert.deepEqual(project(snapshot).days.map(d=>d.available),[0,0]);
});
test('missing source is not an empty calendar',()=>{
 const f=fixture();f.config.requiredSources.push('airbnb');const p=project(assemble(f));assert.equal(p.complete,false);assert.ok(p.days.every(d=>d.stopSell));
});
test('missing page, unstable scan, broken cursor and repeated terminal page fail closed',()=>{
 for(const mutate of [
  (s:InventorySourceScan)=>{s.pages[0].next='missing'},
  (s:InventorySourceScan)=>{s.pages.push({scan:'different',cursor:'two',next:null,bookings:[]});s.pages[0].next='two'},
  (s:InventorySourceScan)=>{s.pages[0].cursor='not-first'},
  (s:InventorySourceScan)=>{s.pages.push({...s.pages[0]})},
  (s:InventorySourceScan)=>{s.pages=[]},
 ]){const f=fixture();mutate(f.scan);assert.equal(project(assemble(f)).complete,false);}
});
test('conflicting cancellation copies cannot reopen a confirmed stay',()=>{
 const f=fixture();f.scan.pages[0].bookings=[{id:'stay',listing:'home',start,end,status:'confirmed'},{id:'stay',listing:'home',start,end,status:'cancelled'}];
 assert.throws(()=>assemble(f),/Conflicting canonical/);
});
test('stale evidence stays incomplete and future observations are rejected',()=>{
 const f=fixture();f.scan.freshUntil=1000;assert.equal(project(assemble(f)).complete,false);
 f.scan.observedAt=1001;assert.throws(()=>assemble(f),/freshness/);
});
test('unmapped scope and duplicate scans are rejected',()=>{
 const f=fixture();assert.throws(()=>assembleInventorySnapshot(f.config,[f.scan,f.scan],start,end,now),/duplicate source/);
 f.scan.resources=['other'];f.scan.pages[0].bookings=[{id:'stay',listing:'home',start,end,status:'confirmed'}];assert.throws(()=>assemble(f),/resource scope/);
});
