/** Shared staging persistence for synthetic ownership events. No provider publisher. */
import { replayOwnership, type OwnershipEvent, type OwnershipJournal } from './ownership-journal.ts';
export interface SharedOwnershipStore {
 read(): Promise<{ version: number; journal: OwnershipJournal }>;
 replace(version: number, journal: OwnershipJournal): Promise<boolean>;
}
/** Optimistic concurrency never retries stale snapshots or silently recreates lost history. */
export async function appendSharedOwnership(store: SharedOwnershipStore, event: OwnershipEvent) {
 const current = await store.read();
 if (!Number.isSafeInteger(current.version) || current.version < 0) throw new Error('Invalid shared version');
 const before = replayOwnership(current.journal);
 const next = replayOwnership({...before.journal, events:[...before.journal.events,event]});
 if (next.journal.events.length === before.journal.events.length) return {...next,version:current.version,duplicate:true};
 if (!await store.replace(current.version,next.journal)) throw new Error('Concurrent ownership update; reread and reconcile');
 return {...next,version:current.version+1,duplicate:false};
}
