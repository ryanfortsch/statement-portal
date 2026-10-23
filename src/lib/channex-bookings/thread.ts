import { z } from 'zod';
import {record} from '../channex-staging/core.ts';
const uuid=z.string().uuid();
export const threadScopeSchema=z.object({environment:z.enum(['staging','production']),propertyId:uuid,
 channelId:uuid,routeGeneration:uuid,bookingId:uuid,canonicalBookingId:uuid,mappingGeneration:z.number().int().positive().safe()}).strict();
export type ThreadScope=z.infer<typeof threadScopeSchema>;
const relation=(row:Record<string,unknown>,key:string)=>uuid.parse(record(record(record(row.relationships)[key]).data).id);
/** Read-only ownership proof. No names, dates or message bodies are used to match.
 * Booking->thread and thread->booking/property/channel must agree; inquiry-only
 * threads have no booking relationship and are rejected. No ambient credentials.
 */
export function createAirbnbThreadReader(apiKey:string,fetcher:typeof fetch=fetch) {
 if(typeof window!=='undefined'||!apiKey?.trim()||/[\r\n]/.test(apiKey)) throw Error('Explicit server credential required');
 const key=apiKey.trim();
 return async(input:ThreadScope)=>{
  try {
   const scope=threadScopeSchema.parse(input);
   const base=scope.environment==='staging'?'https://staging.channex.io/api/v1':'https://app.channex.io/api/v1';
   const get=async(path:string)=>{
    const response=await fetcher(base+path,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{'user-api-key':key,Accept:'application/json'}});
    if(!response.ok||response.redirected) throw Error();
    const body=record(await response.json());
    const warnings=body.meta===undefined?undefined:record(body.meta).warnings;
    if(body.errors||(warnings!==undefined&&(!Array.isArray(warnings)||warnings.length))) throw Error();
    return record(body.data);
   };
   const booking=await get('/bookings/'+scope.bookingId);
   if(booking.type!=='booking'||booking.id!==scope.bookingId||record(booking.attributes).property_id!==scope.propertyId||record(booking.attributes).ota_name!=='Airbnb') throw Error();
   const threadId=relation(booking,'message_thread');
   const thread=await get('/message_threads/'+threadId);
   if(thread.type!=='message_thread'||thread.id!==threadId||record(thread.attributes).provider!=='Airbnb'||record(thread.attributes).is_closed!==false||
     relation(thread,'booking')!==scope.bookingId||relation(thread,'property')!==scope.propertyId||relation(thread,'channel')!==scope.channelId) throw Error();
   // Re-read the forward link to reject remapping during verification.
   const again=await get('/bookings/'+scope.bookingId);
   if(again.type!=='booking'||again.id!==scope.bookingId||record(again.attributes).property_id!==scope.propertyId||record(again.attributes).ota_name!=='Airbnb'||relation(again,'message_thread')!==threadId) throw Error();
   return {...scope,threadId,verifiedAt:new Date().toISOString()};
  } catch {throw Error('Airbnb conversation ownership could not be verified');}
 };
}
export async function registerAirbnbThread(scope:ThreadScope,read:ReturnType<typeof createAirbnbThreadReader>,
 rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>) {
 const proof=await read(threadScopeSchema.parse(scope));
 try {
  const result=await rpc('helm_airbnb_thread_register',{p_proof:proof});
  if(result.error||result.data!==true) throw Error();
  return true;
 } catch {throw Error('Airbnb conversation registration incomplete');}
}

/** Fair bounded discovery. Failed reads remain eligible for a later cycle.
 * Validate the entire candidate batch before requesting any provider data.
 */
export async function discoverAirbnbThreads(mapping: {environment:string;propertyId:string;generation:number},
 read:ReturnType<typeof createAirbnbThreadReader>,
 rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>,limit=25) {
 if(typeof window!=='undefined'||!Number.isInteger(limit)||limit<1||limit>100) throw Error('Invalid discovery batch');
 let candidates:ThreadScope[];
 try {
  const result=await rpc('helm_airbnb_thread_candidates',{p_limit:limit});
  if(result.error) throw Error();
  candidates=z.array(threadScopeSchema).max(limit).parse(result.data);
  if(new Set(candidates.map(x=>x.canonicalBookingId)).size!==candidates.length||new Set(candidates.map(x=>x.bookingId)).size!==candidates.length||
    candidates.some(x=>x.environment!==mapping.environment||x.propertyId!==mapping.propertyId||x.mappingGeneration!==mapping.generation)) throw Error();
 } catch {throw Error('Airbnb conversation discovery incomplete');}
 let linked=0,blocked=0;
 for(const candidate of candidates){
  try {await registerAirbnbThread(candidate,read,rpc);linked++;} catch {blocked++;}
 }
 return {scanned:candidates.length,linked,blocked,canSend:false as const};
}
