import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendSharedOwnership } from '../channex-staging/shared-ownership.ts';
import { emptyOwnershipJournal, type OwnershipJournal, type OwnershipEvent } from '../channex-staging/ownership-journal.ts';
import { emptyLedger, applyRevision, type Revision } from '../channex-staging/core.ts';
function fixture(){let version=0,journal=emptyOwnershipJournal();return {read:async()=>({version,journal:structuredClone(journal)}),replace:async(v:number,j:OwnershipJournal)=>{if(v!==version)return false;journal=structuredClone(j);version++;return true;}};}
test('shared snapshots preserve sibling and maintenance blockers through changes, cancellation and stale revisions',async()=>{
 const store=fixture();let ledger=emptyLedger();let step=0;
 async function add(member:Revision['member'],bookingId:string,status:Revision['status'],time:number,start='2027-02-01',end='2027-02-04'){
  ledger=applyRevision(ledger,{id:`r${++step}`,bookingId,member,status,checkIn:start,checkOut:end,receivedAt:`2026-10-02T12:00:${String(time).padStart(2,'0')}Z`}).ledger;
  return appendSharedOwnership(store,{id:`s${step}`,kind:'snapshot',ledger,complete:true,holds:[{id:'maintenance',member:'back',checkIn:'2027-02-03',checkOut:'2027-02-04'}]});
 }
 let result=await add('whole','house','new',1);
 assert.ok(['whole','front','back'].every(t=>result.plan.claims.some(c=>c.target===t)));
 await add('whole','house','cancelled',2);
 result=await add('back','suite','new',3);
 assert.equal(result.plan.claims.some(c=>c.target==='front'),false);
 await add('front','main','new',4);
 result=await add('back','suite','modified',5,'2027-02-02');
 assert.ok(result.plan.releasedClaims.some(c=>c.date==='2027-02-01'&&c.bookingKey==='back:suite'));
 result=await add('back','suite','cancelled',6,'2027-02-02');
 assert.ok(result.plan.claims.some(c=>c.bookingKey==='front:main'&&c.target==='whole'));
 assert.ok(result.plan.nights.find(n=>n.target==='back'&&n.date==='2027-02-03')?.independentHolds.length);
 result=await add('back','suite','new',0);
 assert.equal(result.plan.claims.some(c=>c.bookingKey==='back:suite'),false);
 assert.equal(result.plan.executable,false);
 const saved=await store.read();assert.equal(saved.version,7);
 const duplicate=await appendSharedOwnership(store,saved.journal.events.at(-1)!);
 assert.equal(duplicate.duplicate,true);assert.equal((await store.read()).version,7);
});
test('concurrent append rejects one writer without dropping history',async()=>{
 const store=fixture();const event:OwnershipEvent={id:'a',kind:'snapshot',ledger:emptyLedger(),holds:[],complete:true};
 const results=await Promise.allSettled([appendSharedOwnership(store,event),appendSharedOwnership(store,{...event,id:'b'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await store.read()).journal.events.length,1);
});
test('unavailable shared storage never recreates history',async()=>{
 let writes=0;await assert.rejects(appendSharedOwnership({read:async()=>{throw new Error('offline')},replace:async()=>{writes++;return true}},{id:'a',kind:'snapshot',ledger:emptyLedger(),holds:[],complete:true}),/offline/);assert.equal(writes,0);
});
