import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveObservedRevisions} from '../channex-staging/shared-feed.ts';
import {emptyOwnershipJournal, replayOwnership, type OwnershipJournal} from '../channex-staging/ownership-journal.ts';
import type {Revision} from '../channex-staging/core.ts';
test('incremental feed persists, deduplicates and retains blockers after cancellation until complete reconciliation',async()=>{
 let version=0,journal=emptyOwnershipJournal();const store={read:async()=>({version,journal}),replace:async(v:number,j:OwnershipJournal)=>{if(v!==version)return false;journal=j;version++;return true;}};
 const r:Revision={id:'provider-1',bookingId:'booking',member:'back',status:'new',checkIn:'2027-02-01',checkOut:'2027-02-04',receivedAt:'2026-10-02T12:00:00Z'};
 assert.equal((await saveObservedRevisions(store,[r])).saved,1);
 assert.equal((await saveObservedRevisions(store,[r])).duplicates,1);assert.equal(version,1);
 await saveObservedRevisions(store,[{...r,id:'provider-2',status:'cancelled',receivedAt:'2026-10-02T12:01:00Z'}]);
 assert.ok(replayOwnership(journal).plan.claims.length>0);
 assert.equal(replayOwnership(journal).plan.executable,false);
});
test('missing storage fails before saving',async()=>{
 await assert.rejects(saveObservedRevisions({read:async()=>{throw new Error('missing')},replace:async()=>{throw new Error('unexpected')}},[{id:'x',bookingId:'x',member:'back',status:'new',checkIn:'2027-02-01',checkOut:'2027-02-02',receivedAt:'2026-10-02T12:00:00Z'}]),/missing/);
});
