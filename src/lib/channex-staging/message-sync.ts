import {revisionTime,type Unit} from './core.ts';
import type {PilotThread,PilotMessage} from './messages.ts';
export type SavedConversation={thread:PilotThread;messages:PilotMessage[]};
export type MessageArchive={version:1;conversations:SavedConversation[]};
export type MessageSyncStore={read(unit:Unit):Promise<{version:number;archive:MessageArchive}>;save(unit:Unit,version:number,archive:MessageArchive):Promise<boolean>};
export type MessageReader={readMessages(unit:Unit,threadId?:string):Promise<{threads:PilotThread[];messages:PilotMessage[];selectedThread:string|null}>};
export const emptyMessageArchive=():MessageArchive=>({version:1,conversations:[]});
/** Preserve previously observed history; absence is not a provider deletion event. */
export function mergeMessageArchive(prior:MessageArchive,incoming:SavedConversation[],unit:Unit):MessageArchive{
 if(prior.version!==1||!Array.isArray(prior.conversations))throw new Error('Invalid message archive');
 const merged=new Map<string,SavedConversation>();
 for(const conversation of prior.conversations){
  if(conversation.thread.unit!==unit||merged.has(conversation.thread.id))throw new Error('Invalid archive ownership');
  merged.set(conversation.thread.id,conversation);
 }
 const seen=new Set<string>();
 for(const next of incoming){
  if(next.thread.unit!==unit||seen.has(next.thread.id))throw new Error('Invalid incoming thread');
  seen.add(next.thread.id);
  const old=merged.get(next.thread.id),messages=new Map((old?.messages??[]).map(m=>[m.id,m]));
  const ids=new Set<string>();
  for(const m of next.messages){
   if(ids.has(m.id))throw new Error('Duplicate message snapshot');ids.add(m.id);
   const existing=messages.get(m.id);
   if(existing){
    const order=revisionTime(m.updatedAt).localeCompare(revisionTime(existing.updatedAt));
    if(order<0)continue;
    if(order===0&&JSON.stringify(m)!==JSON.stringify(existing))throw new Error('Conflicting message revision');
   }
   messages.set(m.id,m);
  }
  merged.set(next.thread.id,{thread:next.thread,messages:[...messages.values()].sort((a,b)=>revisionTime(a.receivedAt).localeCompare(revisionTime(b.receivedAt))||a.id.localeCompare(b.id))});
 }
 const archive:MessageArchive={version:1,conversations:[...merged.values()]};
 if(archive.conversations.length>100||JSON.stringify(archive).length>1000000)throw new Error('Pilot archive limit reached');
 return archive;
}
export async function syncPilotMessages(store:MessageSyncStore,client:MessageReader,unit:Unit){
 const prior=await store.read(unit);
 const listed=await client.readMessages(unit);
 if(listed.threads.length>20)throw new Error('Pilot conversation limit reached');
 const incoming:SavedConversation[]=[];
 for(const thread of listed.threads){
  const result=await client.readMessages(unit,thread.id);
  const current=result.threads.find(t=>t.id===thread.id);
  if(!current||result.selectedThread!==thread.id||result.messages.length!==current.messageCount)throw new Error('Message snapshot changed or incomplete');
  incoming.push({thread:current,messages:result.messages});
 }
 const archive=mergeMessageArchive(prior.archive,incoming,unit);
 if(!await store.save(unit,prior.version,archive))throw new Error('Concurrent message sync; retry from stored version');
 return {threads:incoming.length,messages:incoming.reduce((n,c)=>n+c.messages.length,0)};
}
