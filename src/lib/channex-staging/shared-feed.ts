/** Observation-only import. Never acknowledges revisions or publishes inventory. */
import { applyRevision, emptyLedger, type Revision } from './core.ts';
import { replayOwnership } from './ownership-journal.ts';
import { appendSharedOwnership, type SharedOwnershipStore } from './shared-ownership.ts';
export async function saveObservedRevisions(store:SharedOwnershipStore,revisions:Revision[]) {
 let saved=0,duplicates=0;
 for(const revision of revisions){
  if(revision.member==='whole')throw new Error('Provider feed cannot supply whole-house simulation');
  const current=await store.read();const replay=replayOwnership(current.journal);
  const last=replay.journal.events.filter(e=>e.kind==='snapshot').at(-1);
  const applied=applyRevision(last?.ledger??emptyLedger(),revision);
  if(applied.outcome==='duplicate'){duplicates++;continue;}
  // Feed is incremental, not proof that all reservations or holds are known.
  await appendSharedOwnership(store,{id:`feed-${revision.id}`,kind:'snapshot',ledger:applied.ledger,holds:last?.holds??[],complete:false});
  saved++;
 }
 return {saved,duplicates,acknowledged:0,published:0,complete:false};
}
