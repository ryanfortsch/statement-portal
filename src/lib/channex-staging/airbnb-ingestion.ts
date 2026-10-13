import {syncPilotMessages,type MessageSyncStore} from './message-sync.ts';
import type {ChannexPilotReader} from './pilot-reader.ts';
import type {Unit} from './core.ts';
/** Activation is explicit and independent from the synthetic worker. No automatic fallback. */
export function requireAirbnbIngestion(env:Record<string,string|undefined>){
 if(env.CHANNEX_WORKER_MODE!=='airbnb-read-only'||env.CHANNEX_AIRBNB_MAPPING_VERIFIED!=='17-beach-front-back')throw Error('Verified Airbnb pilot activation required');
}
export async function ingestAirbnbMessages(store:MessageSyncStore,reader:Pick<ChannexPilotReader,'readMessages'>,unit:Unit){
 return syncPilotMessages(store,reader,unit);
}
