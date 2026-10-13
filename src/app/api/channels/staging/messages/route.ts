import {auth} from '@/auth';
import {stagingBoardEnabled} from '@/lib/channex-staging/board';
import {createMessageStore} from '@/lib/channex-staging/message-store';
import {workerHealthStatus} from '@/lib/channex-staging/worker-health';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
 const session=await auth();
 if(!session?.user?.email?.endsWith('@risingtidestr.com')||!stagingBoardEnabled(process.env)||process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='codex/channex-staging-pilot')return Response.json({error:'Unavailable'},{status:403,headers});
 const params=new URL(request.url).searchParams,source=params.get('source')??'synthetic',unit=params.get('unit'),thread=params.get('thread')??undefined;
 if(source!=='synthetic'&&source!=='airbnb')return Response.json({error:'Invalid source'},{status:400,headers});
 if((unit!=='front'&&unit!=='back')||(thread&&!/^[0-9a-f-]{36}$/i.test(thread)))return Response.json({error:'Invalid pilot selection'},{status:400,headers});
 try{
  const saved=await createMessageStore(process.env.CHANNEX_STAGING_DB_URL??'',process.env.CHANNEX_STAGING_DB_SERVICE_KEY??'',source).read(unit);
  const selected=thread?saved.archive.conversations.find(c=>c.thread.id===thread):null;
  if(thread&&!selected)return Response.json({error:'Conversation not in saved pilot history'},{status:404,headers});
  return Response.json({threads:saved.archive.conversations.map(c=>c.thread),messages:selected?.messages??[],selectedThread:selected?.thread.id??null,health:saved.health,status:workerHealthStatus(saved.health),checkedAt:new Date().toISOString(),mode:'saved-read-only',source},{headers});
 }catch{return Response.json({error:'Saved message history unavailable. No provider request was made.'},{status:503,headers});}
}
