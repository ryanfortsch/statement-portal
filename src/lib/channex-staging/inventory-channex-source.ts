/** Read the durable synthetic Channex revision history; never consume/ACK a feed.
 * Incremental history cannot prove initial completeness, even if it is empty.
 */
import {latestBookings, type Unit} from './core.ts';
import {replayOwnership} from './ownership-journal.ts';
import type {SharedOwnershipStore} from './shared-ownership.ts';
import type {InventoryCollectionRequest} from './inventory-collection.ts';
import type {InventorySourceScan} from './inventory-snapshot.ts';
export async function collectPersistedChannexInventory(store:Pick<SharedOwnershipStore,'read'>,
 request:InventoryCollectionRequest, mapping:Record<Unit,string>, now:number):Promise<InventorySourceScan[]> {
 if (!Number.isSafeInteger(now) || now<0 || now===Number.MAX_SAFE_INTEGER) throw new Error('Invalid source clock');
 const source='channex-staging';
 if (!request.configuration.requiredSources.includes(source)) throw new Error('Channex source is not configured');
 if (mapping.front===mapping.back) throw new Error('Distinct unit mappings required');
 const resources=new Set<string>();
 for(const unit of ['front','back'] as const){
  const listing=request.configuration.listings.find(l=>l.id===mapping[unit]);
  if(!listing)throw new Error('Unmapped Channex unit');
  for(const resource of listing.resources)resources.add(resource);
 }
 const current=await store.read();
 const {journal}=replayOwnership(current.journal);
 if(!Number.isSafeInteger(current.version)||current.version!==journal.events.length)throw new Error('Source journal version mismatch');
 const latest=journal.events.filter(e=>e.kind==='snapshot').at(-1);
 const revisions=latest ? latestBookings(latest.ledger) : [];
 const bookings=revisions.filter(r=>r.member!=='whole').map(r=>({
  id:`channex:${r.member}:${r.bookingId}`,listing:mapping[r.member as Unit],
  start:r.checkIn,end:r.checkOut,status:r.status==='cancelled'?'cancelled' as const:'confirmed' as const,
 }));
 return [{source,resources:[...resources],start:request.start,end:request.end,
  observedAt:now,freshUntil:now+1,complete:false,
  pages:[{scan:`durable-journal-${current.version}`,cursor:null,next:null,bookings}]}];
}
