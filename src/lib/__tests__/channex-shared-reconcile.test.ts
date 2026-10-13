import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileObservedBookings} from '../channex-staging/shared-reconcile.ts';
import {saveObservedRevisions} from '../channex-staging/shared-feed.ts';
import {emptyOwnershipJournal,replayOwnership,type OwnershipJournal} from '../channex-staging/ownership-journal.ts';
import type {Revision} from '../channex-staging/core.ts';
function fixture(){let version=0,journal=emptyOwnershipJournal();return {read:async()=>({version,journal:structuredClone(journal)}),replace:async(v:number,j:OwnershipJournal)=>{if(v!==version)return false;journal=structuredClone(j);version++;return true;}};}
const r:Revision={id:'new',bookingId:'0371439d-3b6b-4505-a1ea-7e0ccc029f2a',member:'back',status:'new',checkIn:'2027-03-01',checkOut:'2027-03-22',receivedAt:'2026-10-02T12:00:00Z'};
const cancel:Revision={...r,id:'cancel',status:'cancelled',receivedAt:'2026-10-02T12:01:00Z'};
test('complete cancellation releases retained claims; repeated reconciliation is a no-op',async()=>{
 const store=fixture();await saveObservedRevisions(store,[r,cancel]);
 assert.ok(replayOwnership((await store.read()).journal).plan.claims.length);
 const result=await reconcileObservedBookings(store,[cancel]);assert.equal(result.released,42);assert.equal(result.published,0);
 assert.equal(replayOwnership((await store.read()).journal).plan.claims.length,0);
 assert.equal((await reconcileObservedBookings(store,[cancel])).duplicate,true);assert.equal((await store.read()).version,3);
});
test('missing or stale booking cannot release retained claims',async()=>{
 const store=fixture();await saveObservedRevisions(store,[r,cancel]);
 await assert.rejects(reconcileObservedBookings(store,[]),/Missing/);
 await assert.rejects(reconcileObservedBookings(store,[r]),/stale/);
 assert.equal((await store.read()).version,2);
});
test('concurrent change rejects reconciliation',async()=>{
 const store=fixture();await saveObservedRevisions(store,[r,cancel]);
 await assert.rejects(reconcileObservedBookings({...store,replace:async()=>false},[cancel]),/Concurrent/);
});
