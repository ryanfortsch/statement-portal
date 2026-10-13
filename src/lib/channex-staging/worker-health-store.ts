import { createClient } from '@supabase/supabase-js';
import type { WorkerHealth } from './worker-health.ts';
export function createWorkerHealthStore(url: string, key: string) {
 if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key) throw new Error('Explicit staging storage required');
 const db = createClient(url, key, {auth:{persistSession:false,autoRefreshToken:false}, global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}});
 return {
  async read(): Promise<WorkerHealth | null> {
   const {data,error}=await db.from('helm_pilot_worker_health').select('last_attempt,last_success,last_failure,consecutive_failures,outcome').eq('id',1).maybeSingle();
   if(error) throw new Error('Worker health unavailable');
   return data as WorkerHealth | null;
  },
  async record(success: boolean) {
   const {error}=await db.rpc('helm_pilot_record_worker_health',{succeeded:success});
   if(error) throw new Error('Worker health save unavailable');
  },
 };
}
