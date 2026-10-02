import { createClient } from '@supabase/supabase-js';
import { emptyOwnershipJournal, replayOwnership, type OwnershipJournal } from './ownership-journal.ts';
/** Fixed isolated staging project; never uses Helm production database settings. */
export function createSharedOwnershipStore(url: string, key: string) {
 if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key) throw new Error('Explicit staging storage required');
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 return {
  async initialize() {
   const {error}=await db.from('helm_pilot_ownership_state').insert({id:1,journal:emptyOwnershipJournal()});
   if(error) throw new Error('Ownership initialization refused; existing history must be preserved');
  },
  async read() {
   const {data,error}=await db.from('helm_pilot_ownership_state').select('version,journal').eq('id',1).single();
   if(error||!data) throw new Error('Shared ownership history unavailable');
   return {version:data.version as number,journal:replayOwnership(data.journal).journal};
  },
  async replace(version:number,journal:OwnershipJournal) {
   const normalized=replayOwnership(journal).journal;
   const {data,error}=await db.rpc('helm_pilot_ownership_cas',{expected_version:version,next_journal:normalized});
   if(error||typeof data!=='boolean') throw new Error('Shared ownership save failed');
   return data;
  },
 };
}
