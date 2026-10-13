import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectInventory, type InventorySnapshot } from '../channex-staging/inventory-projection.ts';
const fixture = (): InventorySnapshot => ({ version: 1, resources: ['front', 'back'],
  listings: [{id:'front',resources:['front']},{id:'back',resources:['back']},{id:'whole',resources:['front','back']}],
  requiredSources:['bookings','holds'], coverage:['bookings','holds'].map(source => ({source,resources:['front','back'],start:'2027-02-01',end:'2027-03-01',complete:true,freshUntil:2000})), bookings:[], holds:[] });
const run = (s: InventorySnapshot, listing='front') => projectInventory(s,listing,'2027-02-01','2027-02-04',1000);
const booking = (id:string, listing:string) => ({id,listing,start:'2027-02-01',end:'2027-02-03',status:'confirmed' as const});
test('physical resource overlap closes combined listing without closing sibling unit',()=>{
 const s=fixture();s.bookings=[booking('b','back')];
 assert.deepEqual(run(s).days.map(d=>d.available),[1,1,1]);
 assert.deepEqual(run(s,'whole').days.map(d=>d.available),[0,0,1]);
 s.bookings=[booking('w','whole')];
 for(const l of ['front','back','whole'])assert.deepEqual(run(s,l).days.map(d=>d.available),[0,0,1]);
});
test('cancellation preserves overlapping booking and owner hold; checkout is exclusive',()=>{
 const s=fixture();s.bookings=[{...booking('cancelled','front'),status:'cancelled'},booking('other','front')];
 s.holds=[{id:'owner',resources:['front'],start:'2027-02-02',end:'2027-02-04'}];
 assert.deepEqual(run(s).reasons.map(d=>d.blockers),[['booking:other'],['booking:other','hold:owner'],['hold:owner']]);
});
test('date modification recomputes former and new nights from current canonical snapshot',()=>{
 const s=fixture();s.bookings=[booking('stay','front')];const prior=run(s);
 s.version=2;s.bookings[0].start='2027-02-02';s.bookings[0].end='2027-02-04';
 const next=run(s);assert.deepEqual(next.days.map(d=>d.available),[1,0,0]);assert.notEqual(prior.digest,next.digest);assert.equal(next.version,2);
});
test('missing, stale, incomplete or partial evidence closes entire requested batch',()=>{
 for(const mutate of [(s:InventorySnapshot)=>{s.coverage.pop()},(s:InventorySnapshot)=>{s.coverage[0].freshUntil=1000},(s:InventorySnapshot)=>{s.coverage[0].complete=false},(s:InventorySnapshot)=>{s.coverage[0].start='2027-02-02'}]){
 const s=fixture();mutate(s);const result=run(s);assert.equal(result.complete,false);assert.ok(result.days.every(d=>d.available===0&&d.stopSell));}
});
test('unmapped records, duplicate canonical bookings and ambiguous evidence fail closed',()=>{
 const s=fixture();s.bookings=[booking('b','unknown')];assert.throws(()=>run(s),/Unmapped/);
 s.bookings=[booking('b','front'),booking('b','front')];assert.throws(()=>run(s),/Duplicate/);
 s.bookings=[];s.coverage.push(s.coverage[0]);assert.throws(()=>run(s),/Ambiguous/);
});
test('single-property projection is deterministic, excludes prices and does not grant authority',()=>{
 const s=fixture();s.listings=[{id:'calderwood',resources:['front']}];s.bookings=[booking('b','calderwood')];
 const result=run(s,'calderwood');assert.deepEqual(Object.keys(result.days[0]).sort(),['available','date','stopSell']);
 assert.equal('enabled' in result,false);assert.equal('authority' in result,false);
 s.coverage.reverse();assert.deepEqual(run(s,'calderwood'),result);
 assert.throws(()=>run({...s,rates:[]} as InventorySnapshot,'calderwood'));
});
