/** Complete booking reconciliation for the isolated synthetic journal, never a publishing authority. */
import { createHash } from 'node:crypto';
import { applyRevision, latestBookings, type Revision, validateRevision, type Hold } from './core.ts';
import { replayOwnership } from './ownership-journal.ts';
import type { SharedOwnershipStore } from './shared-ownership.ts';
export async function reconcileObservedBookings(store:SharedOwnershipStore,bookings:Revision[]) {
 const current=await store.read();
 const before=replayOwnership(current.journal);
 const snapshots=before.journal.events.filter(e=>e.kind==='snapshot');
 const last=snapshots.at(-1);if(!last)throw new Error('Saved history required');
 let ledger=last.ledger;
 const remote=new Map<string,Revision>();
 for(const r of bookings){
  if(r.member==='whole')throw new Error('Provider cannot reconcile whole-house simulation');
  const key=`${r.member}:${r.bookingId}`;if(remote.has(key))throw new Error('Duplicate remote booking');
  ledger=applyRevision(ledger,r).ledger;remote.set(key,validateRevision(r));
 }
 // Only provider IDs are matched remotely. Fixed local rehearsal reservations remain local.
 for(const r of latestBookings(ledger)){
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(r.bookingId))continue;
  const observed=remote.get(`${r.member}:${r.bookingId}`);
  if(!observed||JSON.stringify(observed)!==JSON.stringify(r))throw new Error('Missing or stale remote booking; retain claims');
 }
 let holds:Hold[]=[];
 for(const s of snapshots)holds=s.complete?s.holds:[...holds,...s.holds];
 holds=[...new Map(holds.map(h=>[JSON.stringify(h),h])).values()];
 const id='reconcile-'+createHash('sha256').update(JSON.stringify({ledger,holds})).digest('hex');
 if(last.id===id&&last.complete)return {version:current.version,released:0,duplicate:true,published:0};
 const next=replayOwnership({...before.journal,events:[...before.journal.events,{id,kind:'snapshot',ledger,holds,complete:true}]});
 if(!await store.replace(current.version,next.journal))throw new Error('Concurrent update; reconciliation must be reread');
 return {version:current.version+1,released:next.plan.releasedClaims.length,duplicate:false,published:0};
}
