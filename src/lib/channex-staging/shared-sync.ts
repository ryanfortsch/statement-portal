/** At-least-once delivery: never ACK a revision until exact normalized content is durable. */
import { saveObservedRevisions } from './shared-feed.ts';
import { replayOwnership } from './ownership-journal.ts';
import { validateRevision } from './core.ts';
import type { SharedOwnershipStore } from './shared-ownership.ts';
import type { ChannexStagingClient } from './client.ts';
export async function syncSharedRevisions(store:SharedOwnershipStore,client:Pick<ChannexStagingClient,'inspectReadSource'|'readRevisions'|'acknowledge'>){
 await client.inspectReadSource();
 const revisions=await client.readRevisions();
 const result=await saveObservedRevisions(store,revisions);
 let acknowledged=0;
 for(const raw of revisions){
  const revision=validateRevision(raw);
  const saved=replayOwnership((await store.read()).journal);
  const durable=saved.journal.events.some(e=>e.kind==='snapshot'&&e.ledger.revisions.some(r=>JSON.stringify(r)===JSON.stringify(revision)));
  if(!durable)throw new Error('Exact revision not found in shared storage; ACK refused');
  await client.acknowledge(revision);acknowledged++;
 }
 return {...result,received:revisions.length,acknowledged,published:0};
}
