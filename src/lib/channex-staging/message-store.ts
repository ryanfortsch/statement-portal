import {createClient} from '@supabase/supabase-js';
import type {Unit} from './core.ts';
import type {MessageArchive} from './message-sync.ts';
import type {WorkerHealth} from './worker-health.ts';
export function createMessageStore(url:string,key:string){
 if(typeof window!=='undefined'||url!=='https://jgkblfozftcvymvwhhii.supabase.co'||!key)throw new Error('Explicit staging message storage required');
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}});
 return {
  async read(unit:Unit){
   const {data,error}=await db.from('helm_pilot_message_state').select('version,archive,last_attempt,last_success,last_failure,consecutive_failures,outcome').eq('unit',unit).single();
   if(error||!data)throw new Error('Message archive unavailable');
   return {version:data.version as number,archive:data.archive as MessageArchive,health:data.last_attempt?{last_attempt:data.last_attempt,last_success:data.last_success,last_failure:data.last_failure,consecutive_failures:data.consecutive_failures,outcome:data.outcome} as WorkerHealth:null};
  },
  async save(unit:Unit,version:number,archive:MessageArchive){
   const {data,error}=await db.rpc('helm_pilot_save_messages',{target_unit:unit,expected_version:version,next_archive:archive});
   if(error||typeof data!=='boolean')throw new Error('Message save failed');return data;
  },
  async failure(unit:Unit){const {error}=await db.rpc('helm_pilot_message_failure',{target_unit:unit});if(error)throw new Error('Message health save failed');},
 };
}
